import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * Opens (or creates) the SQLite database, makes sure the tables exist, and runs any
 * migrations it hasn't had yet (see migrations.js).
 *
 * better-sqlite3 is synchronous: a query returns its result directly instead of a Promise.
 * For a small app with one server process that's simpler to read, and SQLite answers in
 * microseconds from a local file, so it doesn't hold the server up.
 *
 * @param {string} file  a file path, or ':memory:' for a temporary database (tests)
 */
export function openDatabase(file) {
  const isFile = file !== ':memory:';
  const existed = isFile && existsSync(file);
  if (isFile) mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON'); // enforce REFERENCES (deleting a user deletes their sessions)
  if (isFile) db.pragma('journal_mode = WAL'); // safer, faster writes for a file DB
  db.exec(SCHEMA);
  // Before changing an existing database file, keep a copy next to it. (A brand-new file
  // has nothing to lose, and tests use :memory:.)
  const backupPath = existed ? `${file}.backup-${Date.now()}` : undefined;
  const applied = migrate(db, { backupPath });
  if (applied.length > 0 && backupPath) {
    console.log(`[db] migrated to version ${applied.at(-1)}; the previous database was saved as ${backupPath}`);
  }
  return db;
}
