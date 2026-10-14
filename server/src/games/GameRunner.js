import { config } from '../config.js';
import { validateScreen, readAction } from './kit/screen.js';
import { isPlainObject } from '../protocol/validate.js';
import { seededRandom, newSeed } from './random.js';

/** Thrown into a game's own code when it breaks the contract (bad screen, bad timer, ...). */
export class GameContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameContractError';
  }
}

/**
 * Where a game message goes.
 * @typedef {{ to: 'all' } | { to: 'host' } | { to: 'player', playerId: string }} Target
 */

/**
 * Runs one game for one room. This is the ONLY code that calls into a game.
 *
 * Its jobs:
 *  - build the `ctx` object the game talks through
 *  - check everything the game sends (screens, timers, results)
 *  - catch every exception the game throws, so a broken game ends cleanly
 *    instead of crashing the server or leaving the room stuck
 *  - own the game's timers, so ending the game always cleans them up
 *  - remember the latest screen sent to each phone and the big screen, to resend it after a reconnect and to
 *    drop actions that aren't on that player's screen (plan §11b)
 *
 * Extension point (§5, E2): a SandboxedGameRunner with the same public methods
 * (start, handleAction, playerDisconnected, playerReconnected, hostReconnected, dispose)
 * could run an untrusted game in another process and pass the same JSON messages back
 * and forth. RoomManager wouldn't change, because it only ever calls these methods.
 */
export class GameRunner {
  /**
   * @param {Object} opts
   * @param {import('./contract.js').GameModule} opts.game
   * @param {{id: string, name: string}[]} opts.players   everyone in the game
   * @param {object} [opts.options]                       from host:start_game
   * @param {(target: Target, screen: object) => void} opts.deliver   sends a checked screen
   * @param {(results: {rankings: string[]} | {error: true}) => void} opts.onEnd  called exactly once
   * @param {number} [opts.seed]                          fixed seed for repeatable tests
   * @param {() => number} [opts.now]                     server clock (tests can pass a fake)
   * @param {{ setTimeout: Function, clearTimeout: Function }} [opts.timers]
   *   where the game's timers really run; the test harness passes a simulated clock
   * @param {(where: string, err: unknown) => void} [opts.onGameError]
   *   told about every error a game causes (default: log it); the harness collects them
   * @param {(message: string) => void} [opts.onLog]      where ctx.log goes (default: console)
   */
  constructor({
    game,
    players,
    options = {},
    deliver,
    onEnd,
    seed = newSeed(),
    now = Date.now,
    timers = { setTimeout, clearTimeout },
    onGameError = (where, err) => console.error(`[game ${game.id}] ${where} threw, ending the game:`, err),
    onLog = (message) => console.log(`[game ${game.id}]`, message),
  }) {
    this.game = game;
    this.players = Object.freeze(players.map((p) => Object.freeze({ id: p.id, name: p.name })));
    this.playerIds = new Set(this.players.map((p) => p.id));
    this.options = options;
    this.deliver = deliver;
    this.onEnd = onEnd;
    this.random = seededRandom(seed);
    this.now = now;
    this.timerApi = timers;
    this.onGameError = onGameError;
    this.onLog = onLog;

    this.instance = null; // what createGame returned
    this.ended = false;
    /** @type {Map<number, NodeJS.Timeout>} the game's timers, by the id we gave the game */
    this.timers = new Map();
    this.nextTimerId = 1;

    /** @type {Map<string, object>} the latest screen sent to each player, by player id */
    this.lastPlayerScreens = new Map();
    /** @type {object | null} the latest screen sent to the big screen */
    this.lastHostScreen = null;
  }

  // --- Called by RoomManager ------------------------------------------------------

  /** Creates the game. If createGame throws or returns something unusable, the game ends with an error. */
  start() {
    this.safely('createGame', () => {
      const instance = this.game.createGame(this.buildContext(), structuredClone(this.options));
      if (!instance || typeof instance.onAction !== 'function') {
        throw new GameContractError('createGame must return an object with an onAction function');
      }
      this.instance = instance;
    });
  }

  /**
   * A player used a control. Only actions that are on that player's screen right now reach
   * the game, and only with a valid input for that block (text of the right length, a
   * slider value in range…); anything else is a stale tap from an old screen or a made-up
   * message, and is dropped quietly (plan §11b, §12c).
   * @param {string} playerId
   * @param {object} action
   * @param {unknown} [input]  the value from an input block or widget (text, a slider value, a drawing…)
   */
  handleAction(playerId, action, input) {
    if (!this.instance || !this.playerIds.has(playerId)) return;
    const checked = readAction(this.lastPlayerScreens.get(playerId), action, input, { now: this.now() });
    if (!checked.ok) return;
    if (checked.input === undefined) this.safely('onAction', () => this.instance.onAction(playerId, action));
    else this.safely('onAction', () => this.instance.onAction(playerId, action, checked.input));
  }

  playerDisconnected(playerId) {
    this.callOptionalHook('onPlayerDisconnect', playerId);
  }

  /**
   * The player is back: let the game know, then put their latest screen back on their phone.
   * If the game's own hook already sent them a new screen, that one is current; no repeat.
   */
  playerReconnected(playerId) {
    const before = this.lastPlayerScreens.get(playerId);
    this.callOptionalHook('onPlayerReconnect', playerId);
    const latest = this.lastPlayerScreens.get(playerId);
    if (!this.ended && latest && latest === before) this.deliver({ to: 'player', playerId }, latest);
  }

