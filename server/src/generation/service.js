// THE GENERATION SERVICE (plan §11, A5; versions since K6 §12e): the server's side of
// AI-generated games.
//
// - Starting: an admin's idea becomes a game with version 1 "generating", and joins a queue.
//   Asking for changes adds the next version the same way, made from an earlier version's
//   code plus the request. Jobs run ONE AT A TIME, each in its own OpenShell sandbox
//   (sandbox.js): GenAI Studio allows only 20 requests a minute, and each sandbox needs
//   memory. A game has at most one version generating at a time.
// - Finishing: a passing version is saved as "ready" for review. A failed one keeps its
//   reason, and its last attempt if there was one.
// - Going live: the admin playtests a ready version (only they can start it), then
//   publishes it (everyone can). The published version keeps running for everyone while a
//   newer one is playtested. Changes apply to the running server's game list immediately.
//   Code runs on this server only once the admin has chosen to playtest it.
// - Restarts: versions that were generating when the server stopped are marked failed.

import {
  createGeneratedGame,
  addVersion,
  saveVersionSource,
  markVersionFailed,
  setLiveVersions,
  getGeneratedGame,
  listGeneratedGames,
  listGeneratingVersions,
  deleteGeneratedGame,
} from '../db/generatedGames.js';
import { liveGameId, registerVersion } from '../games/generated.js';
import { runGeneratorInSandbox } from './sandbox.js';
import { MODELS, DEFAULT_MODEL, isAllowedModel } from '../../../generator/src/models.js';

export const MIN_IDEA_LENGTH = 10;
export const MAX_IDEA_LENGTH = 1000;
/** At most this many jobs waiting or running at once, so nobody can queue up hours of work. */
export const MAX_QUEUED = 5;
/** Progress lines kept per job (the admin page shows them while it runs). */
const MAX_STEPS = 50;

/** A refusal with an HTTP status and a code the admin page can show. */
export class GenerationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Flipped to true in F5, once the generator in the sandbox writes frame games. */
const SANDBOX_MAKES_FRAME_GAMES = false;

export class GenerationService {
  /**
   * @param {Object} deps
   * @param {import('better-sqlite3').Database} deps.db
   * @param {import('../games/registry.js').GameRegistry} deps.games   the running server's games
   * @param {boolean} deps.enabled      false: generating is switched off (managing games still works)
   * @param {typeof runGeneratorInSandbox} [deps.runGenerator]   tests pass a fake
   * @param {(message: string) => void} [deps.log]
   */
  constructor({ db, games, enabled, runGenerator = runGeneratorInSandbox, log = (m) => console.log(m) }) {
    this.db = db;
    this.games = games;
    // Branch iframe-games: the sandbox's generator was written for block games, which this
    // server no longer runs. It comes back for frame games in F5 (plan §13i). Until then
    // only a stand-in generator (the tests' fake) can make games.
    const sandboxReady = runGenerator !== runGeneratorInSandbox || SANDBOX_MAKES_FRAME_GAMES;
    this.enabled = Boolean(enabled) && sandboxReady;
    this.disabledReason = !enabled
      ? "Generating games isn't set up on this server (start it with GENERATION_ENABLED=1; see generator/README.md)."
      : sandboxReady
        ? null
        : "The AI generator doesn't make frame games yet (plan §13, milestone F5).";
    this.runGenerator = runGenerator;
    this.log = log;
    /** @type {string[]} ids of games with a version waiting to run, oldest first */
    this.queue = [];
    /** @type {string | null} the game whose version is running right now */
    this.running = null;
    /** @type {Map<string, { seconds: number, text: string }[]>} progress of queued/running jobs, by game id */
    this.steps = new Map();
    /** @type {Promise<void>} settles when the current job finishes (tests wait on it) */
    this.current = Promise.resolve();
  }

  /** On startup: anything still "generating" was cut off by a restart. */
  recoverInterrupted() {
    for (const v of listGeneratingVersions(this.db)) {
      markVersionFailed(this.db, v.gameId, v.version, 'The server restarted while this version was being made. Try again.');
    }
  }

  /** What the admin page needs to know before starting anything. */
  info() {
    return { enabled: this.enabled, disabledReason: this.disabledReason, models: MODELS, defaultModel: DEFAULT_MODEL, minIdeaLength: MIN_IDEA_LENGTH, maxIdeaLength: MAX_IDEA_LENGTH };
  }

