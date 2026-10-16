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
  {
    version: 4,
    description: 'game versions: change requests make new versions (plan §12e, K6)',
    sql: `
      -- One row per version of a generated game. Version 1 comes from the idea; every
      -- later one from a change request on an earlier version (based_on).
      CREATE TABLE game_versions (
        game_id       TEXT    NOT NULL REFERENCES generated_games(id) ON DELETE CASCADE,
        version       INTEGER NOT NULL,      -- 1, 2, 3, ... per game
        request       TEXT    NOT NULL,      -- v1: the idea; later: the change request
        based_on      INTEGER,               -- the version that was changed (NULL for v1)
        changelog     TEXT,                  -- the model's list of what it changed
        model         TEXT,
        status        TEXT    NOT NULL CHECK (status IN ('generating', 'failed', 'ready')),
        name          TEXT,
        description   TEXT,
        source        TEXT,
        source_sha256 TEXT,
        report_json   TEXT,
        error         TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (game_id, version)
      );

      -- Every existing game becomes its own version 1.
      INSERT INTO game_versions
        (game_id, version, request, model, status, name, description, source, source_sha256, report_json, error, created_at, updated_at)
      SELECT id, 1, prompt, model,
             CASE status WHEN 'generating' THEN 'generating' WHEN 'failed' THEN 'failed' ELSE 'ready' END,
             name, description, source, source_sha256, report_json, error, created_at, updated_at
      FROM generated_games;

      -- Which versions are live: one for everyone (published), one for the owner to try
      -- (playtest). NULL = none. A "rejected" game is simply one with neither.
      ALTER TABLE generated_games ADD COLUMN published_version INTEGER;
      ALTER TABLE generated_games ADD COLUMN playtest_version INTEGER;
      UPDATE generated_games SET published_version = 1 WHERE status = 'published';
      UPDATE generated_games SET playtest_version = 1 WHERE status = 'playtest';

      -- These now live on each version.
      DROP INDEX generated_games_by_status;
      ALTER TABLE generated_games DROP COLUMN status;
      ALTER TABLE generated_games DROP COLUMN model;
      ALTER TABLE generated_games DROP COLUMN name;
      ALTER TABLE generated_games DROP COLUMN description;
      ALTER TABLE generated_games DROP COLUMN source;
      ALTER TABLE generated_games DROP COLUMN source_sha256;
      ALTER TABLE generated_games DROP COLUMN report_json;
      ALTER TABLE generated_games DROP COLUMN error;
    `,
  },
  {
    version: 5,
    description: 'designs first: a version is designed, approved, then built (plan §13i, F5)',
    sql: `
      -- SQLite can't change a CHECK constraint, so the table is rebuilt with the new statuses
      -- and columns, and every row is copied across.
      --   designing    → the model is writing a design (or a change plan, or a new draft)
      --   design_ready → waiting for the admin: change it, edit it, or "Build it"
      --   generating   → building the code from the approved design
      CREATE TABLE game_versions_new (
        game_id         TEXT    NOT NULL REFERENCES generated_games(id) ON DELETE CASCADE,
        version         INTEGER NOT NULL,
        request         TEXT    NOT NULL,
        based_on        INTEGER,
        changelog       TEXT,
        model           TEXT,
        status          TEXT    NOT NULL CHECK (status IN ('designing', 'design_ready', 'generating', 'failed', 'ready')),
        design          TEXT,              -- the latest draft; once built, the design it was built from
        drafts_json     TEXT,              -- every draft: [{ text, by: 'ai' | 'admin', feedback?, at }]
        design_feedback TEXT,              -- what the admin asked to change, while a new draft is written
        name            TEXT,
        description     TEXT,
        source          TEXT,
        source_sha256   TEXT,
        report_json     TEXT,
        error           TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (game_id, version)
      );
      INSERT INTO game_versions_new
        (game_id, version, request, based_on, changelog, model, status, name, description, source, source_sha256, report_json, error, created_at, updated_at)
      SELECT game_id, version, request, based_on, changelog, model, status, name, description, source, source_sha256, report_json, error, created_at, updated_at
      FROM game_versions;
      DROP TABLE game_versions;
      ALTER TABLE game_versions_new RENAME TO game_versions;
    `,
  },
  {
    version: 6,
    description: 'every build attempt is kept (plan §13n)',
    sql: `
      -- One row per attempt at building a version: the code the model wrote and what the
      -- checks found. A version's own source and report are its LAST attempt; the earlier
      -- ones show how it got there (and are the "broken, then fixed" data of plan §13n).
      -- build: 1 for the first "Build it", 2 if it was built again after failing, and so on.
      CREATE TABLE build_attempts (
        game_id           TEXT    NOT NULL,
        version           INTEGER NOT NULL,
        build             INTEGER NOT NULL,
        attempt           INTEGER NOT NULL,
        ok                INTEGER NOT NULL,   -- 1: passed every check
        source            TEXT,               -- NULL if the reply had no game file
        report_json       TEXT,               -- the checks' report (without screenshots)
        seconds           INTEGER,            -- how long the model took
        prompt_tokens     INTEGER,
        completion_tokens INTEGER,
        created_at        INTEGER NOT NULL,
        PRIMARY KEY (game_id, version, build, attempt),
        FOREIGN KEY (game_id, version) REFERENCES game_versions(game_id, version) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 7,
    description: "users' own GenAI Studio keys, encrypted (plan §15, A7)",
    sql: `
      -- At most one key per account. Only the encrypted key is stored (server/src/auth/keyVault.js);
      -- the secret that opens it is not in this database. last4 is shown so people know which key it is.
      CREATE TABLE genai_keys (
        user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        ciphertext  BLOB    NOT NULL,
        iv          BLOB    NOT NULL,
        tag         BLOB    NOT NULL,
        last4       TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
      );
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
