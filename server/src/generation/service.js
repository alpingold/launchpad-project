// THE GENERATION SERVICE (plan §11, A5; versions since K6 §12e; designs first since F5
// §13i): the server's side of AI-generated games.
//
// - Starting: an admin's idea becomes a game whose version 1 is "designing": the model
//   writes a short design. The admin reads it, asks for changes (a new draft) or edits it,
//   and clicks "Build it": then the code is written from the approved design. Asking for
//   changes adds the next version the same way, with a short plan of the change first
//   (or, for a small fix, straight to the code).
// - Every model step is a job. Jobs run ONE AT A TIME, each in its own OpenShell sandbox
//   (sandbox.js): GenAI Studio allows only 20 requests a minute, and each sandbox needs
//   memory. A game has at most one version in progress at a time.
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
  listBusyVersions,
  deleteGeneratedGame,
  startRedraft,
  saveDraft,
  designFailed,
  startBuild,
  deleteVersion,
  saveBuildAttempts,
  BUSY_STATUSES,
} from '../db/generatedGames.js';
import { liveGameId, registerVersion } from '../games/generated.js';
import { runGeneratorInSandbox } from './sandbox.js';
import { MODELS, DEFAULT_MODEL, isAllowedModel } from '../../../generator/src/models.js';
import { MAX_DESIGN_LENGTH } from '../../../generator/src/extract.js';

