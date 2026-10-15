import { config } from '../config.js';
import { staticCheck } from './staticCheck.js';

// FRAME GAMES (plan §13c): a game is ONE HTML file. The same page runs on the big screen
// (the referee: rules, timers, scores, the big picture) and on every phone (the
// controller), each in a sandboxed iframe in the browser.
//
// The server never runs that file. All it reads is the small JSON block at the top,
// with JSON.parse:
//
//   <script type="application/json" id="game-info">
//     { "name": "Bumper Blobs", "description": "…", "minPlayers": 2, "maxPlayers": 12 }
//   </script>
//
// The id isn't in the file: an official game's id is its folder name, and a generated
// game's id is given by the database. A game can never pick its own id.

/**
 * A game the server can offer: its info plus its page, which is sent to the room's
 * browsers when it starts.
 * @typedef {Object} FrameGame
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} minPlayers
 * @property {number} maxPlayers
 * @property {string} source        the whole HTML file
 */

const GAME_ID_RE = /^[a-z0-9-]{1,40}$/;
// The game-info block: a <script> with id="game-info" and type="application/json", in either order.
const GAME_INFO_RE = /<script\b(?=[^>]*\bid=["']game-info["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i;
const INFO_FIELDS = ['name', 'description', 'minPlayers', 'maxPlayers'];

/**
 * Reads a game file's info and checks it.
 * @param {unknown} source  the HTML file
 * @param {string} id       the id it will run under
 * @returns {{ ok: true, game: FrameGame } | { ok: false, problems: string[] }}
 */
export function readFrameGame(source, id) {
  if (typeof source !== 'string') return { ok: false, problems: ['the game file must be text'] };
  const bytes = Buffer.byteLength(source);
  if (bytes > config.FRAME_GAME_MAX_BYTES) {
    return { ok: false, problems: [`the game file is ${bytes} bytes; the limit is ${config.FRAME_GAME_MAX_BYTES}`] };
  }

  const match = GAME_INFO_RE.exec(source);
  if (!match) {
    return { ok: false, problems: ['no game info: start the file with <script type="application/json" id="game-info">{ … }</script>'] };
  }
  let info;
  try {
    info = JSON.parse(match[1]);
  } catch (err) {
    return { ok: false, problems: [`the game info isn't valid JSON (${err.message})`] };
  }
  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    return { ok: false, problems: ['the game info must be a JSON object'] };
  }

  const game = { id, name: info.name, description: info.description, minPlayers: info.minPlayers, maxPlayers: info.maxPlayers, source };
  const problems = Object.keys(info)
    .filter((key) => !INFO_FIELDS.includes(key))
    .map((key) => `the game info has an unknown field "${key}" (allowed: ${INFO_FIELDS.join(', ')})`);
  problems.push(...validateFrameGame(game));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, game };
}

/**
 * Checks a game's fields (also used by the registry, which only takes valid games).
 * @param {unknown} game
 * @returns {string[]} problems found (empty means valid)
 */
export function validateFrameGame(game) {
  if (game === null || typeof game !== 'object') return ['a game must be an object'];
  const problems = [];
  if (typeof game.id !== 'string' || !GAME_ID_RE.test(game.id)) {
    problems.push('id must be 1–40 lowercase letters, digits, or dashes');
  }
  if (typeof game.name !== 'string' || game.name.trim().length < 1 || game.name.length > 40) {
    problems.push('name must be a string of 1–40 characters');
  }
  if (typeof game.description !== 'string' || game.description.length > 200) {
    problems.push('description must be a string of at most 200 characters');
  }

  const { minPlayers, maxPlayers } = game;
  if (!Number.isInteger(minPlayers) || minPlayers < 1) {
    problems.push('minPlayers must be an integer of at least 1');
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers > config.MAX_PLAYERS) {
    problems.push(`maxPlayers must be an integer of at most ${config.MAX_PLAYERS}`);
  } else if (Number.isInteger(minPlayers) && maxPlayers < minPlayers) {
    problems.push('maxPlayers must be at least minPlayers');
  }

  if (typeof game.source !== 'string' || game.source.length === 0) problems.push('source must be the game file');
  return problems;
}

/**
 * Like readFrameGame, but throws a readable error instead (for loading games).
 * @returns {FrameGame}
 */
export function frameGameOrThrow(source, id) {
  const result = readFrameGame(source, id);
  if (!result.ok) throw new Error(`Game "${id}" can't be used:\n - ${result.problems.join('\n - ')}`);
  return result.game;
}

/**
 * A problem found in a game file: a plain sentence (the game info), or a finding from the
 * static check or the browser playtest, which may point at a line.
 * @typedef {string | { message: string, rule?: string, line?: number, code?: string }} Problem
 */

/**
 * The server's report for a game file, in the shape versions store and the admin page
 * shows: the game info and the static check (staticCheck.js). Errors fail it; warnings
 * are lines to look at in review. The browser playtest (F4) runs in the generator's
 * sandbox, never on the server, and adds its own results to the report there.
 * @returns {{ ok: boolean, problems: Problem[], warnings: Problem[], checked: string, game?: { name: string, description: string } }}
 */
export function frameGameReport(source) {
  const result = readFrameGame(source, 'game');
  const checked = 'the game info and the static check';
  if (!result.ok) return { ok: false, problems: result.problems, warnings: [], checked };
  const { errors, warnings } = staticCheck(source);
  const game = { name: result.game.name, description: result.game.description };
  return { ok: errors.length === 0, problems: errors, warnings, checked, game };
}

/** A problem as one line of text, for the command line. */
export function describeProblem(problem) {
  if (typeof problem === 'string') return problem;
  const where = problem.line ? `line ${problem.line}: ` : '';
  return `${where}${problem.message}${problem.code ? `\n     ${problem.code}` : ''}`;
}
