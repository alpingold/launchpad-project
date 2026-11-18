-- Games and their Versions (docs/BUILD-PLAN.md, "The data, in one place"). Times are whole seconds
-- since 1970, in UTC. Ids are random text, never a counter.
--
-- This file has shipped once it is in a release: never edit it. A change is a new file.

CREATE TABLE games (
  id TEXT NOT NULL PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts (id),
  -- The one thing the Creator types. The title, Player count and Look are the published Version's
  -- `about`, read from its code.
  description TEXT NOT NULL DEFAULT '',
  -- The Version people can play, or none. It must be one of this Game's own Versions (the key
  -- below); that it is `ready` is the server's rule.
  published_version_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (published_version_id, id) REFERENCES versions (id, game_id)
) STRICT;

CREATE INDEX games_by_owner ON games (owner_id);

CREATE TABLE versions (
  id TEXT NOT NULL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games (id),
  -- 1, 2, 3... within its Game.
  number INTEGER NOT NULL CHECK (number >= 1),
  -- How it was made: 'upload' for now; milestone 3 adds the AI's ways. The server's row schema
  -- checks the value, not the table: SQLite can't widen a CHECK without rebuilding the table.
  made_by TEXT NOT NULL,
  source TEXT NOT NULL,
  -- checking, then ready or failed, and never changed after that (the trigger below).
  state TEXT NOT NULL CHECK (state IN ('checking', 'ready', 'failed')),
  -- Every problem the Playtest found, as a JSON list. A failed Version always has them.
  problems TEXT CHECK (problems IS NULL OR json_valid(problems)),
  -- The built code a Room loads. Only a ready Version has one.
  bundle TEXT,
  -- The code's own `about` (title, Player count, Look), as JSON. A ready Version always has it.
  about TEXT CHECK (about IS NULL OR json_valid(about)),
  -- 'v1'. Checked by the server's row schema, like made_by, so a v2 needs no table rebuild.
  sdk_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- When the Playtest finished with it.
  checked_at INTEGER,
  UNIQUE (game_id, number),
  -- What the games table's key above points at.
  UNIQUE (id, game_id),
  CHECK ((state = 'ready') = (bundle IS NOT NULL)),
  CHECK (state <> 'ready' OR about IS NOT NULL),
  CHECK (state <> 'failed' OR problems IS NOT NULL),
  CHECK ((state = 'checking') = (checked_at IS NULL))
) STRICT;

-- A Version's verdict is final: one that is ready or failed never changes state again.
CREATE TRIGGER versions_verdict_is_final
BEFORE UPDATE OF state ON versions
WHEN OLD.state <> 'checking' AND NEW.state <> OLD.state
BEGIN
  SELECT RAISE(ABORT, 'a Version that is ready or failed never changes state');
END;
