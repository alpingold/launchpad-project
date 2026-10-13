import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/database.js';
import { migrate, LATEST_VERSION } from '../../src/db/migrations.js';
import { createUser, setAdmin, listUsers, findUserForLogin } from '../../src/db/users.js';
import { createSession, getSessionUser } from '../../src/db/sessions.js';

// Migrations (plan §11, A3): the database file changes shape over time without losing data.

const SCHEMA = readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8');
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'boilergames-db-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a new database gets every table and the latest version', () => {
  const db = openDatabase(':memory:');
  assert.equal(db.pragma('user_version', { simple: true }), LATEST_VERSION);
  assert.deepEqual(tables(db), ['generated_games', 'sessions', 'users']);
});

test('an existing pre-migration database (like the one from M7) is upgraded, keeping its data, with a backup', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'boilergames.db');
  // Build a database exactly as M7 left it: schema.sql only, user_version 0, one account.
  const old = new Database(file);
  old.exec(SCHEMA);
  old.prepare("INSERT INTO users (username, password_hash, created_at) VALUES ('alpingold', 'scrypt$x', 1)").run();
  old.close();

  t.mock.method(console, 'log', () => {});
  const db = openDatabase(file);
  assert.equal(db.pragma('user_version', { simple: true }), LATEST_VERSION);
  assert.deepEqual(listUsers(db), [{ id: 1, username: 'alpingold', isAdmin: false, createdAt: 1 }]);
  assert.deepEqual(tables(db), ['generated_games', 'sessions', 'users']);
  db.close();

  // The copy made before migrating is the old database, untouched.
  const backups = readdirSync(dir).filter((f) => f.includes('.backup-'));
  assert.equal(backups.length, 1);
  const backup = new Database(path.join(dir, backups[0]), { readonly: true });
  assert.equal(backup.pragma('user_version', { simple: true }), 1, 'the M7 database, labelled version 1');
  assert.deepEqual(tables(backup), ['sessions', 'users']);
  backup.close();

  // Opening it again changes nothing and makes no new backup.
  openDatabase(file).close();
  assert.equal(readdirSync(dir).filter((f) => f.includes('.backup-')).length, 1);
});

test('a brand-new database file gets no (pointless) backup', (t) => {
  const dir = tempDir(t);
  openDatabase(path.join(dir, 'new.db')).close();
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.backup-')), []);
});

test('a migration that fails is rolled back completely and stops the later ones', () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  const migrations = [
    { version: 2, description: 'fine', sql: 'CREATE TABLE a (x INTEGER);' },
    { version: 3, description: 'broken halfway', sql: 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL;' },
    { version: 4, description: 'never reached', sql: 'CREATE TABLE c (x INTEGER);' },
  ];
  assert.throws(() => migrate(db, { migrations }), /syntax error/);
  assert.equal(db.pragma('user_version', { simple: true }), 2, 'version 2 stays; 3 is undone');
  assert.deepEqual(tables(db), ['a', 'sessions', 'users'], 'no table b (rolled back), no table c');
});

test('admin flag: off by default, granted and revoked by username, visible on the logged-in user', () => {
  const db = openDatabase(':memory:');
  const alex = createUser(db, 'Alex', 'scrypt$x');
  assert.equal(alex.isAdmin, false);
  const { token } = createSession(db, alex.id, { days: 1 });

  assert.equal(setAdmin(db, 'alex', true), true, 'username match ignores capitalization');
  assert.equal(getSessionUser(db, token).isAdmin, true);
  assert.equal(findUserForLogin(db, 'Alex').isAdmin, true);
  assert.equal(setAdmin(db, 'Alex', false), true);
  assert.equal(getSessionUser(db, token).isAdmin, false);
  assert.equal(setAdmin(db, 'nobody', true), false);
});
