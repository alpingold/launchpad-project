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

/**
 * A report on a game's page, as the viewer sees it. score: the sum of its votes (can be
 * negative); myVote: the viewer's own (0: none).
 * @typedef {{ id: number, gameId: string, userId: number, username: string, body: string,
 *   device: string | null, fixedAt: number | null, createdAt: number, score: number, myVote: -1 | 0 | 1 }} GameReport
 */

const GAME_REPORT_SELECT = `
  SELECT r.*, u.username,
         COALESCE((SELECT SUM(value) FROM game_report_votes WHERE report_id = r.id), 0) AS score,
         COALESCE((SELECT value FROM game_report_votes WHERE report_id = r.id AND user_id = @viewer), 0) AS my_vote
  FROM game_reports r JOIN users u ON u.id = r.user_id`;

function gameReportFromRow(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    userId: row.user_id,
    username: row.username,
    body: row.body,
    device: row.device,
    fixedAt: row.fixed_at,
    createdAt: row.created_at,
    score: row.score,
    myVote: row.my_vote,
  };
}

/** Saves a report on a game's page (already checked). @returns {number} its id */
export function addGameReport(db, { gameId, userId, body, device }, now = Date.now()) {
  return Number(
    db
      .prepare('INSERT INTO game_reports (game_id, user_id, body, device, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(gameId, userId, body, device, now).lastInsertRowid,
  );
}

/**
 * A game's reports, the ones people agree with most first (highest total), then the newest.
 * @param {number | null} viewerId  whose votes are `myVote`
 * @returns {GameReport[]}
 */
export function listGameReports(db, gameId, viewerId) {
  return db
    .prepare(`${GAME_REPORT_SELECT} WHERE r.game_id = @gameId ORDER BY score DESC, r.created_at DESC, r.id DESC`)
    .all({ gameId, viewer: viewerId ?? -1 })
    .map(gameReportFromRow);
}

/** @returns {GameReport | null} */
export function getGameReport(db, id, viewerId) {
  const row = db.prepare(`${GAME_REPORT_SELECT} WHERE r.id = @id`).get({ id, viewer: viewerId ?? -1 });
  return row ? gameReportFromRow(row) : null;
}

/** The newest reports across every game (the admin's Reports tab). @returns {GameReport[]} */
export function recentGameReports(db, limit = 50) {
  return db
    .prepare(`${GAME_REPORT_SELECT} ORDER BY r.created_at DESC, r.id DESC LIMIT @limit`)
    .all({ limit, viewer: -1 })
    .map(gameReportFromRow);
}

/** One account's vote on a report: 1, -1, or 0 to take it back (already checked). */
export function voteOnGameReport(db, reportId, userId, value) {
  if (value === 0) {
    db.prepare('DELETE FROM game_report_votes WHERE report_id = ? AND user_id = ?').run(reportId, userId);
    return;
  }
  db.prepare(
    `INSERT INTO game_report_votes (report_id, user_id, value) VALUES (?, ?, ?)
     ON CONFLICT (report_id, user_id) DO UPDATE SET value = excluded.value`,
  ).run(reportId, userId, value);
}

export function setGameReportFixed(db, id, fixed, now = Date.now()) {
  db.prepare('UPDATE game_reports SET fixed_at = ? WHERE id = ?').run(fixed ? now : null, id);
}

/** Its votes go with it (ON DELETE CASCADE). */
export function deleteGameReport(db, id) {
  db.prepare('DELETE FROM game_reports WHERE id = ?').run(id);
}

/** Every report on a game, when the game itself is deleted. */
export function deleteGameReportsFor(db, gameId) {
  db.prepare('DELETE FROM game_reports WHERE game_id = ?').run(gameId);
}
