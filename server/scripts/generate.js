#!/usr/bin/env node
// `npm run generate -- "<game idea>" [--model <model>]`: generates a game in the
// OpenShell sandbox and saves it to generator/out/<time>/ for you to read.
//
// Nothing is stored in the database and nothing runs on the server. If you like the game:
//   npm run admin -- import-game generator/out/<time>/game.js --owner <you>
// (A5/A6 will do this from the website, with the same sandbox runner.)

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeneratorInSandbox } from '../src/generation/sandbox.js';
import { formatReport } from '../src/games/harness/check.js';
import { MODELS, DEFAULT_MODEL } from '../../generator/src/models.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const idea = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const model = flag('model') ?? DEFAULT_MODEL;

if (!idea) {
  console.error(`Usage: npm run generate -- "<game idea>" [--model <model>]

Models:
${MODELS.map((m) => `  ${m.id.padEnd(14)} ${m.note}`).join('\n')}

Needs the one-time OpenShell setup in generator/README.md, and the generator image:
  docker build -f generator/Dockerfile -t boilergames-generator:local .`);
  process.exit(2);
}

const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`.padStart(5);
const result = await runGeneratorInSandbox({ idea, model }, { onStep: (step) => console.log(`${elapsed()}  ${step}`) });

const outDir = fileURLToPath(new URL(`../../generator/out/${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'result.json'), JSON.stringify({ idea, ...result }, null, 2));
if (result.source) await writeFile(path.join(outDir, 'game.js'), result.source);

console.log('');
if (result.report) console.log(formatReport(result.report, 'game.js'));
const relative = path.relative(process.env.INIT_CWD || process.cwd(), outDir);
if (result.ok) {
  console.log(`\nSaved to ${relative}/game.js. Read it, then if you like it:`);
  console.log(`  npm run admin -- import-game ${relative}/game.js --owner <your username>`);
} else {
  console.log(`\nNo passing game: ${result.error}${result.source ? `\nThe last attempt is in ${relative}/game.js` : ''}`);
}
process.exit(result.ok ? 0 : 1);
