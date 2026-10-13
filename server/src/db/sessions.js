import { createHash, randomBytes } from 'node:crypto';

// Login sessions. The browser's cookie holds a random token; the database stores only the
// token's SHA-256 hash. Checking a cookie = hash it and look the hash up.
//
// Why hash it? If the database file ever leaked, the attacker would see hashes, which can't
// be turned back into working cookies. (A plain fast hash is fine here, unlike passwords:
// the token is 256 random bits, so there's nothing to guess.)

const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Starts a session for a user.
 * @returns {{ token: string, expiresAt: number }} token goes in the cookie, and nowhere else
 */
export function createSession(db, userId, { days, now = Date.now() }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + days * DAY_MS;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now,
    expiresAt,
  );
  return { token, expiresAt };
}

/**
 * Who a cookie's token belongs to, if anyone.
 * @returns {import('./users.js').User | null}  null for unknown, malformed, or expired tokens
 */
export function getSessionUser(db, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) return null;
  const row = db
    .prepare(
      `SELECT users.id, users.username, users.is_admin FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), now);
  return row ? { id: row.id, username: row.username, isAdmin: row.is_admin === 1 } : null;
}

/** Logs a session out. Unknown tokens are ignored. */
export function deleteSession(db, token) {
  if (typeof token !== 'string') return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Removes expired sessions (they'd be rejected anyway; this keeps the table small). */
export function deleteExpiredSessions(db, now = Date.now()) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
}
