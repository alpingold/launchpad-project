// CHECK: everything the harness does to one game's source code, in order (plan §11c):
//   1. lint the text
//   2. load it as a module (it can't import anything: see loadGameSource)
//   3. validateGameModule (the same check the registry does)
//   4. play it with bots: every player count that matters × every scenario × 2 seeds
//
// This file RUNS the game's code. For code nobody has reviewed yet, call it only through
// checkGameFile / checkGameSourceIsolated (index.js), which run it in a separate,
// locked-down process with a time limit, and do that inside the OpenShell sandbox.

import { readFileSync } from 'node:fs';
import { config } from '../../config.js';
import { validateGameModule } from '../contract.js';
import { lintGameSource } from './lint.js';
import { simulateGame, describeError, SCENARIOS } from './simulate.js';

const SEEDS = [1, 2];

/**
 * @typedef {Object} CheckProblem
 * @property {string} message   what's wrong and how to fix it
 * @property {string} [where]   the first simulated run where it happened
 * @property {number} [runs]    how many simulated runs hit it
 *
 * @typedef {Object} CheckReport
 * @property {boolean} ok
 * @property {CheckProblem[]} problems
 * @property {object[]} runs    one summary per simulated game
 */

/** The ids in the art library. */
export function loadAssetIds(manifestPath = config.ASSET_MANIFEST_PATH) {
  return new Set(JSON.parse(readFileSync(manifestPath, 'utf8')).assets.map((a) => a.id));
}

/**
 * Loads game source as a module, WITHOUT writing it to disk: a `data:` URL is code that
 * comes from a string. A data: module can't import files next to it, which matches
 * contract rule 1. The `sourceURL` comment makes error messages say "game.js line 42"
 * instead of a long base64 string.
 * @returns {Promise<unknown>} the default export
 */
export async function loadGameSource(source, sourceName = 'game.js') {
  const withName = `${source}\n//# sourceURL=${sourceName}\n`;
  const url = `data:text/javascript;base64,${Buffer.from(withName).toString('base64')}`;
  return (await import(url)).default;
}

/** Which player counts to try: the smallest and largest allowed, plus 3 (a typical party) if in range. */
export function playerCountsFor(game) {
  const typical = Math.min(Math.max(3, game.minPlayers), game.maxPlayers);
  return [...new Set([game.minPlayers, typical, game.maxPlayers])].sort((a, b) => a - b);
}

/**
 * Runs every check on one game's source.
 * @param {string} source
 * @param {{ assetIds?: Set<string>, sourceName?: string, onProgress?: (text: string) => void }} [opts]
 * @returns {Promise<CheckReport>}
 */
export async function checkGameSource(source, { assetIds = loadAssetIds(), sourceName = 'game.js', onProgress = () => {} } = {}) {
  /** @type {CheckProblem[]} */
  const problems = lintGameSource(source).map((message) => ({ message: `Lint, ${message}` }));

  onProgress('loading the game');
  let game;
  try {
    game = await loadGameSource(source, sourceName);
  } catch (err) {
    problems.push({ message: `Could not load the game: ${describeError(err, sourceName)}` });
    return { ok: false, problems, runs: [] };
  }
  const contractProblems = validateGameModule(game);
  if (contractProblems.length) {
    problems.push(...contractProblems.map((p) => ({ message: `The GameModule is invalid: ${p}` })));
    return { ok: false, problems, runs: [] };
  }

  const runs = [];
  /** @type {Map<string, CheckProblem>} the same problem in many runs is reported once */
  const fromRuns = new Map();
  const matrix = playerCountsFor(game).flatMap((playerCount) =>
    Object.keys(SCENARIOS).flatMap((scenario) => SEEDS.map((seed) => ({ playerCount, scenario, seed }))),
  );
  for (const { playerCount, scenario, seed } of matrix) {
    onProgress(`playing: ${playerCount} player${playerCount === 1 ? '' : 's'}, scenario "${scenario}", seed ${seed}`);
    const run = simulateGame(game, { playerCount, scenario, seed, assetIds, sourceName });
    runs.push({ ...run, problems: run.problems.length });
    for (const message of run.problems) {
      const seen = fromRuns.get(message);
      if (seen) seen.runs++;
      else fromRuns.set(message, { message, where: run.where, runs: 1 });
    }
    // A too-slow game would make every later run slow too: one report is enough.
    if (run.problems.some((m) => m.startsWith('Too slow'))) break;
  }
  problems.push(...fromRuns.values());
  return { ok: problems.length === 0, problems, runs };
}

/** A report as readable text (for the terminal, and for feeding back to a model in A4). */
export function formatReport(report, name = 'game') {
  if (report.ok) {
    const games = report.runs.length;
    return `PASS  ${name}: lint clean, valid GameModule, ${games} simulated games all ended cleanly.`;
  }
  const lines = [`FAIL  ${name}: ${report.problems.length} problem${report.problems.length === 1 ? '' : 's'}`];
  for (const [i, p] of report.problems.entries()) {
    lines.push(`  ${i + 1}. ${p.message}`);
    if (p.where) lines.push(`     first seen with ${p.where}${p.runs > 1 ? `; happened in ${p.runs} runs` : ''}`);
  }
  return lines.join('\n');
}
