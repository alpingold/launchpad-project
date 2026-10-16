// All SQL for the users table lives here. Every query uses "?" placeholders: the values
// are passed separately from the SQL text, so a username like "x'; DROP TABLE users;--"
// is just an odd username, never SQL (no SQL injection).

/**
 * @typedef {{ id: number, username: string, isAdmin: boolean }} User   safe to send to the browser
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
    return { id: Number(result.lastInsertRowid), username, isAdmin: false };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
    throw err;
  }
}

/**
 * Looks up an account for logging in. Includes the password hash, so it must never be
 * sent to the browser as-is.
 * @returns {(User & { passwordHash: string }) | null}
 */
export function findUserForLogin(db, username) {
  const row = db.prepare('SELECT id, username, password_hash, is_admin FROM users WHERE username = ?').get(username);
  return row ? { id: row.id, username: row.username, isAdmin: row.is_admin === 1, passwordHash: row.password_hash } : null;
}

/**
 * Makes an account an admin, or takes that away. Admins can generate games (plan §11).
 * There's no web page for this on purpose: only someone with access to the server can
 * run `npm run admin -- grant <username>`.
 * @returns {boolean} false if there's no such user
 */
export function setAdmin(db, username, isAdmin) {
  return db.prepare('UPDATE users SET is_admin = ? WHERE username = ?').run(isAdmin ? 1 : 0, username).changes === 1;
}

/** A public profile (plan §16), by username (any capitalization). @returns {{ id: number, username: string, bio: string, createdAt: number } | null} */
export function getProfile(db, username) {
  const row = db.prepare('SELECT id, username, bio, created_at FROM users WHERE username = ?').get(username);
  return row ? { id: row.id, username: row.username, bio: row.bio ?? '', createdAt: row.created_at } : null;
}

/** Usernames by account id, for showing who made each game. @returns {Map<number, string>} */
export function usernamesById(db) {
  return new Map(db.prepare('SELECT id, username FROM users').all().map((r) => [r.id, r.username]));
}

/** Saves your bio (already checked). */
export function setBio(db, userId, bio) {
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio === '' ? null : bio, userId);
}

/** Whether this account is an admin (false if there's no such account). */
export function isAdminUser(db, userId) {
  return db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId)?.is_admin === 1;
}

/** Every account, for the admin script. @returns {(User & { createdAt: number })[]} */
export function listUsers(db) {
  return db
    .prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY id')
    .all()
    .map((row) => ({ id: row.id, username: row.username, isAdmin: row.is_admin === 1, createdAt: row.created_at }));
}
