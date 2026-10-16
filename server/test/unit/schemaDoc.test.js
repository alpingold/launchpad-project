import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeSchema, TABLE_NOTES } from '../../src/db/schemaDoc.js';
import { openDatabase } from '../../src/db/database.js';

// SCHEMA.md lists every table and column the database has today. It's generated, and these
// tests make sure nobody forgets: a new migration without `npm run schema` fails here.

test('SCHEMA.md is up to date (after changing the database, run: npm run schema)', () => {
  const committed = readFileSync(new URL('../../src/db/SCHEMA.md', import.meta.url), 'utf8');
  assert.equal(committed, describeSchema());
});

test('every table has a line saying what it is for (TABLE_NOTES in schemaDoc.js)', () => {
  const db = openDatabase(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
  db.close();
  for (const table of tables) assert.ok(TABLE_NOTES[table], `add a note for "${table}" to TABLE_NOTES`);
});
