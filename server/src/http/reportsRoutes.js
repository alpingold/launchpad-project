import express from 'express';
import { currentUser } from '../auth/currentUser.js';
import { AttemptLimiter } from '../auth/attemptLimiter.js';
import { requireJsonPosts } from './requireJson.js';
import { addSiteReport, listSiteReports, setSiteReportDone, deleteSiteReport } from '../db/reports.js';

/**
 * Bug reports (plan §31), mounted under /api:
 *   POST   /api/reports  { kind, body, page?, device?, website? } → 201 { id }   anyone; ≤ REPORTS_PER_WINDOW per address
 *   GET    /api/admin/reports                     → { reports: [SiteReport] }   admins
 *   POST   /api/admin/reports/:id/done { done }   → 204                          admins
 *   DELETE /api/admin/reports/:id                 → 204                          admins
 *
 * Errors: { error: 'CODE', message }.
 *
 * @param {{ db: import('better-sqlite3').Database, cfg: typeof import('../config.js').config }} deps
 */
export function createReportsRouter({ db, cfg }) {
  const router = express.Router();
  router.use(['/reports', '/admin/reports'], requireJsonPosts);
  const limiter = new AttemptLimiter({ max: cfg.REPORTS_PER_WINDOW, windowMs: cfg.REPORTS_WINDOW_MS });
  const fail = (res, status, error, message) => res.status(status).json({ error, message });

  router.post('/reports', (req, res) => {
    const { kind, body, page, device, website } = req.body ?? {};
    if (!['bug', 'idea', 'other'].includes(kind)) return fail(res, 400, 'BAD_KIND', 'Pick what kind of report this is.');
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

  // Admins only, from here on.
  router.use('/admin/reports', (req, res, next) => {
    const user = currentUser(db, req.headers.cookie).user;
    if (!user) return fail(res, 401, 'NOT_AUTHENTICATED', 'Log in first.');
    if (!user.isAdmin) return fail(res, 403, 'NOT_ADMIN', 'Only admins can do this.');
    next();
  });
  const notFound = (res) => fail(res, 404, 'NOT_FOUND', 'There is no such report.');

  router.get('/admin/reports', (_req, res) => res.json({ reports: listSiteReports(db) }));

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
