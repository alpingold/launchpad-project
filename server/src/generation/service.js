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
// - Going live: its creator playtests a ready version (only they can start it), then
//   publishes it (everyone can), with no admin in between (plan §49): only the name and
//   description are checked for blocked words. The published version keeps running for
//   everyone while a newer one is playtested. Changes apply to the running server's game list
//   immediately. Code runs on this server only once its creator has chosen to playtest it.
// - Uploads (plan §57): a game file its owner wrote (or made with an AI of their own) is a
//   version too, checked in a sandbox the same way, with no AI and so no key needed.
// - Restarts: versions that were generating when the server stopped are marked failed.

import {
  createGeneratedGame,
  addVersion,
  saveVersionSource,
  markVersionFailed,
  setLiveVersions,
  getGeneratedGame,
  listGeneratedGames,
  countGamesOwnedBy,
  listBusyVersions,
  deleteGeneratedGame,
  startRedraft,
  saveDraft,
  designFailed,
  startBuild,
  deleteVersion,
  saveBuildAttempts,
  addUpload,
  BUSY_STATUSES,
} from '../db/generatedGames.js';
import { readFrameGame } from '../games/frameGame.js';
import { versionKind } from './versionKind.js';
import { config } from '../config.js';
import { liveGameId, registerVersion } from '../games/generated.js';
import { runGeneratorInSandbox } from './sandbox.js';
import { BrowserSlot } from './browserSlot.js';
import { isAdminUser } from '../db/users.js';
import { getGamePage } from '../db/gamePages.js';
import { blockedFields, blockedMessage } from '../games/wordFilter.js';
import { MODELS, DEFAULT_MODEL, isAllowedModel } from '../../../generator/src/models.js';
import { MAX_DESIGN_LENGTH } from '../../../generator/src/extract.js';
import { makeJob } from '../../../generator/src/job.js';
// What people may type: the same numbers the generator checks (generator/src/prompt.js says why).
import { MIN_IDEA_LENGTH, MIN_FEEDBACK_LENGTH, MAX_IDEA_LENGTH, MAX_REQUEST_LENGTH } from '../../../generator/src/prompt.js';

/** @typedef {import('../db/generatedGames.js').GeneratedGame} GeneratedGame */
/** @typedef {import('../db/generatedGames.js').GameVersion} GameVersion */

export { MIN_IDEA_LENGTH, MIN_FEEDBACK_LENGTH, MAX_IDEA_LENGTH, MAX_REQUEST_LENGTH };
/** A design the admin edits by hand. */
export const MIN_DESIGN_LENGTH = 20;
export { MAX_DESIGN_LENGTH };
/** A "Review again" version's request (plan §47): it has none of its own. */
export const RECHECK_REQUEST = 'Review the code again, and fix any crashes or dead ends it finds.';
/** At most this many jobs waiting in line (besides those running), so nobody can queue up hours of work. */
export const MAX_WAITING = 4;
/** Uploads per person per hour (plan §57): each one is a playtest in a sandbox. */
export const MAX_UPLOADS_PER_HOUR = 6;
/** The biggest file the AI may change (plan §57): bigger uploads can only be replaced by hand. */
export const MAX_AI_SOURCE_BYTES = 100 * 1024;
/** Progress lines kept per job (the admin page shows them while it runs). */
const MAX_STEPS = 50;

/** A refusal with an HTTP status and a code the admin page can show. */

