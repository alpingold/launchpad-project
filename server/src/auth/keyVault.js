import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Keeps users' GenAI Studio API keys encrypted in the database (plan §15).
//
// AES-256-GCM: a standard cipher that also detects tampering. The secret it uses is NOT in
// the database (an env variable, or a file next to it), so a copy of the database alone
// reveals no keys. Each key is encrypted with a fresh random IV (never reused), and the
// user's id is bound in as "additional data": a row copied onto another account won't decrypt.

const SECRET_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM's standard size

/**
 * @typedef {{ ciphertext: Buffer, iv: Buffer, tag: Buffer }} SealedKey
 */

/**
 * @param {Buffer} secret  32 random bytes
 */
export function createKeyVault(secret) {
  if (!Buffer.isBuffer(secret) || secret.length !== SECRET_BYTES) throw new Error(`the key secret must be ${SECRET_BYTES} bytes`);
  const aad = (userId) => Buffer.from(`boilergames-genai-key:user:${userId}`);
  return {
    /** @returns {SealedKey} */
    seal(userId, apiKey) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      cipher.setAAD(aad(userId));
      const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
      return { ciphertext, iv, tag: cipher.getAuthTag() };
    },
    /** @returns {string} the key; throws if it was changed, moved to another user, or sealed with another secret */
    open(userId, { ciphertext, iv, tag }) {
      const decipher = createDecipheriv('aes-256-gcm', secret, iv);
      decipher.setAAD(aad(userId));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  };
}

/**
 * The server's key secret: GENAI_KEY_SECRET (base64 of 32 bytes) if set, else the file at
 * `file`, made with 32 random bytes the first time (readable only by this user). Losing
 * it only means everyone saves their key again.
 * @param {{ env?: string, file: string }} where
 * @returns {Buffer}
 */
export function loadKeySecret({ env = process.env.GENAI_KEY_SECRET, file }) {
  if (env) {
    const secret = Buffer.from(env, 'base64');
    if (secret.length !== SECRET_BYTES) throw new Error(`GENAI_KEY_SECRET must be ${SECRET_BYTES} bytes, base64`);
    return secret;
  }
  try {
    const secret = readFileSync(file);
    if (secret.length !== SECRET_BYTES) throw new Error(`${file} must hold ${SECRET_BYTES} bytes`);
    return secret;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const secret = randomBytes(SECRET_BYTES);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, secret, { mode: 0o600, flag: 'wx' }); // wx: never overwrite one that appeared meanwhile
  return secret;
}
