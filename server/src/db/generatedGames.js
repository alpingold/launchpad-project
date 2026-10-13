import { createHash, randomBytes } from 'node:crypto';

// All SQL for AI-generated games (plan §11). The code itself is stored here, not in the
// repo: only hand-made "official" games live in the repo.
//
// A game moves through these statuses:
//   generating → failed                (the generator gave up)
//   generating → review                (code + test report saved; the admin reads it)
//   review     → playtest | rejected   (playtest: only its owner can start it)
//   playtest   → published | rejected (published: every host can start it)
// Only `playtest` and `published` games are ever loaded into the server.

/** @typedef {'generating' | 'failed' | 'review' | 'playtest' | 'published' | 'rejected'} GameStatus */
export const STATUSES = Object.freeze(['generating', 'failed', 'review', 'playtest', 'published', 'rejected']);
/** Statuses whose code the server runs. */
export const LOADABLE_STATUSES = Object.freeze(['playtest', 'published']);

/**
 * @typedef {Object} GeneratedGame
 * @property {string} id               "g-…", also the id the game runs under
 * @property {number} ownerUserId
 * @property {string} prompt
 * @property {string | null} model
 * @property {GameStatus} status
 * @property {string | null} name
 * @property {string | null} description
 * @property {string | null} source
 * @property {string | null} sourceSha256
 * @property {object | null} report
 * @property {string | null} error
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/** A new id like "g-k3x9m2qa": "g-" marks it as generated; the rest is random. */
export function newGeneratedGameId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no look-alikes (l/1, o/0)
  return `g-${[...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    prompt: row.prompt,
    model: row.model,
    status: row.status,
    name: row.name,
    description: row.description,
    source: row.source,
    sourceSha256: row.source_sha256,
    report: row.report_json ? JSON.parse(row.report_json) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Starts a new generated game in the "generating" status (the generator fills it in later).
 * @returns {GeneratedGame}
 */
export function createGeneratedGame(db, { ownerUserId, prompt, model = null, now = Date.now() }) {
  const id = newGeneratedGameId();
  db.prepare(
    `INSERT INTO generated_games (id, owner_user_id, prompt, model, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'generating', ?, ?)`,
  ).run(id, ownerUserId, prompt, model, now, now);
  return getGeneratedGame(db, id);
}

/**
 * Saves finished code and its test report, and moves the game to `status` (normally "review").
 * The fingerprint makes it possible to prove later that the code that runs is exactly the
 * code that was reviewed.
 */
export function saveGeneratedSource(db, id, { source, report, name, description, status = 'review', now = Date.now() }) {
  db.prepare(
    `UPDATE generated_games
     SET source = ?, source_sha256 = ?, report_json = ?, name = ?, description = ?, status = ?, error = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(source, sha256(source), JSON.stringify(report ?? null), name ?? null, description ?? null, status, now, id);
}

/**
 * Generation failed: remember why. If the generator got as far as writing code, keep the
 * last attempt and its test report too, so the admin can see what went wrong.
 */
export function markGenerationFailed(db, id, error, { source = null, report = null, now = Date.now() } = {}) {
  db.prepare(
    `UPDATE generated_games
     SET status = 'failed', error = ?, source = ?, source_sha256 = ?, report_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(String(error).slice(0, 2000), source, source === null ? null : sha256(source), report === null ? null : JSON.stringify(report), now, id);
}

/** Every game still marked "generating" (after a restart, these were interrupted). */
export function listGeneratingGames(db) {
  return db.prepare("SELECT * FROM generated_games WHERE status = 'generating' ORDER BY created_at").all().map(fromRow);
}

/**
 * Moves a game to another status (review → playtest → published, or rejected).
 * @returns {boolean} false if there's no such game
 */
export function setGeneratedGameStatus(db, id, status, now = Date.now()) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status ${JSON.stringify(status)}`);
  return db.prepare('UPDATE generated_games SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id).changes === 1;
}

/** @returns {GeneratedGame | null} */
export function getGeneratedGame(db, id) {
  return fromRow(db.prepare('SELECT * FROM generated_games WHERE id = ?').get(id));
}

/** Every generated game, newest first (for the admin). @returns {GeneratedGame[]} */
export function listGeneratedGames(db) {
  return db.prepare('SELECT * FROM generated_games ORDER BY created_at DESC, id').all().map(fromRow);
}

/** The games the server should load at startup: playtest and published, with code. */
export function listLoadableGames(db) {
  return db
    .prepare(
      `SELECT * FROM generated_games
       WHERE status IN (${LOADABLE_STATUSES.map(() => '?').join(', ')}) AND source IS NOT NULL
       ORDER BY created_at`,
    )
    .all(...LOADABLE_STATUSES)
    .map(fromRow);
}

export function deleteGeneratedGame(db, id) {
  return db.prepare('DELETE FROM generated_games WHERE id = ?').run(id).changes === 1;
}
