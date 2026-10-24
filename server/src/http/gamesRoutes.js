import express from 'express';
import { currentUser } from '../auth/currentUser.js';
import { requireJsonPosts } from './requireJson.js';
import { catalogList, catalogGame, editGamePage, voteOnGame, CatalogError } from '../games/catalog.js';
import { getProfile } from '../db/users.js';
import { remixGame } from '../games/remix.js';
import { AttemptLimiter } from '../auth/attemptLimiter.js';
import { config } from '../config.js';

/**
 * The game catalogue and profiles (plan §14, §16), mounted under /api. Anyone can look; a
 * playtest game only exists for its creator.
 *
 *   GET /api/games                         → { games: [CatalogGame] }
 *   GET /api/games/:id                     → { game }   with its "About" text (and, for its editors, the file's own values)
 *   GET /api/games/:id/thumb               → JPEG, its main screenshot
 *   GET /api/games/:id/shot/host|phone     → JPEG
 *   PUT /api/games/:id/page   { name, description, about, tags, minutes, mainShot, allowRemix } → { game }   creator or admin
 *   PUT /api/games/:id/vote   { value: 1 | -1 | 0 }                                  → { game }   logged in, not your own
 *   POST /api/games/:id/remix                                                       → 201 { id }   your own copy to change
 *                                                     (plan §45): logged in, a public game, not your own, remixing allowed
 *   GET /api/users/:username               → { profile: { username, bio, joinedAt }, games: [CatalogGame] }
 *
 * Errors: { error: 'CODE', message }.
 *
 * @param {{ db: import('better-sqlite3').Database, games: import('../games/registry.js').GameRegistry, cfg?: typeof config }} deps
 */
export function createGamesRouter({ db, games, cfg = config }) {
  const router = express.Router();
  router.use(['/games', '/users'], requireJsonPosts);

  /** @returns {import('../games/catalog.js').Viewer} */
  const viewerOf = (req) => {
    const user = currentUser(db, req.headers.cookie).user;
    return { userId: user?.id ?? null, isAdmin: user?.isAdmin ?? false };
  };
  const handle = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof CatalogError) return res.status(err.status).json({ ...err.details, error: err.code, message: err.message });
      next(err);
    }
  };

  router.get(
    '/games',
    handle((req, res) => res.json({ games: catalogList(db, games, viewerOf(req)) })),
  );

  router.get(
    '/games/:id',
    handle((req, res) => res.json({ game: catalogGame(db, games, viewerOf(req), req.params.id) })),
  );

  // Screenshots. A published game keeps its id from version to version, so browsers check back after 5 min.
  const sendShot = (req, res, which) => {
    const viewer = viewerOf(req);
    const shot = games.shot(req.params.id, which, viewer);
    if (!shot) return res.status(404).json({ error: 'NOT_FOUND' });
    res.set('Cache-Control', 'private, max-age=300').type('image/jpeg').send(shot);
  };
  router.get(
    '/games/:id/thumb',
    handle((req, res) => {
      const main = catalogList(db, games, viewerOf(req)).find((g) => g.id === req.params.id)?.shots[0];
      if (!main) return res.status(404).json({ error: 'NOT_FOUND' });
      sendShot(req, res, main);
    }),
  );
  router.get(
    '/games/:id/shot/:which',
    handle((req, res) => {
      if (req.params.which !== 'host' && req.params.which !== 'phone') return res.status(404).json({ error: 'NOT_FOUND' });
      sendShot(req, res, req.params.which);
    }),
  );

  router.put(
    '/games/:id/page',
    handle((req, res) => {
      const viewer = viewerOf(req);
      if (viewer.userId === null) throw new CatalogError(401, 'NOT_AUTHENTICATED', 'Log in first.');
      res.json({ game: editGamePage(db, games, viewer, req.params.id, req.body) });
    }),
  );

  router.put(
    '/games/:id/vote',
    handle((req, res) => res.json({ game: voteOnGame(db, games, viewerOf(req), req.params.id, req.body?.value) })),
  );

  // Remixes per account per hour (plan §59): each one is a whole copy of a game.
  const remixes = new AttemptLimiter({ max: cfg.REMIXES_PER_WINDOW, windowMs: cfg.REMIXES_WINDOW_MS });
  router.post(
    '/games/:id/remix',
    handle((req, res) => {
      const viewer = viewerOf(req);
      if (viewer.userId !== null && remixes.isBlocked(viewer.userId)) {
        throw new CatalogError(429, 'TOO_MANY_REMIXES', "That's a lot of remixes in an hour! Try again a bit later.");
      }
      const id = remixGame(db, games, viewer, req.params.id);
      remixes.record(viewer.userId);
      res.status(201).json({ id });
    }),
  );

  router.get(
    '/users/:username',
    handle((req, res) => {
      const profile = getProfile(db, req.params.username);
      if (!profile) throw new CatalogError(404, 'NOT_FOUND', 'There is no such account.');
      const theirs = catalogList(db, games, viewerOf(req)).filter((g) => g.creator?.username === profile.username);
      res.json({ profile: { username: profile.username, bio: profile.bio, joinedAt: profile.createdAt }, games: theirs });
    }),
  );

  return router;
}
