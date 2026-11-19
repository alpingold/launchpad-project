-- Creators' GenAI Studio keys (BUILD-PLAN, "Milestone 3: the AI", "The data", and Step 28): one row
-- per account. The key itself is never stored, only encrypted with AES-256-GCM under a secret kept
-- in a file on the server (KEY_SECRET_FILE), outside this database and its backups, so a copy of
-- this file can't reveal a key. The encryption is bound to the account's id: a row moved to another
-- account won't decrypt.
--
-- This file only adds a table, so the release before it still runs against a database that has it.
-- This file has shipped once it is in a release: never edit it. A change is a new file.

CREATE TABLE genai_keys (
  account_id TEXT NOT NULL PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  -- The encrypted key, the nonce it was encrypted with (new and random each time), and GCM's tag,
  -- which makes any change to the other two fail to decrypt.
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL CHECK (length(nonce) = 12),
  tag BLOB NOT NULL CHECK (length(tag) = 16),
  -- The key's last 4 characters: all a page ever shows of it.
  last4 TEXT NOT NULL CHECK (length(last4) <= 4),
  saved_at INTEGER NOT NULL
) STRICT;
