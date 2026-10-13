// THE GAME TEST HARNESS (plan §11c, milestone A2): the entry point for checking a game.
//
// checkGameFile / checkGameSourceIsolated run all the checks (check.js) in a SEPARATE
// Node process (worker.js), because the game's code might never return:
//  - a time limit: an infinite loop is reported as "hung", instead of freezing the caller
//  - a memory limit: a game that builds a giant array gets killed, not the caller
//  - Node's permission model: the worker can read only our harness code and the art
//    manifest, and can't write files or start processes (a seat belt; see worker.js)
//
// Used by `npm run check-game`, by the tests, and (A4) by the generator in its sandbox.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.js';

const WORKER = fileURLToPath(new URL('./worker.js', import.meta.url));
const SERVER_SRC = fileURLToPath(new URL('../../', import.meta.url));
const SERVER_PACKAGE_JSON = fileURLToPath(new URL('../../../package.json', import.meta.url));

/** How long checking one game may take in total. Normal games need about a second. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Memory the worker may use. Generous for a party game. */
const MAX_HEAP_MB = 256;

/**
 * Checks game source code in a separate, locked-down process.
 * @param {string} source
 * @param {{ sourceName?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<import('./check.js').CheckReport>}
 */
export function checkGameSourceIsolated(source, { sourceName = 'game.js', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const args = [
    '--permission',
    `--allow-fs-read=${SERVER_SRC}`, // our code (the worker, GameRunner, ...)
    `--allow-fs-read=${SERVER_PACKAGE_JSON}`, // tells Node our .js files are ES modules
    `--allow-fs-read=${config.ASSET_MANIFEST_PATH}`,
    `--max-old-space-size=${MAX_HEAP_MB}`,
    WORKER,
    sourceName,
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.stdin.on('error', () => {}); // the worker may die before reading everything
    child.stdin.end(source);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // The worker prints "STEP <what it's doing>" lines; anything else is crash output.
      const lastStep = stderr.match(/^STEP (.*)$/gm)?.at(-1)?.slice(5) ?? 'starting';
      const fail = (message) => resolve({ ok: false, problems: [{ message }], runs: [] });

      if (timedOut) {
        return fail(
          `Hung: still running after ${Math.round(timeoutMs / 1000)} s, while ${lastStep}. ` +
            'This is almost always an infinite loop (a while/for loop whose condition never becomes false). ' +
            'Games must return quickly from every call; use ctx.setTimeout to wait.',
        );
      }
      if (/heap out of memory|Allocation failed/i.test(stderr)) {
        return fail(`Ran out of memory while ${lastStep}. The game is building something huge (an ever-growing array or string?).`);
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch {
        fail(`The checker stopped unexpectedly (exit ${code ?? signal}) while ${lastStep}. Last output: ${stderr.slice(-300)}`);
      }
    });
  });
}

/**
 * Checks a game file (see checkGameSourceIsolated).
 * @param {string} file
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function checkGameFile(file, opts = {}) {
  const source = await readFile(file, 'utf8');
  return checkGameSourceIsolated(source, { ...opts, sourceName: path.basename(file) });
}

export { formatReport } from './check.js';
