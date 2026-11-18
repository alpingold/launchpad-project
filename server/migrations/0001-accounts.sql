-- Accounts, the links that sign them in, and their sessions (docs/BUILD-PLAN.md, "The data, in one
-- place"). Times are whole seconds since 1970, in UTC. Ids are random text, never a counter.
-- A token is never stored, only its SHA-256 hash, so a copy of this file can't sign anyone in.
--
-- This file has shipped once it is in a release: never edit it. A change is a new file.

CREATE TABLE accounts (
  id TEXT NOT NULL PRIMARY KEY,
  -- Trimmed and in lower case, so one address can't make two accounts.
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  -- What other people see. None until the account picks one.
  display_name TEXT,
  -- The display name folded to lower case, which is what must be unique: "Ada" and "ada" can't
  -- both exist. SQLite's own NOCASE folds only A to Z, so the server folds it and stores it here.
  display_name_key TEXT UNIQUE,
  admin INTEGER NOT NULL DEFAULT 0 CHECK (admin IN (0, 1)),
  created_at INTEGER NOT NULL,
  CHECK ((display_name IS NULL) = (display_name_key IS NULL))
) STRICT;

CREATE TABLE sign_in_links (
  token_hash TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Set when the link signs someone in. A link works once.
  used_at INTEGER
) STRICT;

CREATE INDEX sign_in_links_by_expiry ON sign_in_links (expires_at);

CREATE TABLE sessions (
  token_hash TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  -- 90 days after it was last seen: each use moves it on.
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_by_account ON sessions (account_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);
