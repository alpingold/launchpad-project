import express from 'express';
import { currentUser } from '../auth/currentUser.js';
import { requireJsonPosts } from './requireJson.js';
import { GenerationError } from '../generation/service.js';
import { gameStatus, mainVersion, listBuildAttempts } from '../db/generatedGames.js';
import { changedLines } from '../generation/lineDiff.js';
import { isAdminUser, usernamesById } from '../db/users.js';

/**
 * Admin routes (plan §11 A5, versions §12e K6), mounted under /api/admin. Every route needs
 * a logged-in admin: 401 if not logged in, 403 if logged in but not an admin.
 *
 *   GET    /api/admin/generations                    → { info, games: [summary] }   (newest first)
 *   POST   /api/admin/generations  { idea, model? }  → 202 { game }   a new game: its design is written first
 *   GET    /api/admin/generations/:id                → { game }   every version: design, drafts, code, report, changes
 *   POST   /api/admin/generations/:id/versions  { request, basedOn?, skipDesign? }
 *                                                    → 202 { game }   asks for changes: a new version (a plan first,
 *                                                                     unless skipDesign: a small fix, straight to code)
 *   Designs (plan §13i, F5), for a version whose design or plan waits for you:
 *   POST   /api/admin/generations/:id/versions/:v/redesign { feedback } → 202 { game }   a new draft
 *   POST   /api/admin/generations/:id/versions/:v/design   { design }   → { game }       your own edit
 *   POST   /api/admin/generations/:id/versions/:v/build                 → 202 { game }   "Build it"
 *   POST   /api/admin/generations/:id/versions/:v/discard               → { game }       the newest version only
 *   POST   /api/admin/generations/:id/versions/:v/review-again      → 202 { game }   another code review round
 *                                                    (plan §47): the next version, with what it fixed
 *   POST   /api/admin/generations/:id/versions/:v/playtest → { game }   only you can start that version
 *   POST   /api/admin/generations/:id/publish        → { game }   the playtest version goes to everyone, if its
 *                                                    name and description have no blocked words (plan §49):
 *                                                    else 422 { error: 'BLOCKED_WORDS', message, blocked }
 *   POST   /api/admin/generations/:id/stop-playtest  → { game }
 *   POST   /api/admin/generations/:id/unpublish      → { game }   no version for other hosts any more
 *   DELETE /api/admin/generations/:id                → 204        the game and all its versions
 *
 * Errors: { error: 'CODE', message }.
 *
 * The same routes, for EVERY account and only on their own games (plan §15), are mounted
 * under /api/generations with `mine: true`: anyone logged in, starting work needs their
 * own GenAI Studio key (the service checks). Creators publish and unpublish their own games
 * (plan §49: no admin approval). Someone else's game is a 404 there, as if it didn't exist.
 *
 * @param {{ db: import('better-sqlite3').Database, generation: import('../generation/service.js').GenerationService, mine?: boolean }} deps
 */
