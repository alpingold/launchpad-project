import express from 'express';
import { currentUser } from '../auth/currentUser.js';
import { requireJsonPosts } from './requireJson.js';
import { AttemptLimiter } from '../auth/attemptLimiter.js';
import { KeyError } from '../generation/userKeys.js';

/**
 * Your own account (plan §15), mounted under /api/account. Logged in only (401 if not).
 *
 *   GET    /api/account/genai-key          → { saved, last4, savedAt }   never the key itself
 *   PUT    /api/account/genai-key  { key } → { saved, last4, savedAt }   checked with GenAI Studio, then saved encrypted
 *   DELETE /api/account/genai-key          → 204
 *
 * Errors: { error: 'CODE', message }.
 *
 * @param {{ db: import('better-sqlite3').Database, userKeys: ReturnType<typeof import('../generation/userKeys.js').createUserKeys> }} deps
 */
export function createAccountRouter({ db, userKeys }) {
  const router = express.Router();
  router.use(requireJsonPosts);
  // Each save asks GenAI Studio about the key: at most 10 tries per account per 10 minutes.
  const saves = new AttemptLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

  router.use((req, res, next) => {
    const user = currentUser(db, req.headers.cookie).user;
    if (!user) return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: 'Log in first.' });
    req.user = user;
    next();
  });

  router.get('/genai-key', (req, res) => {
    res.json(userKeys.status(req.user.id));
  });

  router.put('/genai-key', async (req, res, next) => {
    const id = String(req.user.id);
    if (saves.isBlocked(id)) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many tries. Wait a few minutes.' });
    saves.record(id);
    try {
      res.json(await userKeys.save(req.user.id, req.body?.key));
    } catch (err) {
      if (err instanceof KeyError) return res.status(err.status).json({ error: err.code, message: err.message });
      next(err);
    }
  });

  router.delete('/genai-key', (req, res) => {
    userKeys.remove(req.user.id);
    res.status(204).end();
  });

  return router;
}
