-- A Generation's busy retries (BUILD-PLAN Step 32, "A busy answer doesn't use up a call"). Every call
-- made to the model with the Creator's key is counted in model_calls before it is made. A call
-- GenAI Studio turned away as busy at once is given back (taken off model_calls) when its step ends,
-- and counted here instead.
--
-- The calls given back so: they have a cap of their own, so a busy GenAI Studio can't keep one going
-- without end. Rows from before this file get 0. The release before it still runs with the column
-- there: it names the columns it reads and writes.
--
-- This file has shipped once it is in a release: never edit it. A change is a new file.

ALTER TABLE generations ADD COLUMN busy_retries INTEGER NOT NULL DEFAULT 0 CHECK (busy_retries >= 0);
