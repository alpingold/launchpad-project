import { createHash, randomBytes } from 'node:crypto';
import { deleteGameReportsFor } from './reports.js';

// All SQL for AI-generated games (plan §11, versions since K6 §12e). The code itself is
// stored here, not in the repo: only hand-made "official" games live in the repo.
//
// A GAME is the idea and who owns it. Its code lives in VERSIONS: version 1 is made from
// the idea, and every "ask for changes" makes the next one from an earlier version.
// Each version is designed first and built only once the admin approves (plan §13i, F5):
//   designing → design_ready  (a draft to read: v1's design, or a change's plan)
//   design_ready → designing  (a new draft with the admin's feedback; or they edit it)
//   design_ready → generating (the admin clicked "Build it")
//   generating → ready        (passed the checks; code + report saved)
//   generating → failed       (the generator gave up; the design stays, to change or retry)
// A small fix can skip the design: its version starts at "generating". So does a "Review
// again" version (kind 'recheck', plan §47): another code review of the version it's based on.
// Every build is followed by a code review (plan §47): codeReview holds what it found.
// A game has at most two LIVE versions, chosen by the admin:
//   published_version: the one every host can start
//   playtest_version:  one only its owner can start, to try before publishing
// Only live versions are ever loaded into the server.

/** @typedef {'designing' | 'design_ready' | 'generating' | 'failed' | 'ready'} VersionStatus */
export const VERSION_STATUSES = Object.freeze(['designing', 'design_ready', 'generating', 'failed', 'ready']);
/** Statuses where the sandbox is (or will be) working on the version. */
export const BUSY_STATUSES = Object.freeze(['designing', 'generating']);

/**
 * One draft of a design or change plan.
 * @typedef {{ text: string, by: 'ai' | 'admin', feedback?: string, at: number }} DesignDraft
 */

/**
 * @typedef {Object} GameVersion
 * @property {string} gameId
 * @property {number} version            1, 2, 3, ...
 * @property {string} request            v1: the idea; later: the change request
 * @property {number | null} basedOn     the version that was changed (null for v1)
 * @property {string | null} changelog   the model's "- …" list of what it changed
 * @property {'recheck' | null} kind       'recheck': made by "Review again" (plan §47)
 * @property {object | null} codeReview    what the code review found and fixed (generator/src/review.js: CreatorReview),
 *                                         or { error } if it couldn't finish; null: not reviewed
 * @property {string | null} model
 * @property {VersionStatus} status
 * @property {string | null} design        the latest draft (once built: the design it was built from)
 * @property {DesignDraft[]} drafts        every draft, oldest first
 * @property {string | null} designFeedback  the admin's feedback while a new draft is written
 * @property {string | null} name
 * @property {string | null} description
 * @property {string | null} source
 * @property {string | null} sourceSha256
 * @property {import('../games/frameGame.js').CheckReport | null} report
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
 * @property {number | null} submittedVersion  the playtest version its creator asked to publish (plan §44)
 * @property {number | null} submittedAt
 * @property {string | null} reviewNote      why an admin sent it back
 * @property {number | null} reviewedAt
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
    kind: row.kind ?? null,
    codeReview: row.code_review_json ? JSON.parse(row.code_review_json) : null,
    model: row.model,
    status: row.status,
    design: row.design,
    drafts: row.drafts_json ? JSON.parse(row.drafts_json) : [],
    designFeedback: row.design_feedback,
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
    submittedVersion: row.submitted_version,
    submittedAt: row.submitted_at,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    versions: db.prepare('SELECT * FROM game_versions WHERE game_id = ? ORDER BY version').all(row.id).map(versionFromRow),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const touch = (db, gameId, now) => db.prepare('UPDATE generated_games SET updated_at = ? WHERE id = ?').run(now, gameId);

/**
 * Starts a new generated game: the game, plus its version 1, "designing" (the generator
 * writes its design first) or straight to "generating".
 * @returns {GeneratedGame}
 */
export function createGeneratedGame(db, { ownerUserId, prompt, model = null, status = 'designing', now = Date.now() }) {
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
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
    ).run(id, prompt, model, startStatus(status), now, now);
  })();
  return getGeneratedGame(db, id);
}

const startStatus = (status) => {
  if (status !== 'designing' && status !== 'generating') throw new Error(`a version can't start as ${status}`);
  return status;
};

/**
 * Starts the next version of a game: a change request on version `basedOn`, starting with
 * its plan ("designing"), or for a small fix straight at "generating".
 * @returns {number} the new version's number
 */