export const MIN_IDEA_LENGTH = 10;
export const MAX_IDEA_LENGTH = 1000;
/** Feedback on a design ("make it 2 rounds") may be shorter than an idea. */
export const MIN_FEEDBACK_LENGTH = 3;
/** A design the admin edits by hand. */
export const MIN_DESIGN_LENGTH = 20;
export { MAX_DESIGN_LENGTH };
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
    this.enabled = Boolean(enabled);
    this.disabledReason = this.enabled
      ? null
      : "Generating games isn't set up on this server (start it with GENERATION_ENABLED=1; see generator/README.md).";
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

  /** On startup: anything the sandbox was working on was cut off by a restart. */
  recoverInterrupted() {
    for (const v of listBusyVersions(this.db)) {
      if (v.status === 'designing') {
        // With an earlier draft, it waits on that one again; without, it has failed.
        designFailed(this.db, v.gameId, v.version, 'The server restarted while this draft was being written. Try again.');
      } else {
        markVersionFailed(this.db, v.gameId, v.version, 'The server restarted while this version was being made. Try again.');
      }
    }
  }

  /** What the admin page needs to know before starting anything. */
  info() {
    return {
      enabled: this.enabled,
      disabledReason: this.disabledReason,
      models: MODELS,
      defaultModel: DEFAULT_MODEL,
      minIdeaLength: MIN_IDEA_LENGTH,
      maxIdeaLength: MAX_IDEA_LENGTH,
      minFeedbackLength: MIN_FEEDBACK_LENGTH,
      maxDesignLength: MAX_DESIGN_LENGTH,
    };
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
   * Starts a new game: its design is written first. Returns right away; the work happens in
   * the background.
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
   * the one being playtested, else the published one, else the newest ready one). It starts
   * with a plan of the change, unless `skipDesign` (a small fix: straight to the code).
   * @param {{ id: string, request: unknown, basedOn?: unknown, model?: unknown, skipDesign?: unknown }} change  untrusted input
   */
  requestChanges({ id, request, basedOn, model = DEFAULT_MODEL, skipDesign = false }) {
    const game = this.get(id);
    this.checkCanQueue();
    const trimmed = checkText(request, 'INVALID_REQUEST', 'Describe the change');
    checkModel(model);
    const open = game.versions.find((v) => BUSY_STATUSES.includes(v.status) || v.status === 'design_ready');
    if (open) {
      const why = open.status === 'design_ready' ? `v${open.version}'s ${open.basedOn === null ? 'design' : 'plan'} is waiting for you: build it or discard it first.` : 'A version of this game is already being made. Wait for it to finish.';
      throw new GenerationError(409, 'BUSY', why);
    }
    const base =
      basedOn === undefined
        ? (findVersion(game, game.playtestVersion) ?? findVersion(game, game.publishedVersion) ?? game.versions.findLast((v) => v.status === 'ready'))
        : findVersion(game, basedOn);
    if (!base || base.status !== 'ready') {
      throw new GenerationError(409, 'NO_BASE_VERSION', 'Changes can only be made to a version that passed the tests.');
    }
    addVersion(this.db, id, { request: trimmed, basedOn: base.version, model, status: skipDesign === true ? 'generating' : 'designing' });
    this.enqueue(id);
    return this.get(id);
  }

  /**
   * A version whose design (or plan) the admin may work on: waiting for them, or failed with
   * a design (to change it or build it again).
   */
  designedVersion(id, versionNumber) {
    const game = this.get(id);
    const version = findVersion(game, versionNumber);
    if (!version) throw new GenerationError(404, 'NOT_FOUND', 'There is no such version.');
    if (this.running === id || this.queue.includes(id)) throw new GenerationError(409, 'BUSY', 'This game has a job running. Wait for it to finish.');
    const open = version.status === 'design_ready' || (version.status === 'failed' && version.design !== null);
    if (!open) throw new GenerationError(409, 'WRONG_STATUS', 'This version has no design waiting for you.');
    return { game, version };
  }

  /** "Change the design": the model writes a new draft with the admin's feedback. */
  redesign({ id, version: versionNumber, feedback }) {
    const { version } = this.designedVersion(id, versionNumber);
    this.checkCanQueue();
    const trimmed = typeof feedback === 'string' ? feedback.trim() : '';
    if (trimmed.length < MIN_FEEDBACK_LENGTH || trimmed.length > MAX_IDEA_LENGTH) {
      throw new GenerationError(400, 'INVALID_FEEDBACK', `Say what to change in ${MIN_FEEDBACK_LENGTH}–${MAX_IDEA_LENGTH} characters.`);
    }
    startRedraft(this.db, id, version.version, trimmed);
    this.enqueue(id);
    return this.get(id);
  }

  /** The admin's own edit of the design: saved as a new draft, right away. */
  editDesign({ id, version: versionNumber, design }) {
    const { version } = this.designedVersion(id, versionNumber);
    const text = typeof design === 'string' ? design.trim() : '';
    if (text.length < MIN_DESIGN_LENGTH || text.length > MAX_DESIGN_LENGTH) {
      throw new GenerationError(400, 'INVALID_DESIGN', `A design is ${MIN_DESIGN_LENGTH}–${MAX_DESIGN_LENGTH} characters.`);
    }
    if (text === version.design?.trim()) return this.get(id); // nothing changed
    saveDraft(this.db, id, version.version, { text: `${text}\n`, by: 'admin' });
    return this.get(id);
  }

  /** "Build it": writes the code from the approved design (or tries again after a failed build). */
  build({ id, version: versionNumber }) {
    const { version } = this.designedVersion(id, versionNumber);
    this.checkCanQueue();
    startBuild(this.db, id, version.version);
    this.enqueue(id);
    return this.get(id);
  }

  /** Throws away the newest version while it's only a design (or failed), to ask for something else. */
  discard({ id, version: versionNumber }) {
    const game = this.get(id);
    const version = findVersion(game, versionNumber);
    if (!version) throw new GenerationError(404, 'NOT_FOUND', 'There is no such version.');
    if (version.version === 1) throw new GenerationError(409, 'WRONG_STATUS', 'Version 1 is the game itself: delete the game instead.');
    if (version !== game.versions.at(-1) || !['design_ready', 'failed'].includes(version.status)) {
      throw new GenerationError(409, 'WRONG_STATUS', 'Only the newest version can be discarded, while it has no code that passed.');
    }
    if (this.running === id || this.queue.includes(id)) throw new GenerationError(409, 'BUSY', 'This game has a job running. Wait for it to finish.');
    deleteVersion(this.db, id, version.version);
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

  /** Runs the game's job: a design (or plan, or new draft) for a "designing" version, or the build for a "generating" one. */
  async run(id) {
    const game = getGeneratedGame(this.db, id);
    const version = game?.versions.find((v) => BUSY_STATUSES.includes(v.status));
    if (!version) return; // deleted while it waited
    const started = Date.now();
    // `replace`: how far a reply has streamed in, which updates the last step instead of adding one.
    const onStep = (text, { replace = false } = {}) => {
      const steps = this.steps.get(id);
      if (!steps) return;
      const step = { seconds: Math.round((Date.now() - started) / 1000), text, live: replace };
      if (replace && steps.length > 0) steps[steps.length - 1] = step;
      else if (steps.length < MAX_STEPS) steps.push(step);
    };
    const designing = version.status === 'designing';
    const job = this.jobFor(game, version);

    this.log(`[generate] ${id} v${version.version}: ${designing ? (job.redraft ? 'new draft' : 'design') : 'build'} started with ${version.model}`);
    let result;
    try {
      result = await this.runGenerator(job, { onStep });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (!getGeneratedGame(this.db, id)) return; // deleted while it was running

    if (designing) {
      if (result.ok && typeof result.design === 'string') {
        saveDraft(this.db, id, version.version, { text: result.design.slice(0, MAX_DESIGN_LENGTH), by: 'ai', feedback: version.designFeedback });
        this.log(`[generate] ${id} v${version.version}: design ready`);
      } else {
        designFailed(this.db, id, version.version, result.error ?? 'unknown error');
        this.log(`[generate] ${id} v${version.version}: design failed: ${result.error}`);
      }
      return;
    }
    // Every attempt of this build, passing or not, is kept (plan §13n).
    if (Array.isArray(result.attempts) && result.attempts.length > 0) saveBuildAttempts(this.db, id, version.version, result.attempts);
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

  /** The sandbox job for a version's next step (generator/src/run.js describes them). */
  jobFor(game, version) {
    const designing = version.status === 'designing';
    const job = { step: designing ? 'design' : 'build', idea: game.prompt, model: version.model };
    if (version.basedOn !== null) {
      // The requests that led to the base version, oldest first, so the model knows the history.
      const earlierRequests = [];
      for (let v = findVersion(game, version.basedOn); v && v.basedOn !== null; v = findVersion(game, v.basedOn)) {
        earlierRequests.unshift(v.request);
      }
      // The game's own design is version 1's (later versions hold change plans).
      const gameDesign = findVersion(game, 1)?.design ?? null;
      job.change = { request: version.request, source: findVersion(game, version.basedOn).source, design: gameDesign, earlierRequests };
      if (!designing) job.change.plan = version.design; // null for a small fix
    } else if (!designing) {
      job.design = version.design;
    }
    if (designing && version.designFeedback && version.design) {
      job.redraft = { draft: version.design, feedback: version.designFeedback };
    }
    return job;
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
    if (this.running === id) throw new GenerationError(409, 'WRONG_STATUS', "A game can't be deleted while its job is running.");
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
