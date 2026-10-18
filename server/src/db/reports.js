// Bug reports (plan §31): from the site-wide form (/report), and on each game's page.

/** @typedef {'bug' | 'idea' | 'other'} ReportKind */

/**
 * @typedef {{ id: number, kind: ReportKind, page: string | null, body: string, device: string | null,
 *   username: string | null, doneAt: number | null, createdAt: number }} SiteReport
 */

/** Saves a report from the form (already checked). @returns {number} its id */
export function addSiteReport(db, { userId, kind, page, body, device }, now = Date.now()) {
  return Number(
    db
      .prepare('INSERT INTO site_reports (user_id, kind, page, body, device, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, kind, page, body, device, now).lastInsertRowid,
  );
}

/** Every report from the form, newest first. @returns {SiteReport[]} */
export function listSiteReports(db) {
  return db
    .prepare(
      `SELECT r.*, u.username FROM site_reports r LEFT JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC, r.id DESC`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      page: row.page,
      body: row.body,
      device: row.device,
      username: row.username ?? null,
      doneAt: row.done_at,
      createdAt: row.created_at,
    }));
}

/** Marks a report dealt with, or not. @returns {boolean} false if there's no such report */
export function setSiteReportDone(db, id, done, now = Date.now()) {
  return db.prepare('UPDATE site_reports SET done_at = ? WHERE id = ?').run(done ? now : null, id).changes > 0;
}

/** @returns {boolean} false if there's no such report */
export function deleteSiteReport(db, id) {
  return db.prepare('DELETE FROM site_reports WHERE id = ?').run(id).changes > 0;
}
