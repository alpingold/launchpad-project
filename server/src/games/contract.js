import { config } from '../config.js';

// ======================================================================================
//  THE GAME CONTRACT
//
//  Everything a game can do, and everything the platform promises it. A game is one
//  JavaScript object (a GameModule) with a createGame() function. It talks to the world
//  ONLY through the `ctx` object it receives.
//
//  Rules every game must follow:
//   1. Use only `ctx`. No imports of platform code, sockets, files, network, or database.
//   2. Everything sent or received is plain JSON: no functions, classes, or Dates.
//      (This is what lets the same game run later in a sandbox, in another process.)
//   3. Every message is a VIEW (see views.js): { view: 'message' | 'button' | ... }.
//      Each view REPLACES what that screen showed, so always send a screen its whole
//      current view. The platform remembers the latest view for every screen and sends
//      it again by itself when a phone or the host screen reconnects.
//   4. Randomness only from ctx.random(); time only from ctx.now() and ctx.setTimeout().
//   5. Treat every action as untrusted: check it against the current game state
//      (right player? right moment? sensible values?) and ignore anything else.
//      The platform already drops any action that isn't a button or choice option on
//      that player's screen right now, but only the game knows if it makes sense.
//   6. Call ctx.endGame({ rankings, scores? }) exactly once when the game is over.
//   7. Synchronous code only: no async functions, Promises, or the global setTimeout.
//      The platform can only catch errors that happen while it is calling the game
//      (createGame, onAction, a ctx.setTimeout callback, ...). An error in a Promise
//      would escape it. ctx.setTimeout covers everything a game needs to wait for.
//
//  If a game throws, sends an invalid view, or ends with invalid results, the platform
//  stops it, tells everyone the game ended with an error, and returns the room to the
//  lobby. A broken game can never crash the server or the room.
// ======================================================================================

/**
 * What a game folder exports (as its default export).
 * @typedef {Object} GameModule
 * @property {2} contractVersion    which version of this contract the game follows (currently 2)
 * @property {string} id            matches /^[a-z0-9-]{1,40}$/, e.g. "reaction-race"
 * @property {string} name          display name, 1–40 characters
 * @property {string} description   one or two sentences, at most 200 characters
 * @property {number} minPlayers    integer >= 1
 * @property {number} maxPlayers    integer, minPlayers..12
 * @property {(ctx: GameContext, options: object) => GameInstance} createGame
 *   Called once when the host starts the game. Set up state, send the first views,
 *   and return the GameInstance. `options` is a plain object from the host (may be {}).
 */

/**
 * What the platform gives a game.
 * @typedef {Object} GameContext
 * @property {ReadonlyArray<{id: string, name: string}>} players
 *   Everyone in the game, fixed at start. Players who disconnect stay in this list.
 * @property {(view: object) => void} broadcast             to the host screen and every player
 * @property {(playerId: string, view: object) => void} sendToPlayer
 * @property {(view: object) => void} sendToHost            big-screen-only view
 * @property {(fn: () => void, ms: number) => number} setTimeout
 *   Runs fn after ms (0 to 10 minutes). Returns a timer id. All timers are cancelled
 *   automatically when the game ends.
 * @property {(timerId: number) => void} clearTimeout
 * @property {() => number} random                          a number in [0, 1); seeded, so tests are repeatable
 * @property {() => number} now
 *   Server time in ms (like Date.now()). Use it for countdown views: endsAt = ctx.now() + ms.
 * @property {(results: GameResults) => void} endGame
 *   Ends the game with its results.
 * @property {(message: string) => void} log               server-side debug log
 */

/**
 * How a game ended.
 * @typedef {Object} GameResults
 * @property {string[]} rankings  player ids, best first (each at most once; may leave some out)
 * @property {Record<string, number>} [scores]
 *   Optional points per player id. Players with the same score count as tied
 *   (e.g. the lobby shows "It's a tie!" when the top scores are equal).
 */

/**
 * What createGame() returns. Only onAction is required.
 * @typedef {Object} GameInstance
 * @property {(playerId: string, action: object) => void} onAction
 *   A player's phone sent { type: 'game:action', action }. `action` is whatever object
 *   the tapped button/option carried, or anything a misbehaving client made up: validate it.
 * @property {(playerId: string) => void} [onPlayerDisconnect]
 *   The player dropped, left, or was removed. They may or may not come back.
 * @property {(playerId: string) => void} [onPlayerReconnect]
 *   The player is back (e.g. refreshed). Afterwards the platform sends them their latest
 *   view again by itself, so this is only for updating game state (e.g. "not away anymore").
 * @property {() => void} [onHostReconnect]
 *   The host screen reconnected. The platform resends its latest view afterwards.
 * @property {() => void} [dispose]
 *   Called once when the game ends or the room closes. Rarely needed, since timers are cleaned up for you.
 */

/** The contract version this platform runs. Games declare it as `contractVersion`. */
export const CONTRACT_VERSION = 2;

const GAME_ID_RE = /^[a-z0-9-]{1,40}$/;

/**
 * Checks that an object is a valid GameModule.
 * This is the first automatic check for every game, including AI-generated ones later (§5, E1).
 * @param {unknown} mod
 * @returns {string[]} problems found (empty means valid)
 */
export function validateGameModule(mod) {
  if (mod === null || typeof mod !== 'object') return ['a game must be an object (the default export)'];
  const problems = [];

  if (mod.contractVersion !== CONTRACT_VERSION) {
    problems.push(`contractVersion must be ${CONTRACT_VERSION} (this platform's game contract version)`);
  }
  if (typeof mod.id !== 'string' || !GAME_ID_RE.test(mod.id)) {
    problems.push('id must be 1–40 lowercase letters, digits, or dashes');
  }
  if (typeof mod.name !== 'string' || mod.name.length < 1 || mod.name.length > 40) {
    problems.push('name must be a string of 1–40 characters');
  }
  if (typeof mod.description !== 'string' || mod.description.length > 200) {
    problems.push('description must be a string of at most 200 characters');
  }

  const { minPlayers, maxPlayers } = mod;
  if (!Number.isInteger(minPlayers) || minPlayers < 1) {
    problems.push('minPlayers must be an integer of at least 1');
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers > config.MAX_PLAYERS) {
    problems.push(`maxPlayers must be an integer of at most ${config.MAX_PLAYERS}`);
  } else if (Number.isInteger(minPlayers) && maxPlayers < minPlayers) {
    problems.push('maxPlayers must be at least minPlayers');
  }

  if (typeof mod.createGame !== 'function') problems.push('createGame must be a function');
  return problems;
}
