// `npm run compare-builds -- --name <name> --idea "<idea>" [--design <file>] [--runs 4]
//      --variant <label>='<job options as JSON>' --variant …`
//
// Builds ONE design several times with each variant of the build's options, to see what a
// prompt change does (plan §32). The model gives a different game every time, so one build
// per side says little: this builds each variant `runs` times, taking turns (A, B, A, B, …)
// so both sides meet the same GenAI Studio load. Everything else stays the same: the same
// design, idea and model.
//
// Without --design, it asks the model for a design first (once) and builds that.
// Runs one build at a time, like a job on the server would without others around.
//
// Saves to generator/out/<name>/: design.md, then per build <label>-<n>/ with game.html,
// result.json and the screenshots, and summary.md: a table of every build (passed, size,
// attempts, tokens, time). Run it again with the same --name to add more builds.
//
// Example (plan §32: does telling the model "At most 100 KB" change its games?):
//   npm run compare-builds -- --name size-limit --idea "…" --runs 4 \
//     --variant limit='{}' --variant no-limit='{"sizeLimit":false}'

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runGeneratorInSandbox } from '../src/generation/sandbox.js';
import { describeProblem } from '../src/games/frameGame.js';
import { DEFAULT_MODEL } from '../../generator/src/models.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    idea: { type: 'string' },
    design: { type: 'string' },
    runs: { type: 'string', default: '4' },
    model: { type: 'string' },
    variant: { type: 'string', multiple: true, default: [] },
  },
});
const cwd = process.env.INIT_CWD || process.cwd(); // npm runs scripts from the repo root
const runs = Number(values.runs);
const model = values.model ?? DEFAULT_MODEL;

/** @type {[string, object][]} */
let variants;
try {
  variants = values.variant.map((v) => {
    const at = v.indexOf('=');
    if (at < 1) throw new Error(`--variant ${v}: write it as label='{…}'`);
    return [v.slice(0, at), JSON.parse(v.slice(at + 1))];
  });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
if (!values.name || !/^[a-z0-9-]+$/.test(values.name) || !values.idea || !(runs >= 1) || variants.length === 0) {
  console.error(`Usage: npm run compare-builds -- --name <name> --idea "<idea>" [--design <file>] [--runs 4]
       --variant <label>='<job options as JSON>' [--variant …]
  (name: lowercase letters, digits and dashes)`);
  process.exit(2);
}

const outDir = fileURLToPath(new URL(`../../generator/out/${values.name}/`, import.meta.url));
await mkdir(outDir, { recursive: true });
const log = (text) => console.log(`${new Date().toLocaleTimeString()}  ${text}`);

// --- The design: given, saved from an earlier run, or made now (once) --------------------------
const designFile = path.join(outDir, 'design.md');
let design;
if (values.design) {
  design = await readFile(path.resolve(cwd, values.design), 'utf8');
  await writeFile(designFile, design);
} else if (existsSync(designFile)) {
  design = await readFile(designFile, 'utf8');
  log(`using the design from an earlier run: ${designFile}`);
} else {
  log('asking for a design…');
  const result = await runGeneratorInSandbox({ step: 'design', idea: values.idea, model }, { onStep: (s) => log(`  ${s}`) });
  if (!result.ok) {
    console.error(`No design: ${result.error}`);
    process.exit(1);
  }
  design = result.design;
  await writeFile(designFile, design);
  log(`design saved: ${designFile}`);
}

// --- The builds, taking turns --------------------------------------------------------------------
const taken = new Set(await readdir(outDir));
const nextName = (label) => {
  let n = 1;
  while (taken.has(`${label}-${n}`)) n++;
  taken.add(`${label}-${n}`);
  return `${label}-${n}`;
};

for (let run = 1; run <= runs; run++) {
  for (const [label, options] of variants) {
    const name = nextName(label);
    const dir = path.join(outDir, name);
    await mkdir(dir);
    log(`${name}: building (${run}/${runs})`);
    const started = Date.now();
    const result = await runGeneratorInSandbox(
      { step: 'build', idea: values.idea, model, design, ...options },
      { onStep: (s) => log(`  ${name}: ${s}`) },
    );
    const seconds = Math.round((Date.now() - started) / 1000);
    const { screenshots, ...playtest } = result.report?.playtest ?? {};
    await writeFile(
      path.join(dir, 'result.json'),
      JSON.stringify({ label, options, seconds, ...result, source: undefined, report: result.report && { ...result.report, playtest } }, null, 2),
    );
    if (result.source) await writeFile(path.join(dir, 'game.html'), result.source);
    for (const [which, url] of Object.entries(screenshots ?? {})) {
      await writeFile(path.join(dir, `${which}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
    log(`${name}: ${result.ok ? 'passed' : `failed (${result.error})`}, ${result.source ? `${kb(result.source)} KB` : 'no file'}, ${seconds} s`);
    for (const p of result.report?.problems ?? []) log(`  ✗ ${describeProblem(p)}`);
  }
}

await writeFile(path.join(outDir, 'summary.md'), await summary());
console.log(`\n${await summary()}`);

function kb(source) {
  return Math.round(Buffer.byteLength(source) / 102.4) / 10;
}

/** A table of every build in the folder (this run's and earlier ones), and each variant's averages. */
async function summary() {
  const rows = [];
  for (const entry of (await readdir(outDir)).sort()) {
    const file = path.join(outDir, entry, 'result.json');
    if (!existsSync(file)) continue;
    const r = JSON.parse(await readFile(file, 'utf8'));
    const game = existsSync(path.join(outDir, entry, 'game.html')) ? await readFile(path.join(outDir, entry, 'game.html'), 'utf8') : null;
    const attempts = r.attempts ?? [];
    const sum = (key) => attempts.reduce((total, a) => total + (a.usage?.[key] ?? 0), 0);
    rows.push({
      entry,
      label: r.label,
      ok: r.ok === true,
      kb: game ? kb(game) : null,
      attempts: attempts.length,
      first: attempts[0]?.usage?.completion_tokens ?? null, // the first build: its thinking + the whole file
      completion: sum('completion_tokens'),
      prompt: sum('prompt_tokens'),
      seconds: r.seconds,
    });
  }
  const lines = [
    `# ${values.name}`,
    '',
    `Idea: ${values.idea}`,
    '',
    '| Build | Passed | Size | Attempts | First reply (tokens) | All replies | All prompts | Time |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.entry} | ${r.ok ? 'yes' : 'no'} | ${r.kb ?? '–'} KB | ${r.attempts} | ${r.first ?? '–'} | ${r.completion} | ${r.prompt} | ${r.seconds} s |`),
    '',
    '| Variant | Builds | Passed | Avg size | Avg first reply | Avg time |',
    '|---|---|---|---|---|---|',
  ];
  const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : '–');
  for (const label of [...new Set(rows.map((r) => r.label))]) {
    const of = rows.filter((r) => r.label === label);
    lines.push(
      `| ${label} | ${of.length} | ${of.filter((r) => r.ok).length} | ${avg(of.filter((r) => r.kb !== null).map((r) => r.kb))} KB | ${avg(of.filter((r) => r.first !== null).map((r) => r.first))} | ${avg(of.map((r) => r.seconds))} s |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
