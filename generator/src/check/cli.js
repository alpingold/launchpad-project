#!/usr/bin/env node
// `npm run check-game -- <game.html> [--players 3] [--seconds 20] [--shots <folder>] [--headed] [--no-browser]`
//
// Checks one frame game file (checkGame.js) and prints what it found. --shots saves the
// playtest's screenshots there; --headed shows the browser windows while it plays.
// Exit code 0 if it passed, 1 if not, 2 if it couldn't run.
//
// It RUNS the game in Chromium on this machine: use it on files you wrote or chose to check.
// Generated games are checked inside the OpenShell sandbox instead (plan §11).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkGame } from './checkGame.js';
import { describeProblem } from '../../../server/src/games/frameGame.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    players: { type: 'string' },
    seconds: { type: 'string' },
    shots: { type: 'string' },
    headed: { type: 'boolean', default: false },
    'no-browser': { type: 'boolean', default: false },
  },
});
const cwd = process.env.INIT_CWD || process.cwd(); // npm runs scripts from the repo root
const [file] = positionals;
if (!file) {
  console.error('Usage: npm run check-game -- <game.html> [--players 3] [--seconds 20] [--shots <folder>] [--headed] [--no-browser]');
  process.exit(2);
}

const source = await readFile(path.resolve(cwd, file), 'utf8');
const started = Date.now();
const report = await checkGame(source, {
  players: values.players ? Number(values.players) : undefined,
  seconds: values.seconds ? Number(values.seconds) : undefined,
  headed: values.headed,
  browser: !values['no-browser'],
  onStep: (text) => console.log(`  … ${text}`),
});

const where = (p) => (typeof p === 'object' && p.screen ? ` [${p.screen}]` : '');
const times = (p) => (typeof p === 'object' && p.count > 1 ? ` (×${p.count})` : '');
console.log(`\n${report.game ? `${report.game.name}: ` : ''}checked ${report.checked} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (report.playtest) {
  const t = report.playtest;
  console.log(
    `  phones sent ${t.eventsFromPhones} events, the big screen sent ${t.updatesToPhones} updates and saved ${t.saves} times; ` +
      (t.ended ? `it ended after ${t.endedAfterSeconds} s: ${JSON.stringify(t.results)}` : 'it was still running at the end'),
  );
}
for (const p of report.problems) console.log(`  ✗${where(p)} ${describeProblem(p)}${times(p)}`);
for (const w of report.warnings) console.log(`  !${where(w)} ${describeProblem(w)}${times(w)}`);
console.log(report.ok ? '\nPASSED' : `\nFAILED: ${report.problems.length} problem${report.problems.length === 1 ? '' : 's'}`);

if (values.shots && report.playtest) {
  const dir = path.resolve(cwd, values.shots);
  await mkdir(dir, { recursive: true });
  for (const [which, url] of Object.entries(report.playtest.screenshots)) {
    const out = path.join(dir, `${which}.jpg`);
    await writeFile(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`screenshot: ${out}`);
  }
}
process.exit(report.ok ? 0 : 1);
