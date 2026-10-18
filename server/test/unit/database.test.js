import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/db/database.js';
import { migrate, LATEST_VERSION, MIGRATIONS } from '../../src/db/migrations.js';
import { getGeneratedGame } from '../../src/db/generatedGames.js';
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
  assert.deepEqual(tables(db), ['build_attempts', 'game_pages', 'game_report_votes', 'game_reports', 'game_versions', 'game_votes', 'genai_keys', 'generated_games', 'sessions', 'site_reports', 'users']);
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
  assert.deepEqual(tables(db), ['build_attempts', 'game_pages', 'game_report_votes', 'game_reports', 'game_versions', 'game_votes', 'genai_keys', 'generated_games', 'sessions', 'site_reports', 'users']);
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

test('migration 4 (K6): every existing generated game becomes its own version 1, and stays live as it was', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 3) });
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'admin', 'scrypt$x', 1)").run();
  const insert = db.prepare(
    `INSERT INTO generated_games (id, owner_user_id, prompt, model, status, name, source, source_sha256, report_json, error, created_at, updated_at)
     VALUES (?, 1, 'an idea', 'qwen3.8:27b', ?, ?, ?, ?, ?, ?, 10, 20)`,
  );
  insert.run('g-generating', 'generating', null, null, null, null, null);
  insert.run('g-failed', 'failed', null, 'bad code', 'sha-bad', '{"ok":false}', 'no passing game');
  insert.run('g-review', 'review', 'Review Me', 'code', 'sha', '{"ok":true}', null);
  insert.run('g-playtest', 'playtest', 'Try Me', 'code', 'sha', '{"ok":true}', null);
  insert.run('g-published', 'published', 'Play Me', 'code', 'sha', '{"ok":true}', null);
  insert.run('g-rejected', 'rejected', 'Nope', 'code', 'sha', '{"ok":true}', null);

  assert.deepEqual(migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 4) }), [4]);
  const live = (id) => {
    const g = getGeneratedGame(db, id);
    return [g.versions[0].status, g.publishedVersion, g.playtestVersion];
  };
  assert.deepEqual(live('g-generating'), ['generating', null, null]);
  assert.deepEqual(live('g-failed'), ['failed', null, null]);
  assert.deepEqual(live('g-review'), ['ready', null, null]);
  assert.deepEqual(live('g-playtest'), ['ready', null, 1]);
  assert.deepEqual(live('g-published'), ['ready', 1, null]);
  assert.deepEqual(live('g-rejected'), ['ready', null, null], 'rejected = nothing live');

  const v1 = getGeneratedGame(db, 'g-failed').versions[0];
  assert.deepEqual(
    [v1.version, v1.request, v1.model, v1.source, v1.sourceSha256, v1.report, v1.error, v1.createdAt, v1.basedOn],
    [1, 'an idea', 'qwen3.8:27b', 'bad code', 'sha-bad', { ok: false }, 'no passing game', 10, null],
  );
  const columns = db.prepare('PRAGMA table_info(generated_games)').all().map((c) => c.name);
  assert.deepEqual(columns, ['id', 'owner_user_id', 'prompt', 'created_at', 'updated_at', 'published_version', 'playtest_version']);
});

test('migration 5 (F5): versions keep every field, and can now be designing or waiting on a design', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 4) });
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'admin', 'scrypt$x', 1)").run();
  db.prepare("INSERT INTO generated_games (id, owner_user_id, prompt, created_at, updated_at, published_version) VALUES ('g-old', 1, 'an idea', 1, 2, 1)").run();
  db.prepare(
    `INSERT INTO game_versions (game_id, version, request, based_on, changelog, model, status, name, description, source, source_sha256, report_json, error, created_at, updated_at)
     VALUES ('g-old', 1, 'an idea', NULL, '- x', 'qwen3.8:27b', 'ready', 'Old', 'An old game', 'code', 'sha', '{"ok":true}', NULL, 3, 4)`,
  ).run();

  assert.deepEqual(migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 5) }), [5]);
  const [v1] = getGeneratedGame(db, 'g-old').versions;
  assert.deepEqual(
    [v1.status, v1.name, v1.description, v1.source, v1.sourceSha256, v1.report, v1.changelog, v1.createdAt, v1.design, v1.drafts],
    ['ready', 'Old', 'An old game', 'code', 'sha', { ok: true }, '- x', 3, null, []],
  );
  db.prepare("UPDATE game_versions SET status = 'design_ready' WHERE game_id = 'g-old'").run();
  assert.throws(() => db.prepare("UPDATE game_versions SET status = 'dancing' WHERE game_id = 'g-old'").run(), /CHECK constraint/);
  db.prepare("DELETE FROM generated_games WHERE id = 'g-old'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_versions').get().n, 0, 'deleting a game still deletes its versions');
});

test('migration 9 (plan §23): earlier build attempts were whole files; the mode is checked', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF'); // only build_attempts matters here
  db.exec(SCHEMA);
  migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 8) });
  db.prepare("INSERT INTO build_attempts (game_id, version, build, attempt, ok, created_at) VALUES ('g-1', 1, 1, 1, 0, 5)").run();
  assert.deepEqual(migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 9) }), [9]);
  assert.equal(db.prepare('SELECT mode FROM build_attempts').pluck().get(), 'whole');
  assert.throws(() => db.prepare("UPDATE build_attempts SET mode = 'diff'").run(), /CHECK constraint failed/);
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
