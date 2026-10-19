// THE GENERATION SERVICE (plan §11, A5; versions since K6 §12e; designs first since F5
// §13i): the server's side of AI-generated games.
//
// - Starting: an admin's idea becomes a game whose version 1 is "designing": the model
//   writes a short design. The admin reads it, asks for changes (a new draft) or edits it,
//   and clicks "Build it": then the code is written from the approved design. Asking for
//   changes adds the next version the same way, with a short plan of the change first
//   (or, for a small fix, straight to the code).
// - Every build ends with a code review (plan §47): the AI reads the code against the design,
//   fixes the crashes and dead ends it finds, and what it found is kept for the creator.
//   "Review again" makes the next version with one more review round.
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
  setSubmission,
  isSubmitted,
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
import { BrowserSlot } from './browserSlot.js';
import { isAdminUser } from '../db/users.js';
import { MODELS, DEFAULT_MODEL, isAllowedModel } from '../../../generator/src/models.js';
import { MAX_DESIGN_LENGTH } from '../../../generator/src/extract.js';
// What people may type: the same numbers the generator checks (generator/src/prompt.js says why).
import { MIN_IDEA_LENGTH, MIN_FEEDBACK_LENGTH, MAX_IDEA_LENGTH, MAX_REQUEST_LENGTH } from '../../../generator/src/prompt.js';

export { MIN_IDEA_LENGTH, MIN_FEEDBACK_LENGTH, MAX_IDEA_LENGTH, MAX_REQUEST_LENGTH };
/** A design the admin edits by hand. */
export const MIN_DESIGN_LENGTH = 20;
export { MAX_DESIGN_LENGTH };
/** A "Review again" version's request (plan §47): it has none of its own. */
export const RECHECK_REQUEST = 'Review the code again, and fix any crashes or dead ends it finds.';
/** At most this many jobs waiting in line (besides those running), so nobody can queue up hours of work. */
export const MAX_WAITING = 4;
/** Progress lines kept per job (the admin page shows them while it runs). */
const MAX_STEPS = 50;

