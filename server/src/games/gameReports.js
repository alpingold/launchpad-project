import { catalogGame, CatalogError } from './catalog.js';
import {
  addGameReport,
  listGameReports,
  getGameReport,
  voteOnGameReport,
  setGameReportFixed,
  deleteGameReport,
} from '../db/reports.js';

// Bug reports on a game's page (plan §31b): who may do what. Anyone who can see the game can
// read its reports; logged in, you can post one and vote on others' (not your own). The
// game's creator (or an admin) marks reports fixed; a report's author (or an admin) deletes it.
// Errors are CatalogErrors, like the rest of the game pages.

export const REPORT_MIN = 10;
export const REPORT_MAX = 1000;

/**
 * A report as the viewer sees it.
 * @param {import('../db/reports.js').GameReport} r
 * @param {import('./catalog.js').Viewer} viewer
 */
function view(r, viewer) {
  const mine = viewer.userId !== null && r.userId === viewer.userId;
  return {
    id: r.id,
    body: r.body,
    author: r.username,
    device: r.device,
    createdAt: r.createdAt,
    fixed: r.fixedAt !== null,
    score: r.score,
    myVote: r.myVote,
    mine,
    canVote: viewer.userId !== null && !mine,
    canDelete: mine || viewer.isAdmin === true,
  };
}

/** The game, if this viewer may see it (else 404, as if it didn't exist). */
const visibleGame = (db, registry, viewer, gameId) => catalogGame(db, registry, viewer, gameId);

/** A report on a game this viewer may see. */
function visibleReport(db, registry, viewer, reportId) {
  const report = Number.isInteger(reportId) ? getGameReport(db, reportId, viewer.userId) : null;
  if (!report) throw new CatalogError(404, 'NOT_FOUND', 'There is no such report.');
  try {
    return { report, game: visibleGame(db, registry, viewer, report.gameId) };
  } catch (err) {
    if (err instanceof CatalogError && err.status === 404) throw new CatalogError(404, 'NOT_FOUND', 'There is no such report.');
    throw err;
  }
}

/** A game's reports, most agreed-with first, and what the viewer may do. */
export function gameReports(db, registry, viewer, gameId) {
  const game = visibleGame(db, registry, viewer, gameId);
  return {
    reports: listGameReports(db, gameId, viewer.userId).map((r) => view(r, viewer)),
    canPost: viewer.userId !== null,
    canMarkFixed: game.canEdit,
  };
}

/** @returns the new report, as the viewer sees it */
export function postGameReport(db, registry, viewer, gameId, { body, device } = {}) {
  if (viewer.userId === null) throw new CatalogError(401, 'NOT_AUTHENTICATED', 'Log in to report a problem.');
  visibleGame(db, registry, viewer, gameId);
  const text = typeof body === 'string' ? body.trim() : '';
  if (text.length < REPORT_MIN || text.length > REPORT_MAX) {
    throw new CatalogError(400, 'BAD_BODY', `Write between ${REPORT_MIN} and ${REPORT_MAX} characters.`);
  }
  const shortDevice = typeof device === 'string' && device.trim() ? device.trim().slice(0, 80) : null;
  const id = addGameReport(db, { gameId, userId: viewer.userId, body: text, device: shortDevice });
  return view(getGameReport(db, id, viewer.userId), viewer);
}

/** value: 1, -1, or 0 to take a vote back. @returns the report, with its new total */
export function voteOnGameReportAs(db, registry, viewer, reportId, value) {
  if (viewer.userId === null) throw new CatalogError(401, 'NOT_AUTHENTICATED', 'Log in to vote.');
  const { report } = visibleReport(db, registry, viewer, reportId);
  if (![1, -1, 0].includes(value)) throw new CatalogError(400, 'BAD_VOTE', 'A vote is 1, -1 or 0.');
  if (report.userId === viewer.userId) throw new CatalogError(403, 'OWN_REPORT', "You can't vote on your own report.");
  voteOnGameReport(db, reportId, viewer.userId, value);
  return view(getGameReport(db, reportId, viewer.userId), viewer);
}

/** @returns the report, marked fixed or not */
export function markGameReportFixed(db, registry, viewer, reportId, fixed) {
  const { game } = visibleReport(db, registry, viewer, reportId);
  if (!game.canEdit) throw new CatalogError(403, 'NOT_CREATOR', "Only the game's creator (or an admin) can mark reports fixed.");
  setGameReportFixed(db, reportId, fixed !== false);
  return view(getGameReport(db, reportId, viewer.userId), viewer);
}

export function deleteGameReportAs(db, registry, viewer, reportId) {
  const { report } = visibleReport(db, registry, viewer, reportId);
  if (!view(report, viewer).canDelete) throw new CatalogError(403, 'NOT_AUTHOR', 'Only its author (or an admin) can delete a report.');
  deleteGameReport(db, reportId);
}
