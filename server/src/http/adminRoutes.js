import express from 'express';
import { currentUser } from '../auth/currentUser.js';
import { requireJsonPosts } from './requireJson.js';
import { GenerationError, ACTION_NAMES } from '../generation/service.js';

/**
 * Admin routes (plan §11, A5), mounted under /api/admin. Every route needs a logged-in
 * admin: 401 if not logged in, 403 if logged in but not an admin.
 *
 *   GET    /api/admin/generations              → { info, games: [summary] }   (newest first)
 *   POST   /api/admin/generations  { idea, model? } → 202 { game }   starts generating
 *   GET    /api/admin/generations/:id          → { game }   with code, test report, progress
 *   POST   /api/admin/generations/:id/playtest → { game }   only you can start it
 *   POST   /api/admin/generations/:id/publish  → { game }   every host can start it
 *   POST   /api/admin/generations/:id/reject   → { game }   taken off the game list
 *   DELETE /api/admin/generations/:id          → 204
 *
 * Errors: { error: 'CODE', message }.
 *
 * @param {{ db: import('better-sqlite3').Database, generation: import('../generation/service.js').GenerationService }} deps
 */
export function createAdminRouter({ db, generation }) {
  const router = express.Router();
  router.use(requireJsonPosts);

  // Who's asking: only admins get past this.
  router.use((req, res, next) => {
    const user = currentUser(db, req.headers.cookie).user;
    if (!user) return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: 'Log in first.' });
    if (!user.isAdmin) return res.status(403).json({ error: 'NOT_ADMIN', message: 'Only admins can do this.' });
    req.user = user;
    next();
  });

  /** The list view: no code (it can be long), just what the admin page's table shows. */
  const summary = (game) => ({
    id: game.id,
    status: game.status,
    prompt: game.prompt,
    model: game.model,
    name: game.name,
    description: game.description,
    error: game.error,
    ownerUserId: game.ownerUserId,
    testsPassed: game.report ? game.report.ok === true : null, // null: not tested (yet)
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    progress: generation.progress(game.id),
  });

  /** The detail view: everything, including the code and the test report, as plain text/data. */
  const detail = (game) => ({ ...summary(game), source: game.source, report: game.report });

  /** Runs a handler; a GenerationError becomes its HTTP status and code. */
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof GenerationError) return res.status(err.status).json({ error: err.code, message: err.message });
      next(err);
    }
  };

  router.get(
    '/generations',
    handle((_req, res) => {
      res.json({ info: generation.info(), games: generation.list().map(summary) });
    }),
  );

  router.post(
    '/generations',
    handle((req, res) => {
      const { idea, model } = req.body ?? {};
      const game = generation.start({ ownerUserId: req.user.id, idea, model });
      res.status(202).json({ game: summary(game) });
    }),
  );

  router.get(
    '/generations/:id',
    handle((req, res) => {
      res.json({ game: detail(generation.get(req.params.id)) });
    }),
  );

  router.post(
    '/generations/:id/:action',
    handle(async (req, res) => {
      if (!ACTION_NAMES.includes(req.params.action)) return res.status(404).json({ error: 'NOT_FOUND' });
      const game = await generation.act(req.params.id, req.params.action);
      res.json({ game: detail(game) });
    }),
  );

  router.delete(
    '/generations/:id',
    handle((req, res) => {
      generation.remove(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
