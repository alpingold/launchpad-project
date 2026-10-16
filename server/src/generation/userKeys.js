import { saveGenaiKey, getGenaiKey, deleteGenaiKey } from '../db/genaiKeys.js';

// Users' own GenAI Studio API keys (plan §15): saving one (checked with GenAI Studio first),
// what the account page may show about it (only its last 4 characters), and opening it for
// a generation job. The key itself never goes back to the browser and is never logged.

const GENAI_BASE_URL = 'https://genai.rcac.purdue.edu/api';
/** Printable, no spaces; real keys are around 35 characters. */
const KEY_RE = /^[\x21-\x7e]{16,256}$/;
const CHECK_TIMEOUT_MS = 15_000;

/** A refusal the account page can show. */
export class KeyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Asks GenAI Studio whether this key works: its model list needs a valid key.
 * @param {string} key
 * @param {{ fetchFn?: typeof fetch, baseUrl?: string }} [opts]
 * @returns {Promise<'ok' | 'rejected' | 'unreachable'>}
 */
export async function checkGenaiKey(key, { fetchFn = fetch, baseUrl = GENAI_BASE_URL } = {}) {
  try {
    const res = await fetchFn(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.ok) return 'ok';
    return res.status === 401 || res.status === 403 ? 'rejected' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * @param {{ db: import('better-sqlite3').Database, vault: ReturnType<typeof import('../auth/keyVault.js').createKeyVault>,
 *   checkKey?: (key: string) => Promise<'ok' | 'rejected' | 'unreachable'> }} deps
 *   checkKey: tests pass a fake instead of calling GenAI Studio
 */
export function createUserKeys({ db, vault, checkKey = checkGenaiKey }) {
  return {
    /** What the account page shows. @returns {{ saved: boolean, last4: string | null, savedAt: number | null }} */
    status(userId) {
      const row = getGenaiKey(db, userId);
      return { saved: row !== null, last4: row?.last4 ?? null, savedAt: row?.createdAt ?? null };
    },

    /** Checks a key with GenAI Studio, then saves it encrypted. @param {unknown} key untrusted input */
    async save(userId, key) {
      const trimmed = typeof key === 'string' ? key.trim() : '';
      if (!KEY_RE.test(trimmed)) {
        throw new KeyError(400, 'INVALID_KEY', "That doesn't look like a GenAI Studio API key. Copy the whole key and paste it here.");
      }
      const verdict = await checkKey(trimmed);
      if (verdict === 'rejected') throw new KeyError(400, 'KEY_REJECTED', 'GenAI Studio says this key is not valid. Make a new one and try again.');
      if (verdict === 'unreachable') throw new KeyError(503, 'GENAI_UNREACHABLE', "Couldn't reach GenAI Studio to check the key. Try again in a minute.");
      saveGenaiKey(db, userId, { ...vault.seal(userId, trimmed), last4: trimmed.slice(-4) });
      return this.status(userId);
    },

    remove(userId) {
      deleteGenaiKey(db, userId);
    },

    /** The key itself, for a generation job, or null if there's none (or it can't be opened). */
    keyFor(userId) {
      const row = getGenaiKey(db, userId);
      if (!row) return null;
      try {
        return vault.open(userId, row);
      } catch {
        return null; // sealed with another secret (e.g. the secret file was lost): they save it again
      }
    },
  };
}
