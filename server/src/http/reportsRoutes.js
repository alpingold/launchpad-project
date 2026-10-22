import express from 'express';
import { currentUser } from '../auth/currentUser.js';
import { AttemptLimiter } from '../auth/attemptLimiter.js';
import { requireJsonPosts } from './requireJson.js';
import { addSiteReport, listSiteReports, setSiteReportDone, deleteSiteReport, recentGameReports } from '../db/reports.js';
import { catalogGame, CatalogError } from '../games/catalog.js';
import { gameReports, postGameReport, voteOnGameReportAs, markGameReportFixed, deleteGameReportAs } from '../games/gameReports.js';

/**
 * Bug reports (plan §31), mounted under /api:
 *   POST   /api/reports  { kind, body, page?, device?, website? } → 201 { id }   anyone; ≤ REPORTS_PER_WINDOW per address
 *
 *   GET    /api/games/:id/reports                 → { reports, canPost, canMarkFixed }   anyone who can see the game
 *   POST   /api/games/:id/reports  { body, device? } → 201 { report }   logged in; ≤ GAME_REPORTS_PER_WINDOW per account
 *   PUT    /api/game-reports/:rid/vote  { value: 1 | -1 | 0 } → { report }   logged in, not your own
 *   POST   /api/game-reports/:rid/fixed { fixed } → { report }   the game's creator or an admin
 *   DELETE /api/game-reports/:rid                 → 204   its author or an admin
 *
 *   GET    /api/admin/reports                     → { reports: [SiteReport], gameReports }   admins (gameReports: the newest 50)
 *   POST   /api/admin/reports/:id/done { done }   → 204                          admins
 *   DELETE /api/admin/reports/:id                 → 204                          admins
 *
 * Errors: { error: 'CODE', message }.
 *
 * @param {{ db: import('better-sqlite3').Database, games: import('../games/registry.js').GameRegistry, cfg: typeof import('../config.js').config }} deps
 */
export function createReportsRouter({ db, games, cfg }) {
  const router = express.Router();
  router.use(['/reports', '/admin/reports', '/games/:id/reports', '/game-reports'], requireJsonPosts);
  const limiter = new AttemptLimiter({ max: cfg.REPORTS_PER_WINDOW, windowMs: cfg.REPORTS_WINDOW_MS });
  const perAccount = new AttemptLimiter({ max: cfg.GAME_REPORTS_PER_WINDOW, windowMs: cfg.GAME_REPORTS_WINDOW_MS });
  const fail = (res, status, error, message) => res.status(status).json({ error, message });

  /** @returns {import('../games/catalog.js').Viewer} */
  const viewerOf = (req) => {
    const user = currentUser(db, req.headers.cookie).user;
    return { userId: user?.id ?? null, isAdmin: user?.isAdmin ?? false };
  };
  const handle = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof CatalogError) return fail(res, err.status, err.code, err.message);
      next(err);
    }
  };

  router.post('/reports', (req, res) => {
    const { kind, body, page, device, website } = req.body ?? {};
    if (!['bug', 'idea', 'content', 'other'].includes(kind)) return fail(res, 400, 'BAD_KIND', 'Pick what kind of report this is.');
    const text = typeof body === 'string' ? body.trim() : '';
    if (text.length < 10 || text.length > 2000) return fail(res, 400, 'BAD_BODY', 'Write between 10 and 2000 characters.');
    if (limiter.isBlocked(req.ip)) return fail(res, 429, 'TOO_MANY_REPORTS', 'That was a lot of reports! Try again in a few minutes.');
    limiter.record(req.ip);
    // The "website" field is hidden from people (Report.jsx): only a bot fills it in. It's
    // told everything went fine, so it has no reason to try again differently.
    if (website) return res.status(201).json({ id: null });
    const id = addSiteReport(db, {
      userId: currentUser(db, req.headers.cookie).user?.id ?? null,
      kind,
      page: sitePath(page),
      body: text,
      device: shortText(device, 80),
    });
    res.status(201).json({ id });
  });

  // --- On a game's page (plan §31b) ---

  router.get(
    '/games/:id/reports',
    handle((req, res) => res.json(gameReports(db, games, viewerOf(req), req.params.id))),
  );

  router.post(
    '/games/:id/reports',
    handle((req, res) => {
      const viewer = viewerOf(req);
      if (viewer.userId !== null && perAccount.isBlocked(viewer.userId)) {
        return fail(res, 429, 'TOO_MANY_REPORTS', "That's a lot of reports in an hour! Try again a bit later.");
      }
      const report = postGameReport(db, games, viewer, req.params.id, req.body ?? {});
      perAccount.record(viewer.userId);
      res.status(201).json({ report });
    }),
  );

  const reportId = (req) => Number(req.params.rid);

  router.put(
    '/game-reports/:rid/vote',
    handle((req, res) => res.json({ report: voteOnGameReportAs(db, games, viewerOf(req), reportId(req), req.body?.value) })),
  );

  router.post(
    '/game-reports/:rid/fixed',
    handle((req, res) => res.json({ report: markGameReportFixed(db, games, viewerOf(req), reportId(req), req.body?.fixed) })),
  );

  router.delete(
    '/game-reports/:rid',
    handle((req, res) => {
      deleteGameReportAs(db, games, viewerOf(req), reportId(req));
      res.status(204).end();
    }),
  );

  // --- Admins only, from here on ---
  router.use('/admin/reports', (req, res, next) => {
    const user = currentUser(db, req.headers.cookie).user;
    if (!user) return fail(res, 401, 'NOT_AUTHENTICATED', 'Log in first.');
    if (!user.isAdmin) return fail(res, 403, 'NOT_ADMIN', 'Only admins can do this.');
    next();
  });
  const notFound = (res) => fail(res, 404, 'NOT_FOUND', 'There is no such report.');

  router.get('/admin/reports', (req, res) => {
    const admin = viewerOf(req);
    const nameOf = new Map();
    const gameName = (id) => {
      if (!nameOf.has(id)) {
        try {
          nameOf.set(id, catalogGame(db, games, admin, id).name);
        } catch {
          nameOf.set(id, null); // gone, or not shown in the catalogue
        }
      }
      return nameOf.get(id);
    };
    const recent = recentGameReports(db).map((r) => ({
      id: r.id,
      gameId: r.gameId,
      gameName: gameName(r.gameId),
      author: r.username,
      body: r.body,
      device: r.device,
      score: r.score,
      fixed: r.fixedAt !== null,
      createdAt: r.createdAt,
    }));
    res.json({ reports: listSiteReports(db), gameReports: recent });
  });

  router.post('/admin/reports/:id/done', (req, res) => {
    if (!setSiteReportDone(db, Number(req.params.id), req.body?.done !== false)) return notFound(res);
    res.status(204).end();
  });

  router.delete('/admin/reports/:id', (req, res) => {
    if (!deleteSiteReport(db, Number(req.params.id))) return notFound(res);
    res.status(204).end();
  });

  return router;
}

/** A page on this site ("/games/punchline"), or null. Never another site: "//x.com" is one. */
function sitePath(value) {
  return typeof value === 'string' && /^\/(?!\/)[^\s]{0,199}$/.test(value) ? value : null;
}

/** Text cut to `max` characters, or null. */
function shortText(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