export class GenerationError extends Error {
  /** @param {Record<string, unknown>} [details]  more for the page, sent with the error (e.g. { blocked }) */
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
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
    /** @type {Map<string, string>} where each queued or running job was asked for (an IP address), by game id */
    this.jobIps = new Map();
    /** @type {Map<number, number[]>} when each person uploaded in the last hour */
    this.uploads = new Map();
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
      maxUploadBytes: config.FRAME_GAME_MAX_BYTES,
      maxAiSourceBytes: MAX_AI_SOURCE_BYTES,
    };
  }

  /**
   * The one guard every action that starts work asks: a new game, a new draft, a build, a
   * change, "Review again", "Make it your own", an upload or a new upload version. Refuses,
   * in this order:
   * 1. this game is busy (a version being made, or a design waiting for its maker);
   * 2. the maker or the site can't take another job (checkCanQueue);
   * 3. a new game the account has no room for;
   * 4. nothing to build from, or too much for the AI.
   * @param {Object} work
   * @param {number} work.ownerUserId  whose job it would be
   * @param {GeneratedGame | null} [work.game]  the game it's on; null: a new game
   * @param {GameVersion | null} [work.on]  the version it's on (a new draft or a build); null: a new version
   * @param {string | null} [work.kind]  the new version's kind: 'upload', 'remix', 'recheck' or null (a change)
   * @param {unknown} [work.basedOn]  untrusted input: the version a change is made from; undefined: the default
   * @returns {GameVersion | null} the version the new one is made from (null if the AI makes none)
   */
  mayStart({ ownerUserId, game = null, on = null, kind = null, basedOn, ip = null }) {
    if (game && on) this.checkNoJob(game.id);
    else if (game) checkNoOpenVersion(game);
    this.checkCanQueue(ownerUserId, { needsKey: kind !== 'upload', ip });
    if (!game) this.checkRoomForGame(ownerUserId);
    if (!game || on || kind === 'upload') return null;
    return baseFor(game, kind, basedOn);
  }

  /** Refuses while this game has a job waiting or running. */
  checkNoJob(id) {
    if (this.running.has(id) || this.queue.includes(id)) throw new GenerationError(409, 'BUSY', 'This game has a job running. Wait for it to finish.');
  }

  /**
   * Refuses new work if generating is off, the queue is full, this person has no key to
   * use, or they already have a job waiting or running (one each, plan §15).
   * @param {number} ownerUserId  whose job it would be
   * @param {{ needsKey?: boolean }} [opts]  false: a job with no AI in it (an upload's check)
   */
  checkCanQueue(ownerUserId, { needsKey = true, ip = null } = {}) {
    if (!this.enabled) {
      throw new GenerationError(503, 'GENERATION_DISABLED', this.disabledReason);
    }
    if (needsKey && !this.hasKey(ownerUserId)) {
      throw new GenerationError(403, 'NO_KEY', 'Save your GenAI Studio API key on your account page first.');
    }
    const busy = [...this.running.keys(), ...this.queue].some((id) => getGeneratedGame(this.db, id)?.ownerUserId === ownerUserId);
    if (busy) {
      throw new GenerationError(409, 'ALREADY_RUNNING', 'You already have a game being made. Wait for it to finish, then start the next one.');
    }
    // One job per account isn't enough on its own: accounts are cheap to make (plan §59).
    const fromHere = ip === null ? 0 : [...this.running.keys(), ...this.queue].filter((id) => this.jobIps.get(id) === ip).length;
    if (fromHere >= config.GENERATION_JOBS_PER_IP && !isAdminUser(this.db, ownerUserId)) {
      throw new GenerationError(429, 'TOO_MANY_FROM_HERE', `${fromHere} games are already being made from your network. Wait for one to finish.`);
    }
    if (this.running.size >= this.maxRunning && this.queue.length >= MAX_WAITING) {
      throw new GenerationError(429, 'QUEUE_FULL', `${this.running.size + this.queue.length} games are already being made. Wait for one to finish.`);
    }
  }

  /** Refuses a new game for an account that has as many as it may (plan §59; admins have no limit). */
  checkRoomForGame(ownerUserId) {
    if (isAdminUser(this.db, ownerUserId) || countGamesOwnedBy(this.db, ownerUserId) < config.MAX_GAMES_PER_ACCOUNT) return;
    throw new GenerationError(409, 'TOO_MANY_GAMES', `You have ${config.MAX_GAMES_PER_ACCOUNT} games, the most an account can have. Delete one to make another.`);
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
  start({ ownerUserId, idea, model = DEFAULT_MODEL, ip = null }) {
    this.mayStart({ ownerUserId, ip });
    const trimmed = checkText(idea, 'INVALID_IDEA', 'Describe the game');
    checkModel(model);
    const game = createGeneratedGame(this.db, { ownerUserId, prompt: trimmed, model });
    this.enqueue(game.id, ip);
    return this.get(game.id);
  }

  /**
   * Uploads a game file (plan §57): a new game (no id), or the next version of one of yours.
   * Its game info is read here; the static check and the playtest run in a sandbox, like a
   * build's, with no AI. Returns right away.
   * @param {{ ownerUserId: number, id?: string, source: unknown }} upload  source is untrusted input
   */
  upload({ ownerUserId, id, source, ip = null }) {
    if (typeof source !== 'string' || source.trim() === '') throw new GenerationError(400, 'INVALID_FILE', 'Choose a game file (one .html file).');
    const info = readFrameGame(source, 'game');
    if (!info.ok) {
      throw new GenerationError(422, 'INVALID_FILE', "This file isn't a game the site can load: fix these first.", { problems: info.problems });
    }
    let game = null;
    if (id !== undefined) {
      game = this.get(id);
      if (game.ownerUserId !== ownerUserId) throw new GenerationError(404, 'NOT_FOUND', 'There is no such game.');
    }
    this.mayStart({ ownerUserId, game, kind: 'upload', ip });
    const now = Date.now();
    const recent = (this.uploads.get(ownerUserId) ?? []).filter((t) => now - t < 60 * 60 * 1000);
    if (recent.length >= MAX_UPLOADS_PER_HOUR) {
      throw new GenerationError(429, 'TOO_MANY_UPLOADS', `That's ${MAX_UPLOADS_PER_HOUR} uploads this hour. Try again later.`);
    }
    this.uploads.set(ownerUserId, [...recent, now]);
    // Its idea, for the code review if one is asked for (there's no design): what the game says it is.
    const said = `${info.game.name}: ${info.game.description}`;
    const prompt = (said.length >= MIN_IDEA_LENGTH ? said : `${info.game.name}: a party game, uploaded as a file`).slice(0, MAX_IDEA_LENGTH);
    const uploaded = addUpload(this.db, { ownerUserId, gameId: game?.id ?? null, prompt, source, now });
    this.enqueue(uploaded.id, ip);
    return this.get(uploaded.id);
  }

  /**
   * Asks for changes to a game: makes its next version from version `basedOn` (by default
   * the one being playtested, else the published one, else the newest ready one). It starts
   * with a plan of the change, unless `skipDesign` (a small fix: straight to the code).
   * @param {{ id: string, request: unknown, basedOn?: unknown, model?: unknown, skipDesign?: unknown }} change  untrusted input
   */
  requestChanges({ id, request, basedOn, model = DEFAULT_MODEL, skipDesign = false, kind = null, ip = null }) {
    const game = this.get(id);
    const trimmed = checkText(request, 'INVALID_REQUEST', 'Describe the change', MAX_REQUEST_LENGTH);
    checkModel(model);
    const base = this.mayStart({ ownerUserId: game.ownerUserId, game, kind, basedOn, ip });
    addVersion(this.db, id, { request: trimmed, basedOn: base.version, model, kind, status: skipDesign === true ? 'generating' : 'designing' });
    this.enqueue(id, ip);
    return this.get(id);
  }

  /**
   * "Make it your own" (plan §45b): a remix's first change is its own whole design (written from
   * the copy's design and what should be different), which the creator approves like a new
   * game's, then the copy's code is rewritten for it. Only on a remix, before any other change.
   * @param {{ id: string, request: unknown, model?: unknown }} remix  untrusted input
   */
  requestRemixDesign({ id, request, model = DEFAULT_MODEL, ip = null }) {
    const game = this.get(id);
    if (!game.remixOf) throw new GenerationError(409, 'NOT_A_REMIX', 'Only a remix can be made your own this way: ask for a change instead.');
    if (game.versions.length > 1) throw new GenerationError(409, 'ALREADY_CHANGED', 'This remix already has changes: ask for another change instead.');
    const trimmed = checkText(request, 'INVALID_REQUEST', 'Say what should be different', MAX_REQUEST_LENGTH);
    checkModel(model);
    const base = this.mayStart({ ownerUserId: game.ownerUserId, game, kind: 'remix', ip });
    addVersion(this.db, id, { request: trimmed, basedOn: base.version, model, kind: 'remix', status: 'designing' });
    this.enqueue(id, ip);
    return this.get(id);
  }

  /**
   * "Review again" (plan §47): the next version is another code review round on version
   * `basedOn` (by default the same as for changes). Crashes and dead ends it finds are fixed;
   * if there are none, the new version has the same code, with the new review.
   * @param {{ id: string, basedOn?: unknown, model?: unknown }} recheck  untrusted input
   */
  reviewAgain({ id, basedOn, model = DEFAULT_MODEL, ip = null }) {
    return this.requestChanges({ id, request: RECHECK_REQUEST, basedOn, model, skipDesign: true, kind: 'recheck', ip });
  }

  /**
   * A version whose design (or plan) the admin may work on: waiting for them, or failed with
   * a design (to change it or build it again).
   */
  designedVersion(id, versionNumber) {
    const game = this.get(id);
    const version = findVersion(game, versionNumber);
    if (!version) throw new GenerationError(404, 'NOT_FOUND', 'There is no such version.');
    this.checkNoJob(id);
    const open = version.status === 'design_ready' || (version.status === 'failed' && version.design !== null);
    if (!open) throw new GenerationError(409, 'WRONG_STATUS', 'This version has no design waiting for you.');
    return { game, version };
  }

  /** "Change the design": the model writes a new draft with the admin's feedback. */
  redesign({ id, version: versionNumber, feedback, ip = null }) {
    const { game, version } = this.designedVersion(id, versionNumber);
    this.mayStart({ ownerUserId: game.ownerUserId, game, on: version, ip });
    const trimmed = typeof feedback === 'string' ? feedback.trim() : '';
    if (trimmed.length < MIN_FEEDBACK_LENGTH || trimmed.length > MAX_IDEA_LENGTH) {
      throw new GenerationError(400, 'INVALID_FEEDBACK', `Say what to change in ${MIN_FEEDBACK_LENGTH}–${MAX_IDEA_LENGTH} characters.`);
    }
    startRedraft(this.db, id, version.version, trimmed);
    this.enqueue(id, ip);
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
  build({ id, version: versionNumber, ip = null }) {
    const { game, version } = this.designedVersion(id, versionNumber);
    this.mayStart({ ownerUserId: game.ownerUserId, game, on: version, ip });
    startBuild(this.db, id, version.version);
    this.enqueue(id, ip);
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
    this.checkNoJob(id);
    deleteVersion(this.db, id, version.version);
    return this.get(id);
  }

  /** @param {string | null} [ip]  where the request came from (for config.GENERATION_JOBS_PER_IP) */
  enqueue(id, ip = null) {
    this.steps.set(id, []);
    if (ip !== null) this.jobIps.set(id, ip);
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
        this.jobIps.delete(id);
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
    const { needsAi } = versionKind(version);
    const { job, label } = this.jobFor(game, version);

    // The owner's own key (plan §15); none: an admin's job uses the server's key. Never logged.
    // A job without the AI (an upload's check) gets no key at all.
    const apiKey = needsAi ? (this.userKeys?.keyFor(game.ownerUserId) ?? null) : null;

    const model = needsAi ? version.model : null;
    this.log(`[generate] ${id} v${version.version}: ${label} started${model ? ` with ${model}` : ''}${apiKey ? " (the owner's key)" : ''}`);
    let result;
    if (needsAi && !apiKey && !isAdminUser(this.db, game.ownerUserId)) {
      result = { ok: false, error: "Your GenAI Studio key couldn't be used. Save it again on your account page, then try again." };
    } else {
      try {
        result = await this.runGenerator(job, { onStep, browserSlot: this.browserSlot, ai: needsAi, ...(apiKey && { apiKey }) });
      } catch (err) {
        result = { ok: false, error: err.message };
      }
    }
    if (!getGeneratedGame(this.db, id)) return; // deleted while it was running
    // An upload keeps exactly the file uploaded, whatever the sandbox sends back.
    if (versionKind(version).track.kind === 'upload') result = { ...result, source: version.source };

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

  /**
   * The sandbox job for a version's next step, and its log label: the job module (generator/src/job.js)
   * makes both from what this module knows about the version.
   * @returns {{ job: import('../../../generator/src/job.js').GeneratorJob, label: import('../../../generator/src/job.js').JobLabel }}
   */
  jobFor(game, version) {
    const { step } = versionKind(version);
    const facts = { step, idea: game.prompt, model: version.model };
    if (version.kind === 'upload') return makeJob({ ...facts, upload: { source: version.source } });
    // The version's own text: its last draft while designing (with the maker's feedback on it),
    // then the approved design it's built from; a change's is its plan (null: a small fix).
    const draft = step === 'design' ? { draft: version.design, feedback: version.designFeedback } : null;
    if (version.kind === 'remix') return makeJob({ ...facts, ...(draft ?? { design: version.design }), remix: this.remixFacts(game, version) });
    if (version.basedOn !== null) return makeJob({ ...facts, ...(draft ?? { plan: version.design }), change: this.changeFacts(game, version) });
    return makeJob({ ...facts, ...(draft ?? { design: version.design }) }); // a new game
  }

  /**
   * What a change knows, from the game's versions: its request, the file it starts from, the
   * game's design and the requests since that design.
   * @returns {import('../../../generator/src/job.js').ChangeFacts}
   */
  changeFacts(game, version) {
    const base = findVersion(game, version.basedOn);
    // The requests since the game's design, oldest first, so the model knows the history.
    const requestsSince = [];
    for (let v = base; v && !versionKind(v).startsOver; v = findVersion(game, v.basedOn)) requestsSince.unshift(v.request);
    return { request: version.request, gameFile: base.source, gameDesign: designOf(game, base), requestsSince };
  }

  /**
   * What a remix knows (plan §45b): the copy's file, the design that file was built from (plan
   * §60), and what should be different (for "Make it your own"; its build rewrites the copy's
   * code for the approved design).
   * @returns {NonNullable<import('../../../generator/src/job.js').JobFacts['remix']>}
   */
  remixFacts(game, version) {
    const copy = findVersion(game, version.basedOn);
    return { copy: copy.source, copyDesign: designOf(game, copy), request: version.request };
  }

  /** Where a game's job is: its place in line (0 = running now) and its progress so far. */
  progress(id) {
    if (this.running.has(id)) return { queuePosition: 0, steps: this.steps.get(id) ?? [] };
    const at = this.queue.indexOf(id);
    return at === -1 ? null : { queuePosition: at + 1, steps: [] };
  }

  /** @param {{ ownerUserId?: number }} [opts]  only this account's games */
  list(opts) {
    return listGeneratedGames(this.db, opts);
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

  /**
   * Publishes the version being playtested: every host gets it, replacing the published one.
   * Its creator decides (plan §49): no admin looks first, so the name and description that
   * everyone will see (the game page's, else the game file's) and its "About" text mustn't
   * have blocked words.
   */
  async publish(id) {
    const game = this.get(id);
    const version = findVersion(game, game.playtestVersion);
    if (!version) throw new GenerationError(409, 'WRONG_STATUS', 'Playtest a version before publishing it.');
    const page = getGamePage(this.db, id);
    const blocked = blockedFields({ name: page?.name ?? version.name, description: page?.description ?? version.description, about: page?.about });
    if (blocked.length > 0) throw new GenerationError(422, 'BLOCKED_WORDS', blockedMessage(blocked), { blocked });

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
    if (this.running.has(id)) throw new GenerationError(409, 'WRONG_STATUS', "A game can't be deleted while its job is running.");
    if (this.queue.includes(id)) {
      this.queue.splice(this.queue.indexOf(id), 1); // still waiting: just drop it
      this.steps.delete(id);
      this.jobIps.delete(id);
    }
    this.unload(game, 'published');
    this.unload(game, 'playtest');
    deleteGeneratedGame(this.db, id);
  }
}


/** The game's design as of this version: the whole design it, or the version it's based on, came from. */
export function designOf(game, version) {
  for (let v = version; v; v = findVersion(game, v.basedOn)) if (versionKind(v).startsOver) return v.design ?? null;
  return null;
}


/** @returns {import('../db/generatedGames.js').GameVersion | undefined} */
function findVersion(game, number) {
  return number === null ? undefined : game.versions.find((v) => v.version === number);
}

/** Refuses a new version while another is being made, or its design or plan waits for the maker. */
function checkNoOpenVersion(game) {
  const open = game.versions.find((v) => BUSY_STATUSES.includes(v.status) || v.status === 'design_ready');
  if (!open) return;
  const why = open.status === 'design_ready' ? `v${open.version}'s ${versionKind(open).designKind === 'plan' ? 'plan' : 'design'} is waiting for you: build it or discard it first.` : 'A version of this game is already being made. Wait for it to finish.';
  throw new GenerationError(409, 'BUSY', why);
}

/**
 * The version the AI makes a new one from: the one asked for, or by default the one being
 * playtested, else the published one, else the newest ready one. A remix's own design starts
 * from the copy. Refused if it has no code that passed, or is too big for the AI.
 * @returns {GameVersion}
 */
function baseFor(game, kind, basedOn) {
  let base;
  if (kind === 'remix') base = findVersion(game, 1);
  else if (basedOn === undefined) base = findVersion(game, game.playtestVersion) ?? findVersion(game, game.publishedVersion) ?? game.versions.findLast((v) => v.status === 'ready');
  else base = findVersion(game, basedOn);
  // An uploaded file that failed the checks can be fixed by the AI too (plan §57).
  const fixable = base?.status === 'ready' || (base && versionKind(base).track.kind === 'upload' && base.status === 'failed' && base.source !== null);
  if (!fixable) {
    const why = kind === 'remix' ? 'The copy has no code to start from.' : 'Changes can only be made to a version that passed the tests.';
    throw new GenerationError(409, 'NO_BASE_VERSION', why);
  }
  if (Buffer.byteLength(base.source, 'utf8') > MAX_AI_SOURCE_BYTES) {
    throw new GenerationError(413, 'TOO_BIG_FOR_AI', `The AI can only change game files up to ${MAX_AI_SOURCE_BYTES / 1024} KB. Upload a changed file instead.`);
  }
  return base;
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
