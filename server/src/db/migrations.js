// DATABASE MIGRATIONS: how the database's shape changes over time, without losing data.
//
// schema.sql creates the original tables (version 1, M7). Every later change is a
// migration below, numbered in order and never edited once it has shipped: a database
// that already ran migration 2 must never see a different migration 2.
//
// SQLite keeps a number in the file itself, `PRAGMA user_version`. On startup we run every
// migration numbered above it, each in a transaction (all of it happens, or none of it),
// and then store the new number. A brand-new database runs them all; an existing one only
// runs the ones it's missing. Adding a feature = adding a migration at the end, then
// `npm run schema` to update SCHEMA.md (the whole schema in one place; a test checks it).

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
  {
    version: 8,
    description: 'catalogue entries, votes and bios (plan §16)',
    sql: `
      -- What a game's creator (or an admin) changed about how it's shown in the catalogue. Never
      -- the game file itself. game_id is an official game's id or a generated game's id
      -- ("g-..."), so there's no foreign key; deleting a generated game deletes its row too.
      -- NULL: use what the game file says.
      CREATE TABLE game_pages (
        game_id      TEXT    PRIMARY KEY,
        name         TEXT,
        description  TEXT,
        about        TEXT,
        tags_json    TEXT,
        minutes_json TEXT,
        main_shot    TEXT    CHECK (main_shot IN ('host', 'phone')),
        updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at   INTEGER NOT NULL
      );

      -- One vote per account per game: +1 or -1. Taking a vote back deletes its row.
      CREATE TABLE game_votes (
        game_id    TEXT    NOT NULL,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        value      INTEGER NOT NULL CHECK (value IN (-1, 1)),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, user_id)
      );

      -- A few words about yourself, for your profile page (/u/<username>).
      ALTER TABLE users ADD COLUMN bio TEXT;
    `,
  },
  {
    version: 9,
    description: 'how each build attempt was written: whole file or edits (plan §23)',
    sql: `
      -- 'whole': the model wrote the whole game file; 'edits': it sent changes to the last
      -- file (plan §23), which the generator applied. Every attempt before this migration
      -- was a whole file, so they're marked that way.
      ALTER TABLE build_attempts ADD COLUMN mode TEXT CHECK (mode IN ('whole', 'edits'));
      UPDATE build_attempts SET mode = 'whole';
    `,
  },
  {
    version: 10,
    description: 'bug reports: from the site-wide form, and on each game page with votes (plan §31)',
    sql: `
      -- Sent from the /report form. Anyone may send one, so user_id is NULL when logged out
      -- (or once the account is deleted). page: where the form was opened from; device: e.g.
      -- "iPhone · Safari". done_at: when an admin marked it dealt with.
      CREATE TABLE site_reports (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        kind       TEXT    NOT NULL CHECK (kind IN ('bug', 'idea', 'other')),
        page       TEXT,
        body       TEXT    NOT NULL,
        device     TEXT,
        done_at    INTEGER,
        created_at INTEGER NOT NULL
      );

      -- Posted on a game's page. game_id is an official game's id or a generated game's id,
      -- so there's no foreign key (like game_pages); deleting a generated game deletes its
      -- reports. fixed_at: when the game's creator or an admin marked it fixed.
      CREATE TABLE game_reports (
        id         INTEGER PRIMARY KEY,
        game_id    TEXT    NOT NULL,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       TEXT    NOT NULL,
        device     TEXT,
        fixed_at   INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX game_reports_by_game ON game_reports (game_id);

      -- One vote per account per report, +1 or -1 (like game_votes). A report's total is the
      -- sum, worked out when the list is read, so it can never drift.
      CREATE TABLE game_report_votes (
        report_id INTEGER NOT NULL REFERENCES game_reports(id) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        value     INTEGER NOT NULL CHECK (value IN (-1, 1)),
        PRIMARY KEY (report_id, user_id)
      );
    `,
  },
  {
    version: 11,
    description: 'asking for a game to be published, and the admin sending it back (plan §44)',
    sql: `
      -- submitted_version: the playtest version its creator asked to publish (NULL: not
      -- asked). review_note: why an admin sent it back, shown to the creator until they ask
      -- again. Times are in ms.
      ALTER TABLE generated_games ADD COLUMN submitted_version INTEGER;
      ALTER TABLE generated_games ADD COLUMN submitted_at INTEGER;
      ALTER TABLE generated_games ADD COLUMN review_note TEXT;
      ALTER TABLE generated_games ADD COLUMN reviewed_at INTEGER;
    `,
  },
  {
    version: 12,
    description: 'the code review after every build, and "Review again" versions (plan §47)',
    sql: `
      -- code_review_json: what the AI reviewer found in this version's code, and what it fixed,
      -- for the game's creator (NULL: not reviewed). kind 'recheck': a version made by "Review
      -- again" (another review round on the version it's based on); NULL: any other version.
      ALTER TABLE game_versions ADD COLUMN code_review_json TEXT;
      ALTER TABLE game_versions ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind = 'recheck');
    `,
  },
  {
    version: 13,
    description: 'no more asking an admin to publish: creators publish their own games (plan §49)',
    sql: `
      ALTER TABLE generated_games DROP COLUMN submitted_version;
      ALTER TABLE generated_games DROP COLUMN submitted_at;
      ALTER TABLE generated_games DROP COLUMN review_note;
      ALTER TABLE generated_games DROP COLUMN reviewed_at;
    `,
  },
  {
    version: 14,
    description: 'remixes: a game copied from another to change (plan §45)',
    sql: `
      -- remix_of: the game it was copied from (an official game's id or "g-..."; no foreign key:
      -- the original may be deleted later, and its remixes stay). remix_of_version: which of
      -- its versions (NULL for an official game). remix_of_name: its name then, for the credit
      -- line once the original isn't public any more.
      ALTER TABLE generated_games ADD COLUMN remix_of TEXT;
      ALTER TABLE generated_games ADD COLUMN remix_of_version INTEGER;
      ALTER TABLE generated_games ADD COLUMN remix_of_name TEXT;
      -- allow_remix: its creator lets others remix it (the default). Turning it off stops new
      -- remixes only.
      ALTER TABLE game_pages ADD COLUMN allow_remix INTEGER NOT NULL DEFAULT 1 CHECK (allow_remix IN (0, 1));
    `,
  },
  {
    version: 15,
    description: 'a remix\'s own design: "Make it your own" versions (plan §45b)',
    sql: `
      -- kind 'remix': a version made by "Make it your own": a whole design of the remixed game
      -- (not a change plan), then the copy's code rewritten for it. A column's CHECK can't be
      -- changed in place: the column is swapped for a new one.
      ALTER TABLE game_versions RENAME COLUMN kind TO kind_before_15;
      ALTER TABLE game_versions ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind IN ('recheck', 'remix'));
      UPDATE game_versions SET kind = kind_before_15;
      ALTER TABLE game_versions DROP COLUMN kind_before_15;
    `,
  },
  {
    version: 16,
    description: 'uploaded game files (plan §57)',
    sql: `
      -- kind 'upload': a game file its owner uploaded (written by hand, or with an AI of their own),
      -- checked like a build but never written by the site's AI.
      ALTER TABLE game_versions RENAME COLUMN kind TO kind_before_16;
      ALTER TABLE game_versions ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind IN ('recheck', 'remix', 'upload'));
      UPDATE game_versions SET kind = kind_before_16;
      ALTER TABLE game_versions DROP COLUMN kind_before_16;
    `,
  },
  {
    version: 17,
    description: "site reports about a game's content (plan §57)",
    sql: `
      -- kind 'content': a game that's offensive or harmful (anyone can upload one now).
      ALTER TABLE site_reports RENAME COLUMN kind TO kind_before_17;
      ALTER TABLE site_reports ADD COLUMN kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('bug', 'idea', 'content', 'other'));
      UPDATE site_reports SET kind = kind_before_17;
      ALTER TABLE site_reports DROP COLUMN kind_before_17;
    `,
  },
  {
    version: 18,
    description: "a remix remembers how its original was made (plan §60)",
    sql: `
      -- 'ai' or 'upload', at the time of the remix, like remix_of_name: the copy's label ("AI-made",
      -- "Uploaded") without its version pretending to be an upload of its own.
      ALTER TABLE generated_games ADD COLUMN remix_of_made_by TEXT CHECK (remix_of_made_by IS NULL OR remix_of_made_by IN ('ai', 'upload'));
      UPDATE generated_games SET remix_of_made_by = 'upload'
        WHERE remix_of IS NOT NULL AND EXISTS (SELECT 1 FROM game_versions v WHERE v.game_id = generated_games.id AND v.version = 1 AND v.kind = 'upload');
      UPDATE game_versions SET kind = NULL
        WHERE version = 1 AND kind = 'upload' AND game_id IN (SELECT id FROM generated_games WHERE remix_of IS NOT NULL);
    `,
  },
  {
    version: 19,
    description: 'games played: every game that ends in a room, finished or stopped',
    sql: `
      -- One row per game that ended. game_id is an official game's id or a generated game's id
      -- (every version shares it), so there's no foreign key, like game_pages; deleting a
      -- generated game deletes its rows. Nothing about the players.
      CREATE TABLE game_plays (
        id       INTEGER PRIMARY KEY,
        game_id  TEXT    NOT NULL,
        version  INTEGER,               -- which version was played (NULL: an official game)
        stopped  TEXT    CHECK (stopped IS NULL OR stopped IN ('host', 'reload', 'unresponsive', 'broken')), -- NULL: the big screen ended it
        ended_at INTEGER NOT NULL
      );
      CREATE INDEX game_plays_by_game ON game_plays (game_id);
    `,
  },
  {
    version: 20,
    description: 'how often edits fail to apply and calls end with no reply: kept with each build attempt',
    sql: `
      -- What the generator knew about each call, for "npm run admin -- edit-stats". NULL: not
      -- recorded (an attempt from before this, or an upload's check, which calls no model).
      -- model: the model asked. fix: 1 if the call asked to fix an earlier attempt (or was the
      -- review's fix). no_reply: 1 if the model wrote nothing (it ran out of room while
      -- thinking). edits_applied: for an 'edits' reply only, 1 if its edits fit the file.
      ALTER TABLE build_attempts ADD COLUMN model TEXT;
      ALTER TABLE build_attempts ADD COLUMN fix INTEGER;
      ALTER TABLE build_attempts ADD COLUMN no_reply INTEGER;
      ALTER TABLE build_attempts ADD COLUMN edits_applied INTEGER;
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