  /** Refuses new work if generating is off or the queue is full. */
  checkCanQueue() {
    if (!this.enabled) {
      throw new GenerationError(503, 'GENERATION_DISABLED', this.disabledReason);
    }
    if (this.queue.length + (this.running ? 1 : 0) >= MAX_QUEUED) {
      throw new GenerationError(429, 'QUEUE_FULL', `${MAX_QUEUED} games are already being made. Wait for one to finish.`);
    }
  }

  /**
   * Starts generating a new game. Returns right away; the work happens in the background.
   * @param {{ ownerUserId: number, idea: unknown, model?: unknown }} request  idea/model are untrusted input
   */
  start({ ownerUserId, idea, model = DEFAULT_MODEL }) {
    this.checkCanQueue();
    const trimmed = checkText(idea, 'INVALID_IDEA', 'Describe the game');
    checkModel(model);
    const game = createGeneratedGame(this.db, { ownerUserId, prompt: trimmed, model });
    this.enqueue(game.id);
    return this.get(game.id);
  }

  /**
   * Asks for changes to a game: makes its next version from version `basedOn` (by default
   * the one being playtested, else the published one, else the newest ready one).
   * @param {{ id: string, request: unknown, basedOn?: unknown, model?: unknown }} change  untrusted input
   */
  requestChanges({ id, request, basedOn, model = DEFAULT_MODEL }) {
    const game = this.get(id);
    this.checkCanQueue();
    const trimmed = checkText(request, 'INVALID_REQUEST', 'Describe the change');
    checkModel(model);
    if (game.versions.some((v) => v.status === 'generating')) {
      throw new GenerationError(409, 'BUSY', 'A version of this game is already being made. Wait for it to finish.');
    }
    const base =
      basedOn === undefined
        ? (findVersion(game, game.playtestVersion) ?? findVersion(game, game.publishedVersion) ?? game.versions.findLast((v) => v.status === 'ready'))
        : findVersion(game, basedOn);
    if (!base || base.status !== 'ready') {
      throw new GenerationError(409, 'NO_BASE_VERSION', 'Changes can only be made to a version that passed the tests.');
    }
    addVersion(this.db, id, { request: trimmed, basedOn: base.version, model });
    this.enqueue(id);
    return this.get(id);
  }

  enqueue(id) {
    this.steps.set(id, []);
    this.queue.push(id);
    this.next();
  }

  /** Runs the next queued job, if nothing is running. */
  next() {
    if (this.running || this.queue.length === 0) return;
    const id = this.queue.shift();
    this.running = id;
    this.current = this.run(id).finally(() => {
      this.running = null;
      this.steps.delete(id);
      this.next();
    });
  }

