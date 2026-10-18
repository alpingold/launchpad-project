import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { GameRegistry } from '../games/registry.js';
import { openDatabase } from '../db/database.js';
import { createAuthRouter } from './authRoutes.js';
import { createAdminRouter } from './adminRoutes.js';
import { createAccountRouter } from './accountRoutes.js';
import { createGamesRouter } from './gamesRoutes.js';
import { createReportsRouter } from './reportsRoutes.js';
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
 * @param {() => { rooms: number, playing: number, connections: number, generating: number }} [deps.activity]
 *   what's going on right now, for /api/status (server.js)
 */
export function createApp({ games = new GameRegistry(), db = openDatabase(':memory:'), cfg = config, generation, userKeys, activity } = {}) {
  const app = express();
  app.set('trust proxy', cfg.TRUST_PROXY);
  app.disable('x-powered-by'); // no need to tell visitors what the server runs

  // Security headers on every response (M8). The policy (CSP) only uses rules that don't
  // touch scripts: a game's srcdoc iframe inherits our page's policy, so a script rule here
  // would block the games' inline scripts (frame/template.js). What it does:
  //  - frame-ancestors 'none' + X-Frame-Options: no other site may show ours in a frame
  //    (so nobody can trick a visitor into clicking our buttons through a disguise)
  //  - object-src 'none', base-uri 'self': no plugins, no rewriting where links point
  //  - nosniff: browsers trust our Content-Types instead of guessing
  //  - Referrer-Policy: other sites only see that a visitor came from us, not which page
  //  - Permissions-Policy: no camera, microphone or location, for us or any game
  //  - HSTS (production only, where it's always HTTPS): browsers use HTTPS from then on
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (cfg.COOKIE_SECURE) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  // Parse JSON request bodies, rejecting anything over the size limit.
  app.use(express.json({ limit: config.HTTP_JSON_LIMIT }));

  // Health check: the client (and later the VPS) can call this to see if the server is up.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // What's going on right now: open rooms, games being played, AI games being made. Only for
  // the server itself (deploy/update.sh waits until nobody is playing before it restarts);
  // anyone else gets the usual 404. Visitors come through Caddy, so with TRUST_PROXY=loopback
  // req.ip is their real address, never 127.0.0.1.
  app.get('/api/status', (req, res, next) => {
    if (!activity || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) return next();
    res.json(activity());
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

  // Bug reports: the site-wide form, and the admin's list (plan §31).
  app.use('/api', createReportsRouter({ db, cfg }));

  // Any other /api path is a clean JSON 404 instead of Express's HTML page.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  // The built website (M8), when there is one: its files, and index.html for every other page
  // address (/games, /create/g-…): the React app reads the address and shows the right page.
  // Vite gives the files in assets/ names that change with their contents, so browsers may
  // keep them forever; index.html itself is always checked again, so a deploy shows up at once.
  if (cfg.CLIENT_DIST_PATH && existsSync(path.join(cfg.CLIENT_DIST_PATH, 'index.html'))) {
    app.use('/assets', express.static(path.join(cfg.CLIENT_DIST_PATH, 'assets'), { immutable: true, maxAge: '1y' }));
    // A built file that's gone (an old tab after a deploy) is a plain 404, not the page's HTML.
    app.use('/assets', (_req, res) => res.status(404).end());
    app.use(express.static(cfg.CLIENT_DIST_PATH, { index: false }));
    app.get('/{*page}', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(cfg.CLIENT_DIST_PATH, 'index.html'));
    });
  }

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
