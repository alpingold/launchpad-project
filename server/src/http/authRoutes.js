import express from 'express';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../auth/passwords.js';
import { isValidUsername, isValidPassword, USERNAME_RULES, PASSWORD_RULES } from '../auth/credentials.js';
import { sessionCookie, clearedSessionCookie } from '../auth/cookies.js';
import { currentUser } from '../auth/currentUser.js';
import { AttemptLimiter } from '../auth/attemptLimiter.js';
import { createUser, findUserForLogin } from '../db/users.js';
import { createSession, deleteSession } from '../db/sessions.js';

/**
 * Account routes, mounted under /api:
 *   POST /api/signup   { username, password } → 201 { user }   and sets the login cookie
 *   POST /api/login    { username, password } → 200 { user }   and sets the login cookie
 *   POST /api/logout                          → 204             and clears the cookie
 *   GET  /api/me                              → 200 { user }    (user is null when logged out)
 *
 * Errors are JSON: { error: 'CODE', message: 'text a person can read' }.
 *
 * @param {{ db: import('better-sqlite3').Database, cfg: typeof import('../config.js').config }} deps
 */
export function createAuthRouter({ db, cfg }) {
  const router = express.Router();
  const limiter = new AttemptLimiter({ max: cfg.AUTH_ATTEMPTS_PER_WINDOW, windowMs: cfg.AUTH_WINDOW_MS });
  const cookieOptions = { maxAgeSeconds: cfg.SESSION_DAYS * 24 * 60 * 60, secure: cfg.COOKIE_SECURE };

  function fail(res, status, error, message) {
    res.status(status).json({ error, message });
  }

  /** Starts a session for `user` and puts its token in the login cookie. */
  function logIn(res, user) {
    const { token } = createSession(db, user.id, { days: cfg.SESSION_DAYS });
    res.setHeader('Set-Cookie', sessionCookie(token, cookieOptions));
  }

  // CSRF protection, part 2 (part 1 is the SameSite=Lax cookie). A plain HTML form on
  // another website can submit a POST here, but it can't send Content-Type: application/json
  // without the browser first asking our permission (CORS), which we never give.
  // So: POSTs must be JSON, or they're refused.
  router.use((req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) {
      return fail(res, 415, 'JSON_REQUIRED', 'Requests must be sent as JSON.');
    }
    next();
  });

  router.post('/signup', async (req, res) => {
    if (limiter.isBlocked(req.ip)) return fail(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Try again in a few minutes.');
    limiter.record(req.ip); // every sign-up counts, so nobody can mass-create accounts

    const { username, password } = req.body ?? {};
    if (!isValidUsername(username)) return fail(res, 400, 'INVALID_USERNAME', USERNAME_RULES);
    if (!isValidPassword(password)) return fail(res, 400, 'INVALID_PASSWORD', PASSWORD_RULES);

    const user = createUser(db, username, await hashPassword(password));
    if (!user) return fail(res, 409, 'USERNAME_TAKEN', 'That username is taken.');

    logIn(res, user);
    res.status(201).json({ user });
  });

  router.post('/login', async (req, res) => {
    if (limiter.isBlocked(req.ip)) return fail(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Try again in a few minutes.');

    const { username, password } = req.body ?? {};
    const found = typeof username === 'string' ? findUserForLogin(db, username) : null;
    // Always run a password check, even for unknown usernames (against a dummy hash), so the
    // response takes the same time either way and can't reveal which usernames exist.
    const ok = await verifyPassword(typeof password === 'string' ? password : '', found?.passwordHash ?? DUMMY_HASH);
    if (!found || !ok) {
      limiter.record(req.ip); // only failures count toward the limit
      // One message for both cases, for the same reason.
      return fail(res, 401, 'INVALID_CREDENTIALS', 'Wrong username or password.');
    }

    const user = { id: found.id, username: found.username };
    logIn(res, user);
    res.json({ user });
  });

  router.post('/logout', (req, res) => {
    const { token } = currentUser(db, req.headers.cookie);
    if (token) deleteSession(db, token);
    res.setHeader('Set-Cookie', clearedSessionCookie(cookieOptions));
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    res.json({ user: currentUser(db, req.headers.cookie).user });
  });

  return router;
}
