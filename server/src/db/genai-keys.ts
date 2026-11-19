/**
 * The queries about Creators' GenAI Studio keys (0005-genai-keys.sql). With database.ts, the only file
 * with SQL about them. Only the encrypted key goes in or comes out here; key-secret.ts encrypts it.
 */
import { z } from "zod";
import type { SealedKey } from "../generations/key-secret.js";
import type { Database } from "./database.js";
import { one } from "./rows.js";

export interface StoredKey {
  readonly sealed: SealedKey;
  readonly last4: string;
  readonly savedAt: number;
}

const bytes = z.instanceof(Uint8Array);
const keyRow = z
  .object({ ciphertext: bytes, nonce: bytes, tag: bytes, last4: z.string(), saved_at: z.number().int() })
  .transform((row): StoredKey => ({ sealed: { ciphertext: row.ciphertext, nonce: row.nonce, tag: row.tag }, last4: row.last4, savedAt: row.saved_at }));

/** Saves the account's key, replacing any it had. */
export function saveKey(db: Database, accountId: string, stored: StoredKey): void {
  db.prepare(
    "INSERT INTO genai_keys (account_id, ciphertext, nonce, tag, last4, saved_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET ciphertext = excluded.ciphertext, nonce = excluded.nonce, tag = excluded.tag, last4 = excluded.last4, saved_at = excluded.saved_at",
  ).run(accountId, stored.sealed.ciphertext, stored.sealed.nonce, stored.sealed.tag, stored.last4, stored.savedAt);
}

export function storedKey(db: Database, accountId: string): StoredKey | undefined {
  return one(keyRow, db.prepare("SELECT ciphertext, nonce, tag, last4, saved_at FROM genai_keys WHERE account_id = ?").get(accountId));
}

export function deleteKey(db: Database, accountId: string): void {
  db.prepare("DELETE FROM genai_keys WHERE account_id = ?").run(accountId);
}
