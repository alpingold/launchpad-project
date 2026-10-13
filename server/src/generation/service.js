// THE GENERATION SERVICE (plan §11, A5): the server's side of AI-generated games.
//
// - Starting: an admin's idea becomes a database row ("generating") and joins a queue.
//   Jobs run ONE AT A TIME, each in its own OpenShell sandbox (sandbox.js): GenAI Studio
//   allows only 20 requests a minute, and each sandbox needs memory.
// - Finishing: a passing game is saved for review ("review"). A failed one keeps its reason,
//   and its last attempt if there was one ("failed").
// - Approving: review → playtest → published (or rejected), applied to the running
//   server's game list immediately. Code runs on this server only from "playtest" on,
//   i.e. after the admin has read it.
// - Restarts: jobs that were running when the server stopped are marked failed on start.

import {
  createGeneratedGame,
  saveGeneratedSource,
  markGenerationFailed,
  setGeneratedGameStatus,
  getGeneratedGame,
  listGeneratedGames,
  listGeneratingGames,
  deleteGeneratedGame,
  sha256,
} from '../db/generatedGames.js';
import { loadGameSource } from '../games/loadSource.js';
import { runGeneratorInSandbox } from './sandbox.js';
import { MODELS, DEFAULT_MODEL, isAllowedModel } from '../../../generator/src/models.js';

export const MIN_IDEA_LENGTH = 10;
export const MAX_IDEA_LENGTH = 1000;
/** At most this many jobs waiting or running at once, so nobody can queue up hours of work. */
export const MAX_QUEUED = 5;
/** Progress lines kept per job (the admin page shows them while it runs). */
const MAX_STEPS = 50;

/**
 * What an admin may do to a game, and from which statuses. Anything else is refused.
 * (Generating and failed games can only be deleted.)
 */
