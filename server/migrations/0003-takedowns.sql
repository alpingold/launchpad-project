-- When an admin took a Game down (BUILD-PLAN Step 14, "An admin may unpublish any Game"), in whole
-- seconds since 1970, UTC; NULL while nobody has. While it is set the Game can't be published: the
-- Creator can't undo a takedown by publishing again. Only an admin clears it.
--
-- This file has shipped once it is in a release: never edit it. A change is a new file.

ALTER TABLE games ADD COLUMN taken_down_at INTEGER;
