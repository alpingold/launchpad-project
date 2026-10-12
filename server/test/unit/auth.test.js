import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/database.js';
import { createUser, findUserForLogin } from '../../src/db/users.js';
import { createSession, getSessionUser, deleteSession, deleteExpiredSessions } from '../../src/db/sessions.js';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../../src/auth/passwords.js';
import { isValidUsername, isValidPassword } from '../../src/auth/credentials.js';
import { parseCookies, sessionCookie, clearedSessionCookie } from '../../src/auth/cookies.js';

const DAY = 24 * 60 * 60 * 1000;

// --- Passwords ---------------------------------------------------------------------------

test('hashPassword: format stores the settings, salt, and hash; never the password', async () => {
  const hash = await hashPassword('correct horse');
  assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!hash.includes('correct horse'));
});

test('same password, different salt, different hash', async () => {
  assert.notEqual(await hashPassword('same password'), await hashPassword('same password'));
});

test('verifyPassword: right password true, wrong false, case matters', async () => {
  const hash = await hashPassword('Hunter2-hunter2');
  assert.equal(await verifyPassword('Hunter2-hunter2', hash), true);
  assert.equal(await verifyPassword('hunter2-hunter2', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('verifyPassword: malformed stored hashes are "no match", never a crash', async () => {
  for (const stored of [undefined, '', 'plaintext', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e', 'scrypt$abc$8$1$c2FsdA==$aGFzaA==', 'scrypt$32768$8$1$c2FsdA==$']) {
    assert.equal(await verifyPassword('anything', stored), false, String(stored));
  }
});

test('the dummy hash is a real hash that matches nothing anyone would type', async () => {
  assert.match(DUMMY_HASH, /^scrypt\$/);
  assert.equal(await verifyPassword('password123', DUMMY_HASH), false);
});

// --- Username and password rules ----------------------------------------------------------

test('usernames: 3–20 letters, digits, underscores', () => {
  for (const ok of ['abc', 'Alex_2026', 'x'.repeat(20)]) assert.equal(isValidUsername(ok), true, ok);
  for (const bad of ['ab', 'x'.repeat(21), 'has space', 'émile', 'a-b', '<b>hi</b>', '', null, 42]) {
    assert.equal(isValidUsername(bad), false, String(bad));
  }
});

test('passwords: 8–128 characters, counted like a person would', () => {
  assert.equal(isValidPassword('12345678'), true);
  assert.equal(isValidPassword('1234567'), false);
  assert.equal(isValidPassword('x'.repeat(128)), true);
  assert.equal(isValidPassword('x'.repeat(129)), false);
  assert.equal(isValidPassword('🔑'.repeat(8)), true, '8 emoji = 8 characters');
  assert.equal(isValidPassword(undefined), false);
});

// --- Users table ---------------------------------------------------------------------------

test('createUser + findUserForLogin; usernames are unique regardless of case', () => {
  const db = openDatabase(':memory:');
  const alex = createUser(db, 'Alex', 'scrypt$hash');
  assert.deepEqual(alex, { id: 1, username: 'Alex' });
  assert.equal(createUser(db, 'alex', 'scrypt$other'), null, 'taken, different case');
  assert.deepEqual(findUserForLogin(db, 'ALEX'), { id: 1, username: 'Alex', passwordHash: 'scrypt$hash' });
  assert.equal(findUserForLogin(db, 'nobody'), null);
});

test('usernames that look like SQL are just usernames', () => {
  const db = openDatabase(':memory:');
  const name = "x'; DROP TABLE users;--";
  createUser(db, name, 'h');
  assert.equal(findUserForLogin(db, name).username, name);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
});

// --- Sessions ----------------------------------------------------------------------------

test('sessions: a token identifies its user until it expires', () => {
  const db = openDatabase(':memory:');
  const user = createUser(db, 'Alex', 'h');
  const { token, expiresAt } = createSession(db, user.id, { days: 30, now: 1000 });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(expiresAt, 1000 + 30 * DAY);

  assert.deepEqual(getSessionUser(db, token, 2000), user);
  assert.equal(getSessionUser(db, token, expiresAt), null, 'expired at exactly expiresAt');
  assert.equal(getSessionUser(db, 'not-a-real-token', 2000), null);
  for (const bad of [undefined, '', 'x'.repeat(500), 42]) assert.equal(getSessionUser(db, bad, 2000), null);
});

test('the database stores only a hash of the session token', () => {
  const db = openDatabase(':memory:');
  const user = createUser(db, 'Alex', 'h');
  const { token } = createSession(db, user.id, { days: 1 });
  const rows = db.prepare('SELECT token_hash FROM sessions').all();
  assert.equal(rows.length, 1);
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(rows[0].token_hash, token);
});

test('deleteSession logs out one session; others keep working', () => {
  const db = openDatabase(':memory:');
  const user = createUser(db, 'Alex', 'h');
  const laptop = createSession(db, user.id, { days: 1 });
  const phone = createSession(db, user.id, { days: 1 });
  deleteSession(db, laptop.token);
  assert.equal(getSessionUser(db, laptop.token), null);
  assert.deepEqual(getSessionUser(db, phone.token), user);
});

test('deleteExpiredSessions removes only expired rows', () => {
  const db = openDatabase(':memory:');
  const user = createUser(db, 'Alex', 'h');
  createSession(db, user.id, { days: 1, now: 0 });
  const fresh = createSession(db, user.id, { days: 30, now: 0 });
  assert.equal(deleteExpiredSessions(db, 2 * DAY), 1);
  assert.deepEqual(getSessionUser(db, fresh.token, 2 * DAY), user);
});

test('deleting a user deletes their sessions (foreign key cascade)', () => {
  const db = openDatabase(':memory:');
  const user = createUser(db, 'Alex', 'h');
  const { token } = createSession(db, user.id, { days: 1 });
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  assert.equal(getSessionUser(db, token), null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
});

// --- Cookies ---------------------------------------------------------------------------------

test('parseCookies handles the usual and unusual shapes', () => {
  assert.deepEqual({ ...parseCookies('sid=abc; theme=dark') }, { sid: 'abc', theme: 'dark' });
  assert.deepEqual({ ...parseCookies('  sid = abc  ;') }, { sid: 'abc' });
  assert.deepEqual({ ...parseCookies('sid=first; sid=second') }, { sid: 'first' });
  assert.deepEqual({ ...parseCookies('data=a=b=c') }, { data: 'a=b=c' });
  assert.deepEqual({ ...parseCookies('novalue; =nameless; sid=x') }, { sid: 'x' });
  assert.deepEqual({ ...parseCookies(undefined) }, {});
  assert.deepEqual({ ...parseCookies('') }, {});
});

test('parseCookies: "__proto__" and "constructor" are ordinary cookie names', () => {
  const cookies = parseCookies('__proto__=x; constructor=y; sid=z');
  assert.equal(cookies.sid, 'z');
  assert.equal(cookies.__proto__, 'x');
  assert.equal(Object.getPrototypeOf(cookies), null);
  assert.equal({}.polluted, undefined);
});

test('session cookie flags', () => {
  assert.equal(
    sessionCookie('tok', { maxAgeSeconds: 60, secure: false }),
    'sid=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=60',
  );
  assert.match(sessionCookie('tok', { maxAgeSeconds: 60, secure: true }), /; Secure$/);
  assert.equal(clearedSessionCookie({ secure: false }), 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
});
