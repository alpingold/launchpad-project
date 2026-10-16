-- BoilerGames database, VERSION 1 ONLY (M7): accounts and login sessions.
-- This file is never changed. Every table and column added since (AI-made games, their
-- versions and build attempts, GenAI Studio keys, game pages, votes, bios) comes from a
-- migration in migrations.js, which brings any database up to date on startup.
-- The whole schema as it is today: SCHEMA.md (generated: npm run schema).
-- Rooms and running games are not stored at all; they live in memory and last minutes.
-- Every statement is "IF NOT EXISTS", so this runs safely on every server start.

-- One row per host account.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  -- COLLATE NOCASE: "Alex" and "alex" count as the same username.
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  -- "scrypt$N$r$p$salt$hash": the settings are stored with the hash so they can be
  -- made stronger later without breaking existing accounts. Never the password itself.
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL  -- ms since 1970 (Date.now())
);

-- One row per logged-in browser. The cookie holds a random token; we store only its
-- SHA-256 hash, so someone who reads the database still can't log in as anyone.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);