/** A refusal with an HTTP status and a code the admin page can show. */
/** An admin's note when sending a game back (plan §44). */
export const MIN_NOTE_LENGTH = 3;
export const MAX_NOTE_LENGTH = 500;

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
   * @param {ReturnType<typeof import('./userKeys.js').createUserKeys>} [deps.userKeys]
   *   users' own GenAI Studio keys (plan §15): a job runs with its owner's key. Without one,
   *   only an admin's job may run (with the server's own key).
   * @param {(message: string) => void} [deps.log]
   * @param {number} [deps.maxRunning]  jobs that may run at the same time (config.GENERATION_MAX_RUNNING)
   * @param {BrowserSlot} [deps.browserSlot]  shared by all jobs: how many browser checks run at once (plan §28)
   */
  constructor({ db, games, enabled, runGenerator = runGeneratorInSandbox, userKeys = null, log = (m) => console.log(m), maxRunning = 1, browserSlot = new BrowserSlot() }) {
    this.db = db;
    this.userKeys = userKeys;
    this.games = games;
    this.enabled = Boolean(enabled);
    this.disabledReason = this.enabled
      ? null
      : "Generating games isn't set up on this server (start it with GENERATION_ENABLED=1; see generator/README.md).";
    this.runGenerator = runGenerator;
    this.log = log;
    this.maxRunning = Math.max(1, maxRunning);
    this.browserSlot = browserSlot;
    /** @type {string[]} ids of games with a version waiting to run, oldest first */
    this.queue = [];
    /** @type {Map<string, Promise<void>>} the games whose versions are running right now, and their jobs */
    this.running = new Map();
    /** @type {Map<string, { seconds: number, text: string }[]>} progress of queued/running jobs, by game id */
    this.steps = new Map();
    /** @type {Promise<unknown>} settles when the jobs running now finish (tests wait on it) */
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
      maxRequestLength: MAX_REQUEST_LENGTH,
      minFeedbackLength: MIN_FEEDBACK_LENGTH,
      maxDesignLength: MAX_DESIGN_LENGTH,
    };
  }

  /**
   * Refuses new work if generating is off, the queue is full, this person has no key to
   * use, or they already have a job waiting or running (one each, plan §15).
   * @param {number} ownerUserId  whose job it would be
   */
  checkCanQueue(ownerUserId) {
    if (!this.enabled) {
      throw new GenerationError(503, 'GENERATION_DISABLED', this.disabledReason);
    }
    if (!this.hasKey(ownerUserId)) {
      throw new GenerationError(403, 'NO_KEY', 'Save your GenAI Studio API key on your account page first.');
    }
    const busy = [...this.running.keys(), ...this.queue].some((id) => getGeneratedGame(this.db, id)?.ownerUserId === ownerUserId);
    if (busy) {
      throw new GenerationError(409, 'ALREADY_RUNNING', 'You already have a game being made. Wait for it to finish, then start the next one.');
    }
    if (this.running.size >= this.maxRunning && this.queue.length >= MAX_WAITING) {
      throw new GenerationError(429, 'QUEUE_FULL', `${this.running.size + this.queue.length} games are already being made. Wait for one to finish.`);
    }
  }

  /** Can this person's jobs run: their own saved key, or (admins) the server's? */
  hasKey(userId) {
    return isAdminUser(this.db, userId) || (this.userKeys?.status(userId).saved ?? false);
  }

  /**
   * Starts a new game: its design is written first. Returns right away; the work happens in
   * the background.
   * @param {{ ownerUserId: number, idea: unknown, model?: unknown }} request  idea/model are untrusted input
   */
  start({ ownerUserId, idea, model = DEFAULT_MODEL }) {
    this.checkCanQueue(ownerUserId);
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
  requestChanges({ id, request, basedOn, model = DEFAULT_MODEL, skipDesign = false, kind = null }) {
    const game = this.get(id);
    const trimmed = checkText(request, 'INVALID_REQUEST', 'Describe the change', MAX_REQUEST_LENGTH);
    checkModel(model);
    const open = game.versions.find((v) => BUSY_STATUSES.includes(v.status) || v.status === 'design_ready');
    if (open) {
      const why = open.status === 'design_ready' ? `v${open.version}'s ${open.basedOn === null ? 'design' : 'plan'} is waiting for you: build it or discard it first.` : 'A version of this game is already being made. Wait for it to finish.';
      throw new GenerationError(409, 'BUSY', why);
    }
    this.checkCanQueue(game.ownerUserId);
    const base =
      basedOn === undefined
        ? (findVersion(game, game.playtestVersion) ?? findVersion(game, game.publishedVersion) ?? game.versions.findLast((v) => v.status === 'ready'))
        : findVersion(game, basedOn);
    if (!base || base.status !== 'ready') {
      throw new GenerationError(409, 'NO_BASE_VERSION', 'Changes can only be made to a version that passed the tests.');
    }
    addVersion(this.db, id, { request: trimmed, basedOn: base.version, model, kind, status: skipDesign === true ? 'generating' : 'designing' });
    this.enqueue(id);
    return this.get(id);
  }

  /**
   * "Review again" (plan §47): the next version is another code review round on version
   * `basedOn` (by default the same as for changes). Crashes and dead ends it finds are fixed;
   * if there are none, the new version has the same code, with the new review.
   * @param {{ id: string, basedOn?: unknown, model?: unknown }} recheck  untrusted input
   */
  reviewAgain({ id, basedOn, model = DEFAULT_MODEL }) {
    return this.requestChanges({ id, request: RECHECK_REQUEST, basedOn, model, skipDesign: true, kind: 'recheck' });
  }

  /**
   * A version whose design (or plan) the admin may work on: waiting for them, or failed with
   * a design (to change it or build it again).
   */
  designedVersion(id, versionNumber) {
    const game = this.get(id);
    const version = findVersion(game, versionNumber);
    if (!version) throw new GenerationError(404, 'NOT_FOUND', 'There is no such version.');
    if (this.running.has(id) || this.queue.includes(id)) throw new GenerationError(409, 'BUSY', 'This game has a job running. Wait for it to finish.');
    const open = version.status === 'design_ready' || (version.status === 'failed' && version.design !== null);
    if (!open) throw new GenerationError(409, 'WRONG_STATUS', 'This version has no design waiting for you.');
    return { game, version };
  }

  /** "Change the design": the model writes a new draft with the admin's feedback. */
  redesign({ id, version: versionNumber, feedback }) {
    const { game, version } = this.designedVersion(id, versionNumber);
    this.checkCanQueue(game.ownerUserId);
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
    const { game, version } = this.designedVersion(id, versionNumber);
    this.checkCanQueue(game.ownerUserId);
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
    if (this.running.has(id) || this.queue.includes(id)) throw new GenerationError(409, 'BUSY', 'This game has a job running. Wait for it to finish.');
    deleteVersion(this.db, id, version.version);
    return this.get(id);
  }

  enqueue(id) {
    this.steps.set(id, []);
    this.queue.push(id);
    this.next();
  }

  /**
   * Starts queued jobs while there's room: up to maxRunning at once. A job spends most of its
   * time waiting for the AI (~70 MB); its short browser check is the heavy part (~450 MB,
   * measured 2026-10-17), and the browser slot lets only one of those run at a time (plan §28).
   */
  next() {
    while (this.running.size < this.maxRunning && this.queue.length > 0) {
      const id = this.queue.shift();
      const job = this.run(id).finally(() => {
        this.running.delete(id);
        this.steps.delete(id);
        this.next();
      });
      this.running.set(id, job);
    }
    this.current = Promise.all(this.running.values());
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

    // The owner's own key (plan §15); none: an admin's job uses the server's key. Never logged.
    const apiKey = this.userKeys?.keyFor(game.ownerUserId) ?? null;

    const what = designing ? (job.redraft ? 'new draft' : 'design') : job.step === 'recheck' ? 'code review' : 'build';
    this.log(`[generate] ${id} v${version.version}: ${what} started with ${version.model}${apiKey ? " (the owner's key)" : ''}`);
    let result;
    if (!apiKey && !isAdminUser(this.db, game.ownerUserId)) {
      result = { ok: false, error: "Your GenAI Studio key couldn't be used. Save it again on your account page, then try again." };
    } else {
      try {
        result = await this.runGenerator(job, { onStep, browserSlot: this.browserSlot, ...(apiKey && { apiKey }) });
      } catch (err) {
        result = { ok: false, error: err.message };
      }
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
      // A code review that changed nothing comes back without a report: the code's own still holds.
      const base = findVersion(game, version.basedOn);
      const report = result.report ?? (result.source === base?.source ? base.report : null);
      const { name, description } = report?.game ?? {};
      const codeReview = result.review ?? null;
      saveVersionSource(this.db, id, version.version, { source: result.source, report, name, description, changelog, codeReview });
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
    const job = { step: designing ? 'design' : version.kind === 'recheck' ? 'recheck' : 'build', idea: game.prompt, model: version.model };
    // Every build is reviewed, and its crashes and dead ends fixed (plan §47).
    if (job.step === 'build') job.review = true;
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
    if (this.running.has(id)) return { queuePosition: 0, steps: this.steps.get(id) ?? [] };
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
    // A request to publish was for the version being playtested then: a different one needs asking again.
    if (game.submittedVersion !== null && game.submittedVersion !== version.version) setSubmission(this.db, id, { submittedVersion: null, submittedAt: null });
    this.log(`[generate] ${id}: playtesting v${version.version}`);
    return this.get(id);
  }

  /**
   * Its creator asks for the version they're playtesting to be published (plan §44): it shows
   * in the admins' "To approve" list, and admins may host it too, to try it.
   */
  submit(id, { now = Date.now() } = {}) {
    const game = this.get(id);
    if (game.playtestVersion === null) throw new GenerationError(409, 'WRONG_STATUS', 'Playtest a version first: that is the one you ask to publish.');
    setSubmission(this.db, id, { submittedVersion: game.playtestVersion, submittedAt: now, reviewNote: null, reviewedAt: null, now });
    this.log(`[generate] ${id}: v${game.playtestVersion} submitted for publishing`);
    return this.get(id);
  }

  /** Its creator takes the request back. */
  withdraw(id) {
    this.get(id);
    setSubmission(this.db, id, { submittedVersion: null, submittedAt: null });
    return this.get(id);
  }

  /** An admin doesn't publish it (yet): the request ends, with a note for its creator. */
  sendBack(id, note, { now = Date.now() } = {}) {
    this.get(id);
    if (!isSubmitted(this.db, id)) throw new GenerationError(409, 'WRONG_STATUS', "This game isn't waiting for approval.");
    const text = typeof note === 'string' ? note.trim() : '';
    if (text.length < MIN_NOTE_LENGTH || text.length > MAX_NOTE_LENGTH) {
      throw new GenerationError(400, 'INVALID_NOTE', `Say why in ${MIN_NOTE_LENGTH}–${MAX_NOTE_LENGTH} characters.`);
    }
    setSubmission(this.db, id, { submittedVersion: null, submittedAt: null, reviewNote: text, reviewedAt: now, now });
    this.log(`[generate] ${id}: sent back`);
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
    setSubmission(this.db, id, { submittedVersion: null, submittedAt: null, reviewNote: null, reviewedAt: Date.now() }); // answered
    this.log(`[generate] ${id}: published v${version.version}`);
    return this.get(id);
  }

  /** Takes a live version down: 'playtest' ends the playtest, 'published' unpublishes the game. */
  takeDown(id, as) {
    const game = this.get(id);
    this.unload(game, as);
    setLiveVersions(this.db, id, as === 'published' ? { publishedVersion: null } : { playtestVersion: null });
    if (as === 'playtest') setSubmission(this.db, id, { submittedVersion: null, submittedAt: null }); // nothing left to publish
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
    if (this.running.has(id)) throw new GenerationError(409, 'WRONG_STATUS', "A game can't be deleted while its job is running.");
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
function checkText(text, code, what, max = MAX_IDEA_LENGTH) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed.length < MIN_IDEA_LENGTH || trimmed.length > max) {
    throw new GenerationError(400, code, `${what} in ${MIN_IDEA_LENGTH}–${max} characters.`);
  }
  return trimmed;
}

function checkModel(model) {
  if (typeof model !== 'string' || !isAllowedModel(model)) {
    throw new GenerationError(400, 'INVALID_MODEL', `The model must be one of: ${MODELS.map((m) => m.id).join(', ')}.`);
  }
}
