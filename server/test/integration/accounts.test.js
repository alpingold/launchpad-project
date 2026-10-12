import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { postJson, cookieFrom } from '../helpers/accounts.js';

let server;
let baseUrl;

beforeEach(async () => {
  // Fixed attempt limit so the rate-limit test doesn't depend on the default.
  server = createGameServer({ AUTH_ATTEMPTS_PER_WINDOW: 10 });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});

afterEach(() => server.close());

const me = (cookie) =>
  fetch(`${baseUrl}/api/me`, { headers: cookie ? { Cookie: cookie } : {} }).then((res) => res.json());

test('sign up → logged in → log out → logged out', async () => {
  const res = await postJson(baseUrl, '/api/signup', { username: 'Alex', password: 'correct horse' });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { user: { id: 1, username: 'Alex' } });

  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /^sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const cookie = cookieFrom(res);
  assert.deepEqual(await me(cookie), { user: { id: 1, username: 'Alex' } });

  const out = await postJson(baseUrl, '/api/logout', {}, { Cookie: cookie });
  assert.equal(out.status, 204);
  assert.match(out.headers.get('set-cookie'), /^sid=; .*Max-Age=0/);
  assert.deepEqual(await me(cookie), { user: null }, 'the old cookie no longer works');
});

test('logged-out visitors get { user: null }', async () => {
  assert.deepEqual(await me(), { user: null });
  assert.deepEqual(await me('sid=made-up-token'), { user: null });
});

test('log in with the right password; capitalization of the username does not matter', async () => {
  await postJson(baseUrl, '/api/signup', { username: 'Alex', password: 'correct horse' });
  const res = await postJson(baseUrl, '/api/login', { username: 'alex', password: 'correct horse' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { user: { id: 1, username: 'Alex' } });
  assert.deepEqual(await me(cookieFrom(res)), { user: { id: 1, username: 'Alex' } });
});

test('wrong password and unknown user get the exact same answer', async () => {
  await postJson(baseUrl, '/api/signup', { username: 'Alex', password: 'correct horse' });
  const wrong = await postJson(baseUrl, '/api/login', { username: 'Alex', password: 'wrong horse!' });
  const unknown = await postJson(baseUrl, '/api/login', { username: 'Nobody', password: 'correct horse' });
  for (const res of [wrong, unknown]) {
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.deepEqual(await res.json(), { error: 'INVALID_CREDENTIALS', message: 'Wrong username or password.' });
  }
});

test('sign-up errors: invalid username, invalid password, taken username', async () => {
  const cases = [
    [{ username: 'ab', password: 'long enough' }, 400, 'INVALID_USERNAME'],
    [{ username: '<script>', password: 'long enough' }, 400, 'INVALID_USERNAME'],
    [{ username: 'Alex', password: 'short' }, 400, 'INVALID_PASSWORD'],
    [{ username: 'Alex', password: 'x'.repeat(129) }, 400, 'INVALID_PASSWORD'],
    [{ username: 'Alex' }, 400, 'INVALID_PASSWORD'],
    [{}, 400, 'INVALID_USERNAME'],
  ];
  for (const [body, status, error] of cases) {
    const res = await postJson(baseUrl, '/api/signup', body);
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal((await res.json()).error, error);
  }
  await postJson(baseUrl, '/api/signup', { username: 'Alex', password: 'long enough' });
  const taken = await postJson(baseUrl, '/api/signup', { username: 'ALEX', password: 'long enough' });
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).error, 'USERNAME_TAKEN');
});

test('POSTs that are not JSON are refused (CSRF protection)', async () => {
  // What a hidden form on another website would send.
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=Alex&password=correct+horse',
  });
  assert.equal(res.status, 415);
  assert.equal((await res.json()).error, 'JSON_REQUIRED');
});

test('too many failed logins from one address are blocked for a while', async () => {
  await postJson(baseUrl, '/api/signup', { username: 'Alex', password: 'correct horse' }); // 1 attempt
  for (let i = 0; i < 9; i++) {
    const res = await postJson(baseUrl, '/api/login', { username: 'Alex', password: `guess-${i}-guess` });
    assert.equal(res.status, 401);
  }
  // 10 attempts used (limit is 10): even the right password is refused now.
  const blocked = await postJson(baseUrl, '/api/login', { username: 'Alex', password: 'correct horse' });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'TOO_MANY_ATTEMPTS');
});

test('successful logins do not count toward the limit', async () => {
  await postJson(baseUrl, '/api/signup', { username: 'Alex', password: 'correct horse' });
  for (let i = 0; i < 10; i++) {
    const res = await postJson(baseUrl, '/api/login', { username: 'Alex', password: 'correct horse' });
    assert.equal(res.status, 200);
  }
});

test('passwords are stored hashed, never as typed', async () => {
  await postJson(baseUrl, '/api/signup', { username: 'Alex', password: 'correct horse' });
  const row = server.db.prepare('SELECT password_hash FROM users').get();
  assert.ok(!row.password_hash.includes('correct horse'));
  assert.match(row.password_hash, /^scrypt\$/);
});
