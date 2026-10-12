// All SQL for the users table lives here. Every query uses "?" placeholders: the values
// are passed separately from the SQL text, so a username like "x'; DROP TABLE users;--"
// is just an odd username, never SQL (no SQL injection).

/**
 * @typedef {{ id: number, username: string }} User   safe to send to the browser
 */

/**
 * Creates an account.
 * @returns {User | null} the new user, or null if the username is taken (any capitalization)
 */
export function createUser(db, username, passwordHash, now = Date.now()) {
  try {
    const result = db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passwordHash, now);
    return { id: Number(result.lastInsertRowid), username };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
    throw err;
  }
}

/**
 * Looks up an account for logging in. Includes the password hash, so it must never be
 * sent to the browser as-is.
 * @returns {{ id: number, username: string, passwordHash: string } | null}
 */
export function findUserForLogin(db, username) {
  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : null;
}
