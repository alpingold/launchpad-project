// `npm run compare-builds -- --name <name> --idea "<idea>" [--design <file> | --fresh-design] [--runs 4]
//      --variant <label>='<job options as JSON>' --variant …`
//
// Builds ONE design several times with each variant of the build's options, to see what a
// prompt change does (plan §32). The model gives a different game every time, so one build
// per side says little: this builds each variant `runs` times, taking turns (A, B, A, B, …)
// so both sides meet the same GenAI Studio load (or, with --parallel, both at once). Everything
// else stays the same: the same design, idea and model.
//
// Without --design, it asks the model for a design first (once) and builds that.
// With --fresh-design, every build makes its own design first, with the variant's options: for a
// change that shapes the design too (plan §35's 5–15 minute rule). Each is saved in its build's folder.
// Runs one build at a time, like a job on the server would without others around.
//
// Saves to generator/out/<name>/: design.md (unless --fresh-design), then per build <label>-<n>/ with game.html,
// result.json and the screenshots, and summary.md: a table of every build (passed, size,
// attempts, tokens, time). Run it again with the same --name to add more builds. A variant with
// "keepThinking": true also saves each attempt's thinking and whole reply as
// attempt-<n>-thinking.txt and attempt-<n>-reply.txt (plan §38), and any tool calls the server
// split off the reply as attempt-<n>-toolcalls.txt (plan §40).
//
// --parallel builds each round's variants at the same time (A and B together, then again), so
// both still meet the same GenAI Studio load. Each build is one long request at a time, well
// under GenAI Studio's 20 requests a minute.
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
    'fresh-design': { type: 'boolean', default: false },
    runs: { type: 'string', default: '4' },
    model: { type: 'string' },
    variant: { type: 'string', multiple: true, default: [] },
    parallel: { type: 'boolean', default: false },
  },
});
const cwd = process.env.INIT_CWD || process.cwd(); // npm runs scripts from the repo root
const runs = Number(values.runs);
const freshDesign = values['fresh-design'];
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
if (!values.name || !/^[a-z0-9-]+$/.test(values.name) || !values.idea || !(runs >= 1) || variants.length === 0 || (freshDesign && values.design)) {
  console.error(`Usage: npm run compare-builds -- --name <name> --idea "<idea>" [--design <file> | --fresh-design] [--runs 4] [--parallel]
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
if (freshDesign) {
  // made per build, below
} else if (values.design) {
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

/** --fresh-design: a design for one build, with the variant's options, saved in its folder. */
async function designFor(name, dir, options) {
  log(`${name}: designing`);
  const result = await runGeneratorInSandbox({ step: 'design', idea: values.idea, model, ...options }, { onStep: (s) => log(`  ${name}: ${s}`) });
  if (!result.ok) return { error: result.error };
  await writeFile(path.join(dir, 'design.md'), result.design);
  return { design: result.design };
}

// --- The builds, taking turns --------------------------------------------------------------------
const taken = new Set(await readdir(outDir));
const nextName = (label) => {
  let n = 1;
  while (taken.has(`${label}-${n}`)) n++;
  taken.add(`${label}-${n}`);
  return `${label}-${n}`;
};

/** One build of one variant, saved in its own folder. */
async function buildOne(label, options, run) {
  const name = nextName(label);
  const dir = path.join(outDir, name);
  await mkdir(dir);
  const started = Date.now();
  let buildDesign = design;
  if (freshDesign) {
    const made = await designFor(name, dir, options);
    if (made.error) {
      log(`${name}: no design (${made.error})`);
      await writeFile(path.join(dir, 'result.json'), JSON.stringify({ label, options, seconds: Math.round((Date.now() - started) / 1000), ok: false, error: `no design: ${made.error}` }, null, 2));
      return;
    }
    buildDesign = made.design;
  }
  log(`${name}: building (${run}/${runs})`);
  const result = await runGeneratorInSandbox(
    { step: 'build', idea: values.idea, model, design: buildDesign, ...options },
    { onStep: (s) => log(`  ${name}: ${s}`) },
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  const { screenshots, ...playtest } = result.report?.playtest ?? {};
  for (const a of result.attempts ?? []) {
    if (typeof a.thinking === 'string') await writeFile(path.join(dir, `attempt-${a.attempt}-thinking.txt`), a.thinking);
    if (typeof a.reply === 'string') await writeFile(path.join(dir, `attempt-${a.attempt}-reply.txt`), a.reply);
    if (typeof a.toolCalls === 'string') await writeFile(path.join(dir, `attempt-${a.attempt}-toolcalls.txt`), a.toolCalls);
  }
  const attempts = result.attempts?.map(({ thinking, reply, toolCalls, ...a }) => a);
  await writeFile(
    path.join(dir, 'result.json'),
    JSON.stringify({ label, options, seconds, ...result, attempts, source: undefined, report: result.report && { ...result.report, playtest } }, null, 2),
  );
  if (result.source) await writeFile(path.join(dir, 'game.html'), result.source);
  for (const [which, url] of Object.entries(screenshots ?? {})) {
    await writeFile(path.join(dir, `${which}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
  log(`${name}: ${result.ok ? 'passed' : `failed (${result.error})`}, ${result.source ? `${kb(result.source)} KB` : 'no file'}, ${seconds} s`);
  for (const p of result.report?.problems ?? []) log(`  ✗ ${describeProblem(p)}`);
}

for (let run = 1; run <= runs; run++) {
  if (values.parallel) {
    await Promise.all(variants.map(([label, options]) => buildOne(label, options, run)));
  } else {
    for (const [label, options] of variants) await buildOne(label, options, run);
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
      minutes: game?.match(/"minutes"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/)?.slice(1).join('–') ?? null, // the game's own estimate
      attempts: attempts.length,
      first: attempts[0]?.usage?.completion_tokens ?? null, // the first build: its thinking + the whole file
      thinking: attempts[0]?.usage?.completion_tokens_details?.reasoning_tokens ?? null, // of which thinking
      outOfRoom: attempts.filter((a) => a.outOfRoom).length,
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
    '| Build | Passed | Size | Minutes | Attempts | Out of room | First reply (tokens) | Its thinking | All replies | All prompts | Time |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.entry} | ${r.ok ? 'yes' : 'no'} | ${r.kb ?? '–'} KB | ${r.minutes ?? '–'} | ${r.attempts} | ${r.outOfRoom} | ${r.first ?? '–'} | ${r.thinking ?? '–'} | ${r.completion} | ${r.prompt} | ${r.seconds} s |`),
    '',
    '| Variant | Builds | Passed | Out of room | Avg size | Avg first reply | Avg time |',
    '|---|---|---|---|---|---|---|',
  ];
  const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : '–');
  for (const label of [...new Set(rows.map((r) => r.label))]) {
    const of = rows.filter((r) => r.label === label);
    lines.push(
      `| ${label} | ${of.length} | ${of.filter((r) => r.ok).length} | ${of.reduce((n, r) => n + r.outOfRoom, 0)} | ${avg(of.filter((r) => r.kb !== null).map((r) => r.kb))} KB | ${avg(of.filter((r) => r.first !== null).map((r) => r.first))} | ${avg(of.map((r) => r.seconds))} s |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
