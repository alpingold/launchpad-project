// Users' own GenAI Studio API keys (plan §15), stored encrypted. This file only moves the
// sealed bytes in and out; sealing and opening is keyVault.js.

/**
 * Saves (or replaces) a user's key.
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {import('../auth/keyVault.js').SealedKey & { last4: string }} sealed
 */
export function saveGenaiKey(db, userId, { ciphertext, iv, tag, last4 }, now = Date.now()) {
  db.prepare(
    `INSERT INTO genai_keys (user_id, ciphertext, iv, tag, last4, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
       last4 = excluded.last4, created_at = excluded.created_at`,
  ).run(userId, ciphertext, iv, tag, last4, now);
}

/** @returns {(import('../auth/keyVault.js').SealedKey & { last4: string, createdAt: number }) | null} */
export function getGenaiKey(db, userId) {
  const row = db.prepare('SELECT ciphertext, iv, tag, last4, created_at FROM genai_keys WHERE user_id = ?').get(userId);
  return row ? { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, last4: row.last4, createdAt: row.created_at } : null;
}

/** @returns {boolean} whether there was one */
export function deleteGenaiKey(db, userId) {
  return db.prepare('DELETE FROM genai_keys WHERE user_id = ?').run(userId).changes === 1;
}
