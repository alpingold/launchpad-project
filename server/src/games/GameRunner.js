import { config } from '../config.js';
import { validateView } from './views.js';
import { isPlainObject } from '../protocol/validate.js';
import { seededRandom, newSeed } from './random.js';

/** Thrown into a game's own code when it breaks the contract (bad view, bad timer, ...). */
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
 *  - check everything the game sends (views, timers, results)
 *  - catch every exception the game throws, so a broken game ends cleanly
 *    instead of crashing the server or leaving the room stuck
 *  - own the game's timers, so ending the game always cleans them up
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
   * @param {(target: Target, view: object) => void} opts.deliver   sends a checked view
   * @param {(results: {rankings: string[]} | {error: true}) => void} opts.onEnd  called exactly once
   * @param {number} [opts.seed]                          fixed seed for repeatable tests
   */
  constructor({ game, players, options = {}, deliver, onEnd, seed = newSeed() }) {
    this.game = game;
    this.players = Object.freeze(players.map((p) => Object.freeze({ id: p.id, name: p.name })));
    this.playerIds = new Set(this.players.map((p) => p.id));
    this.options = options;
    this.deliver = deliver;
    this.onEnd = onEnd;
    this.random = seededRandom(seed);

    this.instance = null; // what createGame returned
    this.ended = false;
    /** @type {Map<number, NodeJS.Timeout>} the game's timers, by the id we gave the game */
    this.timers = new Map();
    this.nextTimerId = 1;
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

  handleAction(playerId, action) {
    if (!this.instance || !this.playerIds.has(playerId)) return;
    this.safely('onAction', () => this.instance.onAction(playerId, action));
  }

  playerDisconnected(playerId) {
    this.callOptionalHook('onPlayerDisconnect', playerId);
  }

  playerReconnected(playerId) {
    this.callOptionalHook('onPlayerReconnect', playerId);
  }

  hostReconnected() {
    this.callOptionalHook('onHostReconnect');
  }

  /**
   * Stops the game without reporting results (the room closed). Safe to call more than once.
   * Clears every timer, so nothing from this game can run afterwards.
   */
  dispose() {
    if (this.ended) return;
    this.ended = true;
    for (const handle of this.timers.values()) clearTimeout(handle);
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
      console.error(`[game ${this.game.id}] ${label} threw, ending the game:`, err);
      this.finish({ error: true });
    }
  }

  callOptionalHook(name, ...args) {
    if (!this.instance || typeof this.instance[name] !== 'function') return;
    this.safely(name, () => this.instance[name](...args));
  }

  /** Checks a view the game wants to send; throws GameContractError into the game if it's bad. */
  checkView(view) {
    const problem = validateView(view);
    if (problem) throw new GameContractError(`invalid view: ${problem}`);
    const size = Buffer.byteLength(JSON.stringify(view));
    if (size > config.GAME_MAX_PAYLOAD_BYTES) {
      throw new GameContractError(`view is ${size} bytes; the limit is ${config.GAME_MAX_PAYLOAD_BYTES}`);
    }
    // Send a copy, so the game changing its object later can't change what was sent.
    return structuredClone(view);
  }

  checkResults(results) {
    const rankings = results?.rankings;
    if (!isPlainObject(results) || !Array.isArray(rankings) || Object.keys(results).length !== 1) {
      throw new GameContractError('endGame needs exactly { rankings: [playerId, ...] }');
    }
    for (const id of rankings) {
      if (!this.playerIds.has(id)) throw new GameContractError(`rankings contains unknown player id ${JSON.stringify(id)}`);
    }
    if (new Set(rankings).size !== rankings.length) {
      throw new GameContractError('rankings lists a player more than once');
    }
    return { rankings: [...rankings] };
  }

  /** The ctx object: the game's whole world. Every function is a no-op once the game has ended. */
  buildContext() {
    const ctx = {
      players: this.players,

      broadcast: (view) => {
        if (this.ended) return;
        this.deliver({ to: 'all' }, this.checkView(view));
      },

      sendToPlayer: (playerId, view) => {
        if (this.ended) return;
        if (!this.playerIds.has(playerId)) throw new GameContractError(`sendToPlayer: unknown player id ${JSON.stringify(playerId)}`);
        this.deliver({ to: 'player', playerId }, this.checkView(view));
      },

      sendToHost: (view) => {
        if (this.ended) return;
        this.deliver({ to: 'host' }, this.checkView(view));
      },

      setTimeout: (fn, ms) => {
        if (typeof fn !== 'function') throw new GameContractError('setTimeout needs a function');
        if (typeof ms !== 'number' || !(ms >= 0 && ms <= config.GAME_MAX_TIMER_MS)) {
          throw new GameContractError(`setTimeout delay must be 0–${config.GAME_MAX_TIMER_MS} ms`);
        }
        if (this.ended) return 0;
        const id = this.nextTimerId++;
        const handle = setTimeout(() => {
          this.timers.delete(id);
          this.safely('timer', fn);
        }, ms);
        this.timers.set(id, handle);
        return id; // a plain number, not Node's Timeout object (JSON-only contract)
      },

      clearTimeout: (id) => {
        const handle = this.timers.get(id);
        if (handle) {
          clearTimeout(handle);
          this.timers.delete(id);
        }
      },

      random: () => this.random(),

      endGame: (results) => {
        if (this.ended) return;
        this.finish(this.checkResults(results));
      },

      log: (message) => console.log(`[game ${this.game.id}]`, String(message).slice(0, 500)),
    };
    return Object.freeze(ctx);
  }
}
