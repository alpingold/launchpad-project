-- What 0006-generations.sql gained after it had shipped (BUILD-PLAN, "Milestone 3: the AI", "The
-- data"). The live database applied 0006 as it was in release 19ab53f, so these were edited into a
-- file it had already applied, and no release with that edit could start. They come here instead.
--
-- counted: whether a Generation counts against its account's daily limit. 0 only for one that failed
-- for nothing its Creator did (GenAI Studio busy or down, the site's own check or code failing).
-- Rows from before this file get 1: each of them counted. In 0006 the rule "only a failed one can
-- be uncounted" was a check on the whole table; SQLite can't add one of those to a table that
-- exists, so it rides on the column instead (a column's check may name another column).
--
-- generations.reason: since 0006 shipped it also holds, while in review, why a new draft the Creator
-- asked for didn't come. The column is unchanged; only what it may say grew.
--
-- This file only adds a column and an index, so the release before it still runs with them there:
-- it names the columns it writes, and a new row it makes gets counted = 1.
--
-- This file has shipped once it has been pushed: never edit it. A change is a new file.

ALTER TABLE generations ADD COLUMN counted INTEGER NOT NULL DEFAULT 1 CHECK (counted IN (0, 1) AND (counted = 1 OR state = 'failed'));

-- The Generation or Revision that made a Version: the Concept a Revision of it is held to.
CREATE INDEX generations_by_version ON generations (version_id);
