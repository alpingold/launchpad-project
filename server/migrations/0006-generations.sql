-- Generations and Revisions, and every step each one took (BUILD-PLAN, "Milestone 3: the AI", "The
-- data", and Step 32). A Generation turns a Creator's idea into a Game; a Revision changes one. The
-- rows are the truth: a restart finds each one where it was and carries on from the start of that
-- stage. Times are whole seconds since 1970, in UTC. Ids are random text, never a counter.
--
-- This file only adds tables, so the release before it still runs against a database that has it.
-- This file has shipped once it is in a release: never edit it. A change is a new file.

CREATE TABLE generations (
  id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  kind TEXT NOT NULL CHECK (kind IN ('generation', 'revision')),
  -- The Game: none for a Generation until its Build passes; a Revision's from the start.
  game_id TEXT REFERENCES games (id),
  -- A Revision's: the Version of the Game it changes.
  base_version_id TEXT REFERENCES versions (id),
  -- The Creator's idea (a Generation) or request (a Revision), as they wrote it.
  idea TEXT NOT NULL,
  -- concept (the AI drafts) -> review (the Creator approves) -> build -> playtest -> build... or
  -- ready; from any of them, failed or cancelled, which are final (the trigger below).
  state TEXT NOT NULL CHECK (state IN ('concept', 'review', 'build', 'playtest', 'ready', 'failed', 'cancelled')),
  -- The Concept, as JSON: the AI's draft, then what the Creator approved.
  concept TEXT CHECK (concept IS NULL OR json_valid(concept)),
  -- What the Creator asked to change when they sent a Concept back for a new draft, until it is drafted.
  note TEXT,
  -- The latest file the AI wrote, and where the Build stands: which Build, and type fixes in it.
  code TEXT,
  builds INTEGER NOT NULL DEFAULT 0 CHECK (builds >= 0),
  type_fixes INTEGER NOT NULL DEFAULT 0 CHECK (type_fixes >= 0),
  -- Every call made to the model with the Creator's key, written before each call is made.
  model_calls INTEGER NOT NULL DEFAULT 0 CHECK (model_calls >= 0),
  -- The Version it made, once ready.
  version_id TEXT REFERENCES versions (id),
  -- Why it failed or was cancelled, for the Creator.
  reason TEXT,
  -- While GenAI Studio is busy or down: why ('rateLimited' or 'unavailable') and until when it waits.
  waiting_why TEXT CHECK (waiting_why IS NULL OR waiting_why IN ('rateLimited', 'unavailable')),
  waiting_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((state = 'ready') = (version_id IS NOT NULL)),
  CHECK (state NOT IN ('failed', 'cancelled') OR reason IS NOT NULL),
  CHECK (kind = 'generation' OR (game_id IS NOT NULL AND base_version_id IS NOT NULL)),
  CHECK ((waiting_why IS NULL) = (waiting_until IS NULL))
) STRICT;

CREATE INDEX generations_by_account ON generations (account_id, created_at);
CREATE INDEX generations_by_state ON generations (state);

-- Ready, failed and cancelled are final.
CREATE TRIGGER generations_end_is_final
BEFORE UPDATE OF state ON generations
WHEN OLD.state IN ('ready', 'failed', 'cancelled') AND NEW.state <> OLD.state
BEGIN
  SELECT RAISE(ABORT, 'a Generation that is ready, failed or cancelled never changes state');
END;

CREATE TABLE generation_steps (
  generation_id TEXT NOT NULL REFERENCES generations (id) ON DELETE CASCADE,
  -- 1, 2, 3... within its Generation.
  number INTEGER NOT NULL CHECK (number >= 1),
  -- What it was: drafting a Concept, a Build, a type fix (each a call to the model), or a Playtest.
  kind TEXT NOT NULL CHECK (kind IN ('concept', 'build', 'typeFix', 'playtest')),
  began_at INTEGER NOT NULL,
  -- Written when it ends. A step with none was cut short by a restart.
  ended_at INTEGER,
  -- How it came out: passed, problems, noCode, invalid, modelFailed, checkFailed, interrupted...
  outcome TEXT,
  -- Every problem found, as a JSON list.
  problems TEXT CHECK (problems IS NULL OR json_valid(problems)),
  PRIMARY KEY (generation_id, number),
  CHECK ((ended_at IS NULL) = (outcome IS NULL))
) STRICT;