  /** Same as playerReconnected, for the big screen. */
  hostReconnected() {
    const before = this.lastHostScreen;
    this.callOptionalHook('onHostReconnect');
    const latest = this.lastHostScreen;
    if (!this.ended && latest && latest === before) this.deliver({ to: 'host' }, latest);
  }

  /**
   * Stops the game without reporting results (the room closed). Safe to call more than once.
   * Clears every timer, so nothing from this game can run afterwards.
   */
  dispose() {
    if (this.ended) return;
    this.ended = true;
    for (const handle of this.timers.values()) this.timerApi.clearTimeout(handle);
    this.timers.clear();
    if (typeof this.instance?.dispose === 'function') {
      try {
        this.instance.dispose();
      } catch (err) {
        console.error(`[game ${this.game.id}] dispose threw:`, err);
      }
    }
  }

  // --- Internals ------------------------------------------------------------------

  /** Ends the game exactly once and reports the results. */
  finish(results) {
    if (this.ended) return;
    this.dispose();
    this.onEnd(results);
  }

  /**
   * Runs game code and catches anything it throws. A throw means the game is broken:
   * log it and end the game with an error, so the room goes back to the lobby.
   */
  safely(label, fn) {
    if (this.ended) return;
    try {
      fn();
    } catch (err) {
      this.onGameError(label, err);
      this.finish({ error: true });
    }
  }

  callOptionalHook(name, ...args) {
    if (!this.instance || typeof this.instance[name] !== 'function') return;
    this.safely(name, () => this.instance[name](...args));
  }

  /** Checks a screen the game wants to send; throws GameContractError into the game if it's bad. */
  checkScreen(screen) {
    const problem = validateScreen(screen, { playerIds: this.playerIds });
    if (problem) throw new GameContractError(`invalid screen: ${problem}`);
    const size = Buffer.byteLength(JSON.stringify(screen));
    if (size > config.GAME_MAX_PAYLOAD_BYTES) {
      throw new GameContractError(`screen is ${size} bytes; the limit is ${config.GAME_MAX_PAYLOAD_BYTES}`);
    }
    // Send a copy, so the game changing its object later can't change what was sent.
    return structuredClone(screen);
  }

  checkResults(results) {
    const shape = 'endGame needs { rankings: [playerId, ...], scores?: { playerId: number } }';
    if (!isPlainObject(results) || !Array.isArray(results.rankings)) throw new GameContractError(shape);
    for (const key of Object.keys(results)) {
      if (key !== 'rankings' && key !== 'scores') throw new GameContractError(`${shape}; unknown field "${key}"`);
    }

    const { rankings, scores } = results;
    for (const id of rankings) {
      if (!this.playerIds.has(id)) throw new GameContractError(`rankings contains unknown player id ${JSON.stringify(id)}`);
    }
    if (new Set(rankings).size !== rankings.length) {
      throw new GameContractError('rankings lists a player more than once');
    }
    if (scores === undefined) return { rankings: [...rankings] };

    if (!isPlainObject(scores)) throw new GameContractError(`${shape}; scores must be an object`);
    for (const [id, score] of Object.entries(scores)) {
      if (!this.playerIds.has(id)) throw new GameContractError(`scores contains unknown player id ${JSON.stringify(id)}`);
      if (typeof score !== 'number' || !Number.isFinite(score)) {
        throw new GameContractError(`scores[${JSON.stringify(id)}] must be a number`);
      }
    }
    return { rankings: [...rankings], scores: { ...scores } };
  }

  /** Sends a checked screen, remembering it as the latest screen for everyone it goes to. */
  send(target, screen) {
    if (target.to === 'all' || target.to === 'host') this.lastHostScreen = screen;
    if (target.to === 'all') for (const id of this.playerIds) this.lastPlayerScreens.set(id, screen);
    if (target.to === 'player') this.lastPlayerScreens.set(target.playerId, screen);
    this.deliver(target, screen);
  }

  /** The ctx object: the game's whole world. Every function is a no-op once the game has ended. */
  buildContext() {
    const ctx = {
      players: this.players,

      broadcast: (screen) => {
        if (this.ended) return;
        this.send({ to: 'all' }, this.checkScreen(screen));
      },

      sendToPlayer: (playerId, screen) => {
        if (this.ended) return;
        if (!this.playerIds.has(playerId)) throw new GameContractError(`sendToPlayer: unknown player id ${JSON.stringify(playerId)}`);
        this.send({ to: 'player', playerId }, this.checkScreen(screen));
      },

      sendToHost: (screen) => {
        if (this.ended) return;
        this.send({ to: 'host' }, this.checkScreen(screen));
      },

      setTimeout: (fn, ms) => {
        if (typeof fn !== 'function') throw new GameContractError('setTimeout needs a function');
        if (typeof ms !== 'number' || !(ms >= 0 && ms <= config.GAME_MAX_TIMER_MS)) {
          throw new GameContractError(`setTimeout delay must be 0–${config.GAME_MAX_TIMER_MS} ms`);
        }
        if (this.ended) return 0;
        const id = this.nextTimerId++;
        const handle = this.timerApi.setTimeout(() => {
          this.timers.delete(id);
          this.safely('timer', fn);
        }, ms);
        this.timers.set(id, handle);
        return id; // a plain number, not Node's Timeout object (JSON-only contract)
      },

      clearTimeout: (id) => {
        const handle = this.timers.get(id);
        if (handle) {
          this.timerApi.clearTimeout(handle);
          this.timers.delete(id);
        }
      },

      random: () => this.random(),

      now: () => this.now(),

      endGame: (results) => {
        if (this.ended) return;
        this.finish(this.checkResults(results));
      },

      log: (message) => this.onLog(String(message).slice(0, 500)),
    };
    return Object.freeze(ctx);
  }
}
