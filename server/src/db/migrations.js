// DATABASE MIGRATIONS: how the database's shape changes over time, without losing data.
//
// schema.sql creates the original tables (version 1, M7). Every later change is a
// migration below, numbered in order and never edited once it has shipped: a database
// that already ran migration 2 must never see a different migration 2.
//
// SQLite keeps a number in the file itself, `PRAGMA user_version`. On startup we run every
// migration numbered above it, each in a transaction (all of it happens, or none of it),
// and then store the new number. A brand-new database runs them all; an existing one only
// runs the ones it's missing. Adding a feature = adding a migration at the end.

/** @type {{ version: number, description: string, sql: string }[]} */
export const MIGRATIONS = [
  {
    version: 2,
    description: 'admin role (plan §11, A3)',
    sql: `ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 3,
    description: 'AI-generated games (plan §11, A3)',
    sql: `
      -- One row per generated game. The game's code is stored right here (not in the repo
      -- and not as a file), so it's backed up together with the accounts.
      CREATE TABLE generated_games (
        id            TEXT    PRIMARY KEY,   -- "g-..." chosen by the server; also the game's id
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        prompt        TEXT    NOT NULL,      -- the idea the game was generated from
        model         TEXT,                  -- which AI model wrote it
        status        TEXT    NOT NULL CHECK (status IN
                        ('generating', 'failed', 'review', 'playtest', 'published', 'rejected')),
        name          TEXT,                  -- from the game itself, once there is code
        description   TEXT,
        source        TEXT,                  -- the game's JavaScript; NULL until generated
        source_sha256 TEXT,                  -- fingerprint of exactly the code that was reviewed
        report_json   TEXT,                  -- the test harness report
        error         TEXT,                  -- why generation failed, if it did
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX generated_games_by_status ON generated_games (status);
    `,
  },
];

/** The version a fully up-to-date database has. */
export const LATEST_VERSION = MIGRATIONS.at(-1).version;

/**
 * Brings a database up to date. Safe to run on every start.
 * @param {import('better-sqlite3').Database} db  already has schema.sql applied (version 1)
 * @param {{ backupPath?: string, migrations?: typeof MIGRATIONS }} [opts]
 *   backupPath: if given and something needs migrating, a full copy of the database is
 *   saved there first, so a bad migration can be undone by hand.
 *   migrations: tests can pass their own list.
 * @returns {number[]} the versions that were applied (empty if already up to date)
 */
export function migrate(db, { backupPath, migrations = MIGRATIONS } = {}) {
  let current = db.pragma('user_version', { simple: true });
  if (current === 0) {
    // Made by schema.sql (or a database from before migrations existed): that's version 1.
    db.pragma('user_version = 1');
    current = 1;
  }
  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return [];

  if (backupPath) {
    // VACUUM INTO writes a complete, consistent copy of the database in one step.
    db.prepare('VACUUM INTO ?').run(backupPath);
  }
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  return pending.map((m) => m.version);
}
