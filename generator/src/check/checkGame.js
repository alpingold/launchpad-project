// CHECKING A GAME FILE (plan §13i, F4): everything we can find out before a person plays it.
//
//   1. the game info (server/src/games/frameGame.js)          - without running anything
//   2. the static check (server/src/games/staticCheck.js)     - without running anything
//   3. the browser playtest (playtest.js)                     - RUNS the game, in Chromium
//
// Step 3 runs code nobody has read yet, so for generated games it only ever runs inside the
// OpenShell sandbox (plan §11). On your own machine, `npm run check-game` runs it for files
// you wrote or chose to check.
//
// The report has the same shape the server stores for a version (frameGameReport), plus
// what the playtest saw and its screenshots as data: URLs, for the admin page.

import { frameGameReport } from '../../../server/src/games/frameGame.js';
import { playtest } from './playtest.js';

/**
 * @param {string} source  the game file
 * @param {Parameters<typeof playtest>[1] & { browser?: boolean }} [opts]
 *   browser: false skips the playtest (steps 1–2 only)
 */
export async function checkGame(source, opts = {}) {
  const report = frameGameReport(source);
  if (!report.game || opts.browser === false) return report; // no valid game info: nothing to play

  const limits = gameLimits(source);
  const result = await playtest(source, { ...opts, limits });
  const { players, seconds } = result.summary;
  const screenshots = {};
  for (const [which, jpeg] of Object.entries(result.screenshots)) {
    if (jpeg) screenshots[which] = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  }
  const problems = [...report.problems, ...result.problems];
  return {
    ...report,
    ok: problems.length === 0,
    problems,
    warnings: [...report.warnings, ...result.warnings],
    checked: `the game info, the static check, and ${seconds} s of play in a headless browser with ${players} simulated phone${players === 1 ? '' : 's'}`,
    playtest: { ...result.summary, screenshots },
  };
}

function gameLimits(source) {
  const info = JSON.parse(/<script\b[^>]*id=["']game-info["'][^>]*>([\s\S]*?)<\/script>/i.exec(source)[1]);
  return { minPlayers: info.minPlayers, maxPlayers: info.maxPlayers };
}