const ACTIONS = {
  playtest: { from: ['review', 'published', 'rejected'], to: 'playtest' },
  publish: { from: ['playtest'], to: 'published' },
  reject: { from: ['review', 'playtest', 'published'], to: 'rejected' },
};
export const ACTION_NAMES = Object.freeze(Object.keys(ACTIONS));

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
    this.enabled = enabled;
    this.runGenerator = runGenerator;
    this.log = log;
    /** @type {string[]} ids waiting to run, oldest first */
    this.queue = [];
    /** @type {string | null} the id running right now */
    this.running = null;
    /** @type {Map<string, { seconds: number, text: string }[]>} progress of queued/running jobs */
    this.steps = new Map();
    /** @type {Promise<void>} settles when the current job finishes (tests wait on it) */
    this.current = Promise.resolve();
  }

  /** On startup: anything still "generating" was cut off by a restart. */
  recoverInterrupted() {
    for (const game of listGeneratingGames(this.db)) {
      markGenerationFailed(this.db, game.id, 'The server restarted while this game was being generated. Try again.');
    }
  }

  /** What the admin page needs to know before starting anything. */
  info() {
    return { enabled: this.enabled, models: MODELS, defaultModel: DEFAULT_MODEL, minIdeaLength: MIN_IDEA_LENGTH, maxIdeaLength: MAX_IDEA_LENGTH };
  }

  /**
   * Starts generating a game. Returns right away; the work happens in the background.
   * @param {{ ownerUserId: number, idea: unknown, model?: unknown }} request  idea/model are untrusted input
   */
  start({ ownerUserId, idea, model = DEFAULT_MODEL }) {
    if (!this.enabled) {
      throw new GenerationError(503, 'GENERATION_DISABLED', "Generating games isn't set up on this server (see generator/README.md).");
    }
    const trimmed = typeof idea === 'string' ? idea.trim() : '';
    if (trimmed.length < MIN_IDEA_LENGTH || trimmed.length > MAX_IDEA_LENGTH) {
      throw new GenerationError(400, 'INVALID_IDEA', `Describe the game in ${MIN_IDEA_LENGTH}–${MAX_IDEA_LENGTH} characters.`);
    }
    if (typeof model !== 'string' || !isAllowedModel(model)) {
      throw new GenerationError(400, 'INVALID_MODEL', `The model must be one of: ${MODELS.map((m) => m.id).join(', ')}.`);
    }
    if (this.queue.length + (this.running ? 1 : 0) >= MAX_QUEUED) {
      throw new GenerationError(429, 'QUEUE_FULL', `${MAX_QUEUED} games are already being made. Wait for one to finish.`);
    }

    const game = createGeneratedGame(this.db, { ownerUserId, prompt: trimmed, model });
    this.steps.set(game.id, []);
    this.queue.push(game.id);
    this.next();
    return game;
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

  async run(id) {
    const game = getGeneratedGame(this.db, id);
    const started = Date.now();
    const onStep = (text) => {
      const steps = this.steps.get(id);
      if (steps && steps.length < MAX_STEPS) steps.push({ seconds: Math.round((Date.now() - started) / 1000), text });
    };
    this.log(`[generate] ${id}: started with ${game.model}`);
    let result;
    try {
      result = await this.runGenerator({ idea: game.prompt, model: game.model }, { onStep });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (!getGeneratedGame(this.db, id)) return; // deleted while it was running

    if (result.ok && result.source) {
      const { name, description } = result.report?.game ?? {};
      saveGeneratedSource(this.db, id, { source: result.source, report: result.report, name, description, status: 'review' });
      this.log(`[generate] ${id}: ready for review (${name ?? 'unnamed'})`);
    } else {
      markGenerationFailed(this.db, id, result.error ?? 'unknown error', { source: result.source ?? null, report: result.report ?? null });
      this.log(`[generate] ${id}: failed: ${result.error}`);
    }
  }

  /** Where a job is: its place in line (0 = running now) and its progress so far. */
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
   * playtest / publish / reject a game, in the database AND in the running server's game
   * list. Playtesting loads the code for the first time, so it's checked first: the code
   * must be exactly what the tests passed (its fingerprint) and must load as a valid game.
   * @param {string} id
   * @param {keyof typeof ACTIONS} action
   */
  async act(id, action) {
    const rule = ACTIONS[action];
    if (!rule) throw new GenerationError(404, 'NOT_FOUND', 'Unknown action.');
    const game = this.get(id);
    if (!rule.from.includes(game.status)) {
      throw new GenerationError(409, 'WRONG_STATUS', `A game that is "${game.status}" can't be moved to "${rule.to}".`);
    }

    if (rule.to === 'rejected') {
      this.games.unregister(id);
    } else if (this.games.get(id, { userId: game.ownerUserId })) {
      this.games.setStatus(id, rule.to); // already loaded (published ↔ playtest)
    } else {
      await this.load(game, rule.to);
    }
    setGeneratedGameStatus(this.db, id, rule.to);
    this.log(`[generate] ${id}: ${game.status} → ${rule.to}`);
    return this.get(id);
  }

  /** Loads a reviewed game into the running server. */
  async load(game, status) {
    if (!game.source || sha256(game.source) !== game.sourceSha256) {
      throw new GenerationError(409, 'CODE_CHANGED', "This game's code doesn't match the code that was tested.");
    }
    try {
      const mod = await loadGameSource(game.source, `${game.id}.js`);
      this.games.register({ ...mod, id: game.id }, { source: 'generated', status, ownerUserId: game.ownerUserId });
    } catch (err) {
      throw new GenerationError(422, 'LOAD_FAILED', `The game couldn't be loaded: ${err.message.split('\n')[0]}`);
    }
  }

  /** Deletes a game for good (it disappears from the game picker right away). */
  remove(id) {
    const game = this.get(id);
    if (game.status === 'generating' && (this.running === id || this.queue.includes(id))) {
      if (this.running === id) throw new GenerationError(409, 'WRONG_STATUS', "A game can't be deleted while it's being made.");
      this.queue.splice(this.queue.indexOf(id), 1); // still waiting: just drop it
      this.steps.delete(id);
    }
    this.games.unregister(id);
    deleteGeneratedGame(this.db, id);
  }
}
