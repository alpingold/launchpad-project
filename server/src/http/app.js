import express from 'express';
import { config } from '../config.js';
import { GameRegistry } from '../games/registry.js';
import { openDatabase } from '../db/database.js';
import { createAuthRouter } from './authRoutes.js';
import { createAdminRouter } from './adminRoutes.js';
import { createAccountRouter } from './accountRoutes.js';
import { createGamesRouter } from './gamesRoutes.js';
import { kitGuide } from '../games/kitGuide.js';

/**
 * Builds the Express app (HTTP routes only).
 *
 * This is a function instead of a module-level `const app` so tests can
 * create a fresh app each time, and so index.js decides when to listen.
 * WebSockets are NOT handled here: Express only does normal HTTP requests.
 * The `ws` library attaches to the same http.Server in index.js (milestone M1).
 *
 * @param {Object} [deps]
 * @param {GameRegistry} [deps.games]  the games to list for the host's picker
 * @param {import('better-sqlite3').Database} [deps.db]  accounts database (tests: in-memory)
 * @param {typeof config} [deps.cfg]
 * @param {import('../generation/service.js').GenerationService} [deps.generation]  AI games (admin routes)
 * @param {ReturnType<typeof import('../generation/userKeys.js').createUserKeys>} [deps.userKeys]  users' own GenAI Studio keys (plan §15)
 */
export function createApp({ games = new GameRegistry(), db = openDatabase(':memory:'), cfg = config, generation, userKeys } = {}) {
  const app = express();
  app.set('trust proxy', cfg.TRUST_PROXY);

  // Parse JSON request bodies, rejecting anything over the size limit.
  app.use(express.json({ limit: config.HTTP_JSON_LIMIT }));

  // Health check: the client (and later the VPS) can call this to see if the server is up.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // The game catalogue, game pages, votes and profiles (plan §14, §16).
  app.use('/api', createGamesRouter({ db, games }));

  // The game kit guide (/kit): how frame games work, the same text the AI reads.
  app.get('/api/kit', (_req, res) => {
    res.json(kitGuide());
  });

  // Sign up, log in, log out, who am I.
  app.use('/api', createAuthRouter({ db, cfg }));

  // Your own account: your GenAI Studio key (plan §15).
  app.use('/api/account', createAccountRouter({ db, userKeys }));

  // Admin only: generating and approving AI-made games.
  if (generation) app.use('/api/admin', createAdminRouter({ db, generation }));

  // Every account: making games with your own GenAI Studio key, only your own games (plan §15).
  if (generation) app.use('/api', createAdminRouter({ db, generation, mine: true }));

  // Any other /api path is a clean JSON 404 instead of Express's HTML page.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  // Last-resort error handler. Express calls this when a route throws or
  // when express.json() gets a malformed or oversized body.
  // We log the details on the server but never send stack traces to clients.
  // Express recognizes an error handler by having exactly 4 parameters, so `_req` and
  // `_next` must stay even though we don't use them (the _ prefix says "unused on purpose").
  app.use((err, _req, res, _next) => {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error('[http] unexpected error:', err);
    res.status(status).json({ error: status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST' });
  });

  return app;
}