export function createAdminRouter({ db, generation, mine = false }) {
  const router = express.Router();
  // Only for these routes: with `mine` this router sits on /api itself.
  router.use('/generations', requireJsonPosts);

  // Who's asking: only admins get past this (any account, for their own games).
  router.use('/generations', (req, res, next) => {
    const user = currentUser(db, req.headers.cookie).user;
    if (!user) return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: 'Log in first.' });
    if (!mine && !user.isAdmin) return res.status(403).json({ error: 'NOT_ADMIN', message: 'Only admins can do this.' });
    req.user = user;
    next();
  });

  // Your own games only: someone else's is "not found" (the same answer as a made-up id).
  if (mine) {
    router.param('id', (req, res, next, id) => {
      let owner;
      try {
        owner = generation.get(id).ownerUserId;
      } catch (err) {
        if (err instanceof GenerationError) return res.status(err.status).json({ ...err.details, error: err.code, message: err.message });
        return next(err);
      }
      if (owner !== req.user.id) return res.status(404).json({ error: 'NOT_FOUND', message: 'There is no such game.' });
      next();
    });
  }

  /** The list view: no code (it can be long), just what the admin page's table shows. */
  const summary = (game, names = usernamesById(db)) => {
    const main = mainVersion(game);
    const latest = game.versions.at(-1);
    return {
      id: game.id,
      status: gameStatus(game),
      prompt: game.prompt,
      name: main?.name ?? null,
      description: main?.description ?? null,
      model: latest.model,
      error: latest.status === 'failed' ? latest.error : null,
      ownerUserId: game.ownerUserId,
      ownerName: names.get(game.ownerUserId) ?? null,
      publishedVersion: game.publishedVersion,
      playtestVersion: game.playtestVersion,
      latestVersion: latest.version,
      testsPassed: latest.report ? latest.report.ok === true : null, // null: not tested (yet)
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      progress: generation.progress(game.id),
    };
  };

  /** The detail view: every version, with its code and test report as plain text/data, and what changed. */
  const detail = (game) => {
    const attempts = listBuildAttempts(db, game.id);
    return {
      ...summary(game),
      versions: game.versions.map((v) => {
        const base = v.basedOn === null ? null : game.versions.find((b) => b.version === v.basedOn);
        return {
          version: v.version,
          status: v.status,
          request: v.request,
          basedOn: v.basedOn,
          changelog: v.changelog,
          kind: v.kind,
          // What the code review found and fixed (plan §47), for the game's creator.
          codeReview: v.codeReview,
          model: v.model,
          design: v.design,
          drafts: v.drafts,
          designFeedback: v.designFeedback,
          name: v.name,
          description: v.description,
          error: v.error,
          source: v.source,
          report: v.report,
          testsPassed: v.report ? v.report.ok === true : null,
          // Changed lines compared with the version it was made from (null: v1, no code yet, or too big).
          changes: base?.source && v.source ? changedLines(base.source, v.source) : null,
          // Every build attempt (plan §13n), each with what changed since the attempt before.
          attempts: (attempts.get(v.version) ?? []).map((a, i, all) => {
            const before = i > 0 && all[i - 1].build === a.build ? all[i - 1] : null;
            return { ...a, changes: before?.source && a.source ? changedLines(before.source, a.source) : null };
          }),
          createdAt: v.createdAt,
        };
      }),
    };
  };

  /** Runs a handler; a GenerationError becomes its HTTP status and code. */
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof GenerationError) return res.status(err.status).json({ ...err.details, error: err.code, message: err.message });
      next(err);
    }
  };

  router.get(
    '/generations',
    handle((req, res) => {
      const games = mine ? generation.list().filter((g) => g.ownerUserId === req.user.id) : generation.list();
      // canGenerate: whether this person's jobs can run at all (their own key, or an admin).
      const info = { ...generation.info(), canGenerate: generation.hasKey(req.user.id), isAdmin: isAdminUser(db, req.user.id) };
      const names = usernamesById(db);
      res.json({ info, games: games.map((g) => summary(g, names)) });
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
    '/generations/:id/versions',
    handle((req, res) => {
      const { request, basedOn, model, skipDesign } = req.body ?? {};
      const game = generation.requestChanges({ id: req.params.id, request, basedOn, model, skipDesign });
      res.status(202).json({ game: detail(game) });
    }),
  );

  const versionOf = (req) => ({ id: req.params.id, version: Number(req.params.version) });

  router.post(
    '/generations/:id/versions/:version/redesign',
    handle((req, res) => {
      res.status(202).json({ game: detail(generation.redesign({ ...versionOf(req), feedback: req.body?.feedback })) });
    }),
  );

  router.post(
    '/generations/:id/versions/:version/design',
    handle((req, res) => {
      res.json({ game: detail(generation.editDesign({ ...versionOf(req), design: req.body?.design })) });
    }),
  );

  router.post(
    '/generations/:id/versions/:version/build',
    handle((req, res) => {
      res.status(202).json({ game: detail(generation.build(versionOf(req))) });
    }),
  );

  router.post(
    '/generations/:id/versions/:version/discard',
    handle((req, res) => {
      res.json({ game: detail(generation.discard(versionOf(req))) });
    }),
  );

  router.post(
    '/generations/:id/versions/:version/review-again',
    handle((req, res) => {
      const { id, version } = versionOf(req);
      res.status(202).json({ game: detail(generation.reviewAgain({ id, basedOn: version, model: req.body?.model })) });
    }),
  );

  router.post(
    '/generations/:id/versions/:version/playtest',
    handle(async (req, res) => {
      const game = await generation.playtest(req.params.id, Number(req.params.version));
      res.json({ game: detail(game) });
    }),
  );

  router.post(
    '/generations/:id/publish',
    handle(async (req, res) => {
      res.json({ game: detail(await generation.publish(req.params.id)) });
    }),
  );

  router.post(
    '/generations/:id/stop-playtest',
    handle((req, res) => {
      res.json({ game: detail(generation.takeDown(req.params.id, 'playtest')) });
    }),
  );

  router.post(
    '/generations/:id/unpublish',
    handle((req, res) => {
      res.json({ game: detail(generation.takeDown(req.params.id, 'published')) });
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
