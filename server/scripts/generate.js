#!/usr/bin/env node
// `npm run generate -- "<game idea>"`: makes a frame game in the OpenShell sandbox, in the
// same two steps as the admin page (plan §13i), and saves everything to generator/out/<time>/.
//
//   1. The design: the AI writes it to design.md. Then you choose:
//        Enter         build it
//        some text     ask for a new draft with that feedback
//        e             edit design.md yourself (in any editor), then press Enter to build it
//        q             stop here
//   2. The build: game.html, checked in the sandbox (static check + a browser playtest),
//      with its report and screenshots.
//
// Options:
//   --model <id>        which model (see generator/src/models.js)
//   --design <file>     skip step 1: build from a design you already have
//   --yes               build the first design without asking (for scripts)
//
// Nothing is stored in the database and nothing runs on the server. If you like the game:
//   npm run admin -- import-game generator/out/<time>/game.html --owner <you>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { runGeneratorInSandbox } from '../src/generation/sandbox.js';
import { describeProblem } from '../src/games/frameGame.js';
import { MODELS, DEFAULT_MODEL } from '../../generator/src/models.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { model: { type: 'string' }, design: { type: 'string' }, yes: { type: 'boolean', default: false } },
});
const [idea] = positionals;
const model = values.model ?? DEFAULT_MODEL;
const cwd = process.env.INIT_CWD || process.cwd(); // npm runs scripts from the repo root

if (!idea) {
  console.error(`Usage: npm run generate -- "<game idea>" [--model <model>] [--design <file>] [--yes]

Models:
${MODELS.map((m) => `  ${m.id.padEnd(14)} ${m.note}`).join('\n')}

Needs the one-time OpenShell setup in generator/README.md, and the generator image:
  docker build -f generator/Dockerfile -t boilergames-generator:local .`);
  process.exit(2);
}

const outDir = fileURLToPath(new URL(`../../generator/out/${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
const relative = (file) => path.relative(cwd, path.join(outDir, file));
await mkdir(outDir, { recursive: true });

let started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`.padStart(5);
const onStep = (step) => console.log(`${elapsed()}  ${step}`);
const designFile = path.join(outDir, 'design.md');

// --- Step 1: the design -------------------------------------------------------------------
let design = values.design ? await readFile(path.resolve(cwd, values.design), 'utf8') : null;
if (design === null) {
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  let redraft;
  for (;;) {
    started = Date.now();
    const result = await runGeneratorInSandbox({ step: 'design', idea, model, ...(redraft ? { redraft } : {}) }, { onStep });
    if (!result.ok) {
      console.log(`\nNo design: ${result.error}`);
      process.exit(1);
    }
    design = result.design;
    await writeFile(designFile, design);
    console.log(`\n${design}\n(saved to ${relative('design.md')})\n`);
    if (values.yes) break;
    const answer = (await ask.question('Enter = build it · type feedback for a new draft · e = edit design.md yourself · q = stop\n> ')).trim();
    if (answer === '') break;
    if (answer === 'q') process.exit(0);
    if (answer === 'e') {
      await ask.question(`Edit ${relative('design.md')}, save it, then press Enter to build it. `);
      design = await readFile(designFile, 'utf8');
      break;
    }
    redraft = { draft: design, feedback: answer };
  }
  ask.close();
} else {
  await writeFile(designFile, design);
}

// --- Step 2: the build --------------------------------------------------------------------
started = Date.now();
console.log('\nBuilding it…');
const result = await runGeneratorInSandbox({ step: 'build', idea, model, design }, { onStep });
const { screenshots, ...playtest } = result.report?.playtest ?? {};
await writeFile(path.join(outDir, 'result.json'), JSON.stringify({ idea, design, ...result, report: result.report && { ...result.report, playtest } }, null, 2));
if (result.source) await writeFile(path.join(outDir, 'game.html'), result.source);
for (const [which, url] of Object.entries(screenshots ?? {})) {
  await writeFile(path.join(outDir, `${which}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
}

console.log('');
if (result.report) {
  for (const p of result.report.problems) console.log(`  ✗ ${describeProblem(p)}`);
  for (const w of result.report.warnings ?? []) console.log(`  ! ${describeProblem(w)}`);
}
if (result.ok) {
  console.log(`\nSaved to ${relative('game.html')} (screenshots next to it). Read it, then if you like it:`);
  console.log(`  npm run admin -- import-game ${relative('game.html')} --owner <your username>`);
} else {
  console.log(`\nNo passing game: ${result.error}${result.source ? `\nThe last attempt is in ${relative('game.html')}` : ''}`);
}
process.exit(result.ok ? 0 : 1);
