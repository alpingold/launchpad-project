-- Counted plays (BUILD-PLAN Step 18): how many times each Game has been played to its end, as one
-- number. No time, no Room and no person is kept: only the count.
--
-- `subject` is a Game's id, or `official:<name>` for an Official game, which has no row in `games`
-- (so there is no key to `games` here). The rules for what counts are in server/src/plays.ts.
--
-- This file only adds a table, so the release before it still runs against a database that has it.
-- This file has shipped once it is in a release: never edit it. A change is a new file.

CREATE TABLE plays (
  subject TEXT NOT NULL PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count >= 1)
) STRICT;
