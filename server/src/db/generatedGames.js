import { createHash, randomBytes } from 'node:crypto';

// All SQL for AI-generated games (plan §11, versions since K6 §12e). The code itself is
// stored here, not in the repo: only hand-made "official" games live in the repo.
//
// A GAME is the idea and who owns it. Its code lives in VERSIONS: version 1 is made from
// the idea, and every "ask for changes" makes the next one from an earlier version.
//   A version:  generating → ready  (passed the tests; code + report saved)
//               generating → failed (the generator gave up)
// A game has at most two LIVE versions, chosen by the admin:
//   published_version: the one every host can start
//   playtest_version:  one only its owner can start, to try before publishing
// Only live versions are ever loaded into the server.

/** @typedef {'generating' | 'failed' | 'ready'} VersionStatus */
export const VERSION_STATUSES = Object.freeze(['generating', 'failed', 'ready']);

/**
 * @typedef {Object} GameVersion
 * @property {string} gameId
 * @property {number} version            1, 2, 3, ...
 * @property {string} request            v1: the idea; later: the change request
 * @property {number | null} basedOn     the version that was changed (null for v1)
 * @property {string | null} changelog   the model's "- …" list of what it changed
 * @property {string | null} model
 * @property {VersionStatus} status
 * @property {string | null} name
 * @property {string | null} description
 * @property {string | null} source
 * @property {string | null} sourceSha256
 * @property {object | null} report
 * @property {string | null} error
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} GeneratedGame
 * @property {string} id                     "g-…"
 * @property {number} ownerUserId
 * @property {string} prompt                 the idea it was first made from
 * @property {number | null} publishedVersion
 * @property {number | null} playtestVersion
 * @property {GameVersion[]} versions        oldest first
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

/** @returns {GameVersion} */
function versionFromRow(row) {
  return {
    gameId: row.game_id,
    version: row.version,
    request: row.request,
    basedOn: row.based_on,
    changelog: row.changelog,
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

/** @returns {GeneratedGame | null} */
function gameFromRow(db, row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    prompt: row.prompt,
    publishedVersion: row.published_version,
    playtestVersion: row.playtest_version,
    versions: db.prepare('SELECT * FROM game_versions WHERE game_id = ? ORDER BY version').all(row.id).map(versionFromRow),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const touch = (db, gameId, now) => db.prepare('UPDATE generated_games SET updated_at = ? WHERE id = ?').run(now, gameId);

/**
 * Starts a new generated game: the game, plus its version 1 "generating" (the generator
 * fills it in later).
 * @returns {GeneratedGame}
 */
export function createGeneratedGame(db, { ownerUserId, prompt, model = null, now = Date.now() }) {
  const id = newGeneratedGameId();
  db.transaction(() => {
    db.prepare('INSERT INTO generated_games (id, owner_user_id, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      ownerUserId,
      prompt,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO game_versions (game_id, version, request, model, status, created_at, updated_at)
       VALUES (?, 1, ?, ?, 'generating', ?, ?)`,
    ).run(id, prompt, model, now, now);
  })();
  return getGeneratedGame(db, id);
}

/**
 * Starts the next version of a game: a change request on version `basedOn`.
 * @returns {number} the new version's number
 */
export function addVersion(db, gameId, { request, basedOn, model = null, now = Date.now() }) {
  return db.transaction(() => {
    const { next } = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM game_versions WHERE game_id = ?').get(gameId);
    db.prepare(
      `INSERT INTO game_versions (game_id, version, request, based_on, model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'generating', ?, ?)`,
    ).run(gameId, next, request, basedOn, model, now, now);
    touch(db, gameId, now);
    return next;
  })();
}

/**
 * Saves a version's finished code and test report: it's "ready". The fingerprint makes it
 * possible to prove later that the code that runs is exactly the code that was reviewed.
 */
export function saveVersionSource(db, gameId, version, { source, report, name, description, changelog = null, now = Date.now() }) {
  db.prepare(
    `UPDATE game_versions
     SET status = 'ready', source = ?, source_sha256 = ?, report_json = ?, name = ?, description = ?, changelog = ?, error = NULL, updated_at = ?
     WHERE game_id = ? AND version = ?`,
  ).run(source, sha256(source), JSON.stringify(report ?? null), name ?? null, description ?? null, changelog, now, gameId, version);
  touch(db, gameId, now);
}

/**
 * Generation failed: remember why. If the generator got as far as writing code, keep the
 * last attempt and its test report too, so the admin can see what went wrong.
 */
export function markVersionFailed(db, gameId, version, error, { source = null, report = null, changelog = null, now = Date.now() } = {}) {
  db.prepare(
    `UPDATE game_versions
     SET status = 'failed', error = ?, source = ?, source_sha256 = ?, report_json = ?, changelog = ?, updated_at = ?
     WHERE game_id = ? AND version = ?`,
  ).run(
    String(error).slice(0, 2000),
    source,
    source === null ? null : sha256(source),
    report === null ? null : JSON.stringify(report),
    changelog,
    now,
    gameId,
    version,
  );
  touch(db, gameId, now);
}

/** Every version still "generating" (after a restart, these were interrupted). */
export function listGeneratingVersions(db) {
  return db.prepare("SELECT * FROM game_versions WHERE status = 'generating' ORDER BY created_at").all().map(versionFromRow);
}

/**
 * Chooses the live versions. Leave a field out to keep it; null takes it down.
 * @param {{ publishedVersion?: number | null, playtestVersion?: number | null, now?: number }} live
 * @returns {boolean} false if there's no such game
 */
export function setLiveVersions(db, gameId, { publishedVersion, playtestVersion, now = Date.now() }) {
  const game = db.prepare('SELECT * FROM generated_games WHERE id = ?').get(gameId);
  if (!game) return false;
  db.prepare('UPDATE generated_games SET published_version = ?, playtest_version = ?, updated_at = ? WHERE id = ?').run(
    publishedVersion === undefined ? game.published_version : publishedVersion,
    playtestVersion === undefined ? game.playtest_version : playtestVersion,
    now,
    gameId,
  );
  return true;
}

/** @returns {GeneratedGame | null} */
export function getGeneratedGame(db, id) {
  return gameFromRow(db, db.prepare('SELECT * FROM generated_games WHERE id = ?').get(id));
}

/** Every generated game, newest first (for the admin). @returns {GeneratedGame[]} */
export function listGeneratedGames(db) {
  return db
    .prepare('SELECT * FROM generated_games ORDER BY created_at DESC, id')
    .all()
    .map((row) => gameFromRow(db, row));
}

/**
 * The versions the server should run: each game's published and playtest versions.
 * @returns {{ game: GeneratedGame, version: GameVersion, as: 'published' | 'playtest' }[]}
 */
export function listLiveVersions(db) {
  return listGeneratedGames(db)
    .reverse() // oldest first: the order they were made
    .flatMap((game) =>
      [
        ['published', game.publishedVersion],
        ['playtest', game.playtestVersion],
      ]
        .map(([as, number]) => ({ game, version: game.versions.find((v) => v.version === number), as }))
        .filter(({ version }) => version?.status === 'ready' && version.source !== null),
    );
}

export function deleteGeneratedGame(db, id) {
  return db.prepare('DELETE FROM generated_games WHERE id = ?').run(id).changes === 1;
}

// --- Describing a game (for the admin page and the admin script) ----------------------------

/**
 * One word for where a game is, for lists:
 *   generating: a version is being made     published / playtest: live
 *   failed: its newest version failed       review: has code, but nothing is live
 * @param {GeneratedGame} game
 */
export function gameStatus(game) {
  if (game.versions.some((v) => v.status === 'generating')) return 'generating';
  if (game.publishedVersion !== null) return 'published';
  if (game.playtestVersion !== null) return 'playtest';
  return game.versions.at(-1)?.status === 'failed' ? 'failed' : 'review';
}

/** The version that names the game: the published one, else the playtest one, else the newest ready one. */
export function mainVersion(game) {
  const find = (number) => game.versions.find((v) => v.version === number);
  return find(game.publishedVersion) ?? find(game.playtestVersion) ?? game.versions.findLast((v) => v.status === 'ready') ?? null;
}