export function addVersion(db, gameId, { request, basedOn, model = null, status = 'designing', kind = null, now = Date.now() }) {
  return db.transaction(() => {
    const { next } = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM game_versions WHERE game_id = ?').get(gameId);
    db.prepare(
      `INSERT INTO game_versions (game_id, version, request, based_on, model, status, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(gameId, next, request, basedOn, model, startStatus(status), kind, now, now);
    touch(db, gameId, now);
    return next;
  })();
}

// --- Designs (plan §13i, F5) ----------------------------------------------------------------

/** The admin asked for a new draft: back to "designing", remembering what to change. */
export function startRedraft(db, gameId, version, feedback, { now = Date.now() } = {}) {
  db.prepare(
    `UPDATE game_versions SET status = 'designing', design_feedback = ?, error = NULL, updated_at = ? WHERE game_id = ? AND version = ?`,
  ).run(feedback, now, gameId, version);
  touch(db, gameId, now);
}

/**
 * A new draft (from the model, or the admin's own edit): it becomes the design, joins the
 * history, and the version waits for the admin ("design_ready").
 * @param {{ text: string, by: 'ai' | 'admin', feedback?: string | null, now?: number }} draft
 */
export function saveDraft(db, gameId, version, draft) {
  const { text, by, feedback = null, now = Date.now() } = draft;
  db.transaction(() => {
    const row = db.prepare('SELECT drafts_json FROM game_versions WHERE game_id = ? AND version = ?').get(gameId, version);
    if (!row) return;
    const drafts = row.drafts_json ? JSON.parse(row.drafts_json) : [];
    drafts.push({ text, by, ...(feedback ? { feedback } : {}), at: now });
    db.prepare(
      `UPDATE game_versions
       SET status = 'design_ready', design = ?, drafts_json = ?, design_feedback = NULL, error = NULL, updated_at = ?
       WHERE game_id = ? AND version = ?`,
    ).run(text, JSON.stringify(drafts), now, gameId, version);
    touch(db, gameId, now);
  })();
}

/**
 * Writing a draft failed. With an earlier draft, the version goes back to waiting on it
 * (the error says the new draft failed); without one, the version has failed.
 */
export function designFailed(db, gameId, version, error, { now = Date.now() } = {}) {
  db.prepare(
    `UPDATE game_versions
     SET status = CASE WHEN design IS NULL THEN 'failed' ELSE 'design_ready' END,
         design_feedback = NULL, error = ?, updated_at = ?
     WHERE game_id = ? AND version = ?`,
  ).run(String(error).slice(0, 2000), now, gameId, version);
  touch(db, gameId, now);
}

/** "Build it": the version is built from its design (again, after a failed build). */
export function startBuild(db, gameId, version, { now = Date.now() } = {}) {
  db.prepare(
    `UPDATE game_versions
     SET status = 'generating', error = NULL, source = NULL, source_sha256 = NULL, report_json = NULL, changelog = NULL, code_review_json = NULL, updated_at = ?
     WHERE game_id = ? AND version = ?`,
  ).run(now, gameId, version);
  touch(db, gameId, now);
}

/** Removes one version (the service only allows the newest, unbuilt one). */
export function deleteVersion(db, gameId, version, { now = Date.now() } = {}) {
  db.prepare('DELETE FROM game_versions WHERE game_id = ? AND version = ?').run(gameId, version);
  touch(db, gameId, now);
}

/**
 * Saves a version's finished code and test report: it's "ready". The fingerprint makes it
 * possible to prove later that the code that runs is exactly the code that was reviewed.
 */
export function saveVersionSource(db, gameId, version, { source, report, name, description, changelog = null, codeReview = null, now = Date.now() }) {
  db.prepare(
    `UPDATE game_versions
     SET status = 'ready', source = ?, source_sha256 = ?, report_json = ?, name = ?, description = ?, changelog = ?, code_review_json = ?, error = NULL, updated_at = ?
     WHERE game_id = ? AND version = ?`,
  ).run(source, sha256(source), JSON.stringify(report ?? null), name ?? null, description ?? null, changelog, codeReview === null ? null : JSON.stringify(codeReview), now, gameId, version);
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

// --- Build attempts (plan §13n) ------------------------------------------------------------

/**
 * One attempt at building a version.
 * @typedef {Object} BuildAttempt
 * @property {number} build      1, or more if the version was built again after failing
 * @property {number} attempt    1–4 within that build
 * @property {'whole' | 'edits' | null} mode  how the model wrote it (plan §23): the whole file, or edits to the last one
 * @property {boolean} ok
 * @property {string | null} source
 * @property {import('../games/frameGame.js').CheckReport | null} report   without screenshots
 * @property {number | null} seconds
 * @property {number | null} promptTokens
 * @property {number | null} completionTokens
 * @property {number} createdAt
 */

/**
 * Saves the attempts of one build of a version (as the generator returned them), as the
 * next build number. Attempts without an attempt number are skipped.
 * @param {{ attempt: number, mode?: 'whole' | 'edits', ok: boolean, source?: string | null, report?: object | null, seconds?: number,
 *   usage?: { prompt_tokens?: number, completion_tokens?: number } | null }[]} attempts
 * @returns {number} the build number
 */
export function saveBuildAttempts(db, gameId, version, attempts, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const { next } = db
      .prepare('SELECT COALESCE(MAX(build), 0) + 1 AS next FROM build_attempts WHERE game_id = ? AND version = ?')
      .get(gameId, version);
    const insert = db.prepare(
      `INSERT INTO build_attempts (game_id, version, build, attempt, mode, ok, source, report_json, seconds, prompt_tokens, completion_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const a of attempts ?? []) {
      if (!Number.isInteger(a?.attempt)) continue;
      insert.run(
        gameId,
        version,
        next,
        a.attempt,
        a.mode === 'whole' || a.mode === 'edits' ? a.mode : null,
        a.ok ? 1 : 0,
        typeof a.source === 'string' ? a.source : null,
        a.report ? JSON.stringify(a.report) : null,
        Number.isFinite(a.seconds) ? a.seconds : null,
        Number.isFinite(a.usage?.prompt_tokens) ? a.usage.prompt_tokens : null,
        Number.isFinite(a.usage?.completion_tokens) ? a.usage.completion_tokens : null,
        now,
      );
    }
    return next;
  })();
}

/**
 * A game's build attempts, by version (oldest first). Kept out of getGeneratedGame, which
 * the game list uses: attempts hold whole files.
 * @returns {Map<number, BuildAttempt[]>}
 */
export function listBuildAttempts(db, gameId) {
  const byVersion = new Map();
  const rows = db.prepare('SELECT * FROM build_attempts WHERE game_id = ? ORDER BY version, build, attempt').all(gameId);
  for (const row of rows) {
    if (!byVersion.has(row.version)) byVersion.set(row.version, []);
    byVersion.get(row.version).push({
      build: row.build,
      attempt: row.attempt,
      mode: row.mode,
      ok: row.ok === 1,
      source: row.source,
      report: row.report_json ? JSON.parse(row.report_json) : null,
      seconds: row.seconds,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      createdAt: row.created_at,
    });
  }
  return byVersion;
}

/** Every version the sandbox was working on ("designing" or "generating"): after a restart, these were cut off. */
export function listBusyVersions(db) {
  return db.prepare("SELECT * FROM game_versions WHERE status IN ('designing', 'generating') ORDER BY created_at").all().map(versionFromRow);
}

/**
 * Chooses the live versions. Leave a field out to keep it; null takes it down.
 * @param {{ publishedVersion?: number | null, playtestVersion?: number | null, now?: number }} live
 * @returns {boolean} false if there's no such game
 */
export function setLiveVersions(db, gameId, live) {
  const { publishedVersion, playtestVersion, now = Date.now() } = live;
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

/**
 * Asking for publishing (plan §44): what the creator asked and what an admin answered. Leave a
 * field out to keep it; null clears it.
 * @param {{ submittedVersion?: number | null, submittedAt?: number | null, reviewNote?: string | null, reviewedAt?: number | null, now?: number }} fields
 */
export function setSubmission(db, gameId, fields) {
  const { now = Date.now() } = fields;
  const game = db.prepare('SELECT * FROM generated_games WHERE id = ?').get(gameId);
  if (!game) return false;
  const keep = (value, old) => (value === undefined ? old : value);
  db.prepare('UPDATE generated_games SET submitted_version = ?, submitted_at = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?').run(
    keep(fields.submittedVersion, game.submitted_version),
    keep(fields.submittedAt, game.submitted_at),
    keep(fields.reviewNote, game.review_note),
    keep(fields.reviewedAt, game.reviewed_at),
    now,
    gameId,
  );
  return true;
}

/** Is this game waiting for an admin: its creator asked to publish the version they're playtesting? */
export function isSubmitted(db, gameId) {
  return Boolean(
    db.prepare('SELECT 1 FROM generated_games WHERE id = ? AND submitted_version IS NOT NULL AND submitted_version = playtest_version').get(gameId),
  );
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
  return db.transaction(() => {
    // Its catalogue entry and votes (plan §16), and its bug reports (§31b), go with it.
    db.prepare('DELETE FROM game_pages WHERE game_id = ?').run(id);
    db.prepare('DELETE FROM game_votes WHERE game_id = ?').run(id);
    deleteGameReportsFor(db, id);
    return db.prepare('DELETE FROM generated_games WHERE id = ?').run(id).changes === 1;
  })();
}

// --- Describing a game (for the admin page and the admin script) ----------------------------

/**
 * One word for where a game is, for lists:
 *   designing: a design is being written    design: a design is waiting for you
 *   generating: a version is being built    published / playtest: live
 *   failed: its newest version failed       review: has code, but nothing is live
 * @param {GeneratedGame} game
 */
export function gameStatus(game) {
  if (game.versions.some((v) => v.status === 'designing')) return 'designing';
  if (game.versions.some((v) => v.status === 'generating')) return 'generating';
  if (game.versions.some((v) => v.status === 'design_ready')) return 'design';
  if (game.publishedVersion !== null) return 'published';
  if (game.playtestVersion !== null) return 'playtest';
  return game.versions.at(-1)?.status === 'failed' ? 'failed' : 'review';
}

/** The version that names the game: the published one, else the playtest one, else the newest ready one. */
export function mainVersion(game) {
  const find = (number) => game.versions.find((v) => v.version === number);
  return find(game.publishedVersion) ?? find(game.playtestVersion) ?? game.versions.findLast((v) => v.status === 'ready') ?? null;
}
