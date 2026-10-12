import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * Opens (or creates) the SQLite database and makes sure the tables exist.
 *
 * better-sqlite3 is synchronous: a query returns its result directly instead of a Promise.
 * For a small app with one server process that's simpler to read, and SQLite answers in
 * microseconds from a local file, so it doesn't hold the server up.
 *
 * @param {string} file  a file path, or ':memory:' for a temporary database (tests)
 */
export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON'); // enforce REFERENCES (deleting a user deletes their sessions)
  if (file !== ':memory:') db.pragma('journal_mode = WAL'); // safer, faster writes for a file DB
  db.exec(SCHEMA);
  return db;
}