  /** Makes the game's generating version: a new game from its idea, or a change. */
  async run(id) {
    const game = getGeneratedGame(this.db, id);
    const version = game?.versions.find((v) => v.status === 'generating');
    if (!version) return; // deleted while it waited
    const started = Date.now();
    const onStep = (text) => {
      const steps = this.steps.get(id);
      if (steps && steps.length < MAX_STEPS) steps.push({ seconds: Math.round((Date.now() - started) / 1000), text });
    };

    const job = { idea: game.prompt, model: version.model };
    if (version.basedOn !== null) {
      // The requests that led to the base version, oldest first, so the model knows the history.
      const earlierRequests = [];
      for (let v = findVersion(game, version.basedOn); v && v.basedOn !== null; v = findVersion(game, v.basedOn)) {
        earlierRequests.unshift(v.request);
      }
      job.change = { request: version.request, source: findVersion(game, version.basedOn).source, earlierRequests };
    }

    this.log(`[generate] ${id} v${version.version}: started with ${version.model}`);
    let result;
    try {
      result = await this.runGenerator(job, { onStep });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (!getGeneratedGame(this.db, id)) return; // deleted while it was running

    const changelog = result.changelog ?? null;
    if (result.ok && result.source) {
      const { name, description } = result.report?.game ?? {};
      saveVersionSource(this.db, id, version.version, { source: result.source, report: result.report, name, description, changelog });
      this.log(`[generate] ${id} v${version.version}: ready for review (${name ?? 'unnamed'})`);
    } else {
      const saved = { source: result.source ?? null, report: result.report ?? null, changelog };
      markVersionFailed(this.db, id, version.version, result.error ?? 'unknown error', saved);
      this.log(`[generate] ${id} v${version.version}: failed: ${result.error}`);
    }
  }

  /** Where a game's job is: its place in line (0 = running now) and its progress so far. */
  progress(id) {
    if (this.running === id) return { queuePosition: 0, steps: this.steps.get(id) ?? [] };
    const at = this.queue.indexOf(id);
    return at === -1 ? null : { queuePosition: at + 1, steps: [] };
  }

  list() {
    return listGeneratedGames(this.db);
  }

  /** @returns {import('../db/generatedGames.js').GeneratedGame} */
  get(id) {
    const game = typeof id === 'string' ? getGeneratedGame(this.db, id) : null;
    if (!game) throw new GenerationError(404, 'NOT_FOUND', 'There is no such game.');
    return game;
  }

  /**
   * Playtests a ready version: only the game's owner can start it, next to the published
   * version (if any), which everyone keeps playing. Replaces any other playtest version.
   * The code is checked first: it must be exactly what the tests passed (its fingerprint)
   * and must load as a valid game.
   */
  async playtest(id, versionNumber) {
    const game = this.get(id);
    const version = findVersion(game, versionNumber);
    if (!version) throw new GenerationError(404, 'NOT_FOUND', 'There is no such version.');
    if (version.status !== 'ready') throw new GenerationError(409, 'WRONG_STATUS', 'Only a version that passed the tests can be playtested.');
    if (version.version === game.publishedVersion) throw new GenerationError(409, 'WRONG_STATUS', 'This version is already published.');

    this.unload(game, 'playtest');
    await this.load(game, version, 'playtest');
    setLiveVersions(this.db, id, { playtestVersion: version.version });
    this.log(`[generate] ${id}: playtesting v${version.version}`);
    return this.get(id);
  }

  /** Publishes the version being playtested: every host gets it, replacing the published one. */
  async publish(id) {
    const game = this.get(id);
    const version = findVersion(game, game.playtestVersion);
    if (!version) throw new GenerationError(409, 'WRONG_STATUS', 'Playtest a version before publishing it.');

    // Swaps in for the published version only once it has loaded: a failure changes nothing.
    await this.load(game, version, 'published', { replace: true });
    this.unload(game, 'playtest');
    setLiveVersions(this.db, id, { publishedVersion: version.version, playtestVersion: null });
    this.log(`[generate] ${id}: published v${version.version}`);
    return this.get(id);
  }

  /** Takes a live version down: 'playtest' ends the playtest, 'published' unpublishes the game. */
  takeDown(id, as) {
    const game = this.get(id);
    this.unload(game, as);
    setLiveVersions(this.db, id, as === 'published' ? { publishedVersion: null } : { playtestVersion: null });
    this.log(`[generate] ${id}: ${as} version taken down`);
    return this.get(id);
  }

  /** Loads a reviewed version into the running server. */
  async load(game, version, as, opts) {
    try {
      await registerVersion(this.games, game, version, as, opts);
    } catch (err) {
      const code = /doesn't match/.test(err.message) ? 'CODE_CHANGED' : 'LOAD_FAILED';
      throw new GenerationError(code === 'CODE_CHANGED' ? 409 : 422, code, `This version couldn't be loaded: ${err.message.split('\n')[0]}`);
    }
  }

  /** Removes a game's live version from the running server (games already being played finish). */
  unload(game, as) {
    const number = as === 'published' ? game.publishedVersion : game.playtestVersion;
    if (number !== null) this.games.unregister(liveGameId(game.id, as, number));
  }

  /** Deletes a game and all its versions for good (it disappears from the game picker right away). */
  remove(id) {
    const game = this.get(id);
    if (this.running === id) throw new GenerationError(409, 'WRONG_STATUS', "A game can't be deleted while a version is being made.");
    if (this.queue.includes(id)) {
      this.queue.splice(this.queue.indexOf(id), 1); // still waiting: just drop it
      this.steps.delete(id);
    }
    this.unload(game, 'published');
    this.unload(game, 'playtest');
    deleteGeneratedGame(this.db, id);
  }
}

/** @returns {import('../db/generatedGames.js').GameVersion | undefined} */
function findVersion(game, number) {
  return number === null ? undefined : game.versions.find((v) => v.version === number);
}

/** An idea or change request: trimmed, and of a sensible length. */
function checkText(text, code, what) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed.length < MIN_IDEA_LENGTH || trimmed.length > MAX_IDEA_LENGTH) {
    throw new GenerationError(400, code, `${what} in ${MIN_IDEA_LENGTH}–${MAX_IDEA_LENGTH} characters.`);
  }
  return trimmed;
}

function checkModel(model) {
  if (typeof model !== 'string' || !isAllowedModel(model)) {
    throw new GenerationError(400, 'INVALID_MODEL', `The model must be one of: ${MODELS.map((m) => m.id).join(', ')}.`);
  }
}
