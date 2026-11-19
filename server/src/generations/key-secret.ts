/**
 * Encrypting Creators' GenAI Studio keys (BUILD-PLAN Step 28, default 4). A key is encrypted with
 * AES-256-GCM under one secret: 32 random bytes in a file named by KEY_SECRET_FILE, kept on the
 * server, outside the database and its backups. So a stolen backup can't reveal a key; losing the
 * server loses the secret, and Creators enter their keys again.
 *
 * Each encryption uses a new random nonce, and the account's id as additional data, so a row copied
 * to another account fails to decrypt. GCM's tag makes any change to a row fail to decrypt too.
 *
 * Behind a small interface, so where the secret lives can change later without touching the rest.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

/** A key as it is stored. */
export interface SealedKey {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly tag: Uint8Array;
}

export interface KeySecret {
  seal(accountId: string, key: string): SealedKey;
  /** The key, or undefined if the row doesn't decrypt (another account's, changed, or another secret's). */
  open(accountId: string, sealed: SealedKey): string | undefined;
}

/** The secret's length: AES-256 takes a 32-byte key. */
export const SECRET_BYTES = 32;

export function keySecretFromBytes(secret: Uint8Array): KeySecret {
  if (secret.length !== SECRET_BYTES) throw new Error(`The key secret must be ${SECRET_BYTES} bytes, not ${secret.length}`);
  const bytes = Buffer.from(secret);
  return {
    seal(accountId, key) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", bytes, nonce);
      cipher.setAAD(Buffer.from(accountId, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
      return { ciphertext, nonce, tag: cipher.getAuthTag() };
    },
    open(accountId, sealed) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", bytes, sealed.nonce);
        decipher.setAAD(Buffer.from(accountId, "utf8"));
        decipher.setAuthTag(sealed.tag);
        return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
      } catch {
        // Only "it doesn't decrypt": the reason would say nothing a Creator can act on.
        return undefined;
      }
    },
  };
}

/**
 * The key secret the settings name: KEY_SECRET_FILE, a file holding the 32 bytes as 64 hexadecimal
 * characters (made with `openssl rand -hex 32`). Unset: none, and the AI maker is off. A file that
 * can't be read or doesn't hold exactly that stops the server from starting.
 */
export function keySecretFrom(env: Readonly<Record<string, string | undefined>>): KeySecret | null {
  const file = env["KEY_SECRET_FILE"] ?? "";
  if (file === "") return null;
  let text: string;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch (error) {
    throw new Error(`KEY_SECRET_FILE can't be read (${(error as NodeJS.ErrnoException).code ?? "error"})`);
  }
  if (!/^[0-9a-f]{64}$/i.test(text)) throw new Error("KEY_SECRET_FILE must hold 64 hexadecimal characters (32 bytes): make it with `openssl rand -hex 32`");
  return keySecretFromBytes(Buffer.from(text, "hex"));
}
