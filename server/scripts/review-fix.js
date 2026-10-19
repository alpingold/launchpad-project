// `npm run review-fix -- <folder> [<folder> …] [--only <build>] [--parallel 6]`
//
// The review-and-fix test (plan §47): would it help to run the reviewer after a game is built,
// and fix its critical bugs (crash, stuck) on its own? For every build in a compare-builds
// folder that has a checklist.json (made by review-builds), into <build>/reviewfix/:
//
//   1. review the game (before.json)
//   2. if it has critical bugs: send them as a small change, the way a creator's edit request
//      goes (build step with "change"), so the fixed game passes the same checks and fix rounds
//      (fix.json; game.html if it passed; a failed fix keeps the original game)
//   3. review the fixed game against the same checklist (after.json)
//
// review-fix.md compares them: critical bugs before and after, the score, the lines changed.
// It doesn't say whether a bug was real or the fix right: read the diffs for that.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runGeneratorInSandbox } from '../src/generation/sandbox.js';
import { verify, score, fixRequest, CRITICAL } from '../../generator/src/review.js';
import { MAX_REQUEST_LENGTH } from '../../generator/src/prompt.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { only: { type: 'string' }, parallel: { type: 'string', default: '6' } },
});
const cwd = process.env.INIT_CWD || process.cwd(); // npm runs scripts from the repo root
if (positionals.length === 0) {
  console.error('Usage: npm run review-fix -- <folder> [<folder> …] [--only <build>] [--parallel 6]');
  process.exit(2);
}
const log = (text) => console.log(`${new Date().toLocaleTimeString()}  ${text}`);
const IDEA = 'Review a built party game against its design.'; // jobs need an idea; the reviewer doesn't use it

const tasks = [];
for (const folder of positionals.map((p) => path.resolve(cwd, p))) {
  const checklistFile = path.join(folder, 'checklist.json');
  if (!existsSync(checklistFile)) {
    console.error(`${path.basename(folder)}: no checklist.json (run review-builds first), skipped`);
    continue;
  }
  const checklist = JSON.parse(await readFile(checklistFile, 'utf8'));
  const design = await readFile(path.join(folder, 'design.md'), 'utf8');
  // The game's idea goes into the fix prompt, as it would on the site (compare-builds wrote it here).
  const idea = (await readFile(path.join(folder, 'summary.md'), 'utf8').catch(() => '')).match(/^Idea: (.+)$/m)?.[1];
  if (!idea) {
    console.error(`${path.basename(folder)}: no "Idea:" line in summary.md, skipped`);
    continue;
  }
  for (const d of await readdir(folder, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(path.join(folder, d.name, 'game.html'))) continue;
    if (values.only && d.name !== values.only) continue;
    tasks.push({ folder, build: d.name, checklist, design, idea });
  }
}

// At most --parallel at once: each one is up to three model calls and a playtest.
const queue = [...tasks];
await Promise.all(Array.from({ length: Number(values.parallel) }, async () => {
  while (queue.length) await reviewAndFix(queue.shift());
}));
for (const folder of new Set(tasks.map((t) => t.folder))) {
  const text = await summary(folder);
  await writeFile(path.join(folder, 'review-fix.md'), text);
  console.log(`\n${text}`);
}

async function review(checklist, source, label) {
  log(`${label}: reviewing`);
  const res = await runGeneratorInSandbox({ step: 'review', idea: IDEA, checklist, source }, { onStep: () => {} });
  if (!res.ok) {
    log(`${label}: no review (${res.error})`);
    return null;
  }
  return { ...res.review, items: verify(checklist, res.review.items, source), usage: res.usage, seconds: res.seconds };
}

async function reviewAndFix({ folder, build, checklist, design, idea }) {
  const label = `${path.basename(folder)}/${build}`;
  const out = path.join(folder, build, 'reviewfix');
  await mkdir(out, { recursive: true });
  const source = await readFile(path.join(folder, build, 'game.html'), 'utf8');

  const before = await review(checklist, source, label);
  if (!before) return;
  await writeFile(path.join(out, 'before.json'), JSON.stringify(before, null, 2));
  const critical = before.bugs.filter((b) => CRITICAL.includes(b.severity));
  log(`${label}: ${critical.length} critical bug(s) of ${before.bugs.length}`);
  if (critical.length === 0) return;

  log(`${label}: fixing`);
  // Crashes first: they matter most if not every bug fits in one request.
  const { request, left } = fixRequest([...critical].sort((a, b) => CRITICAL.indexOf(a.severity) - CRITICAL.indexOf(b.severity)), MAX_REQUEST_LENGTH);
  if (left) log(`${label}: ${left} critical bug(s) didn't fit in the request`);
  const fix = await runGeneratorInSandbox({ step: 'build', idea, design, change: { request, source, design, plan: null } }, { onStep: () => {} });
  const { source: fixed, ...rest } = fix;
  await writeFile(path.join(out, 'fix.json'), JSON.stringify({ request, left, ...rest }, null, 2));
  if (!fix.ok || !fixed) return log(`${label}: the fix didn't pass the checks (${fix.error ?? `${fix.attempts?.length} attempt(s)`}), the original is kept`);
  await writeFile(path.join(out, 'game.html'), fixed);
  log(`${label}: fixed in ${fix.attempts.length} attempt(s)`);

  const after = await review(checklist, fixed, `${label} (fixed)`);
  if (after) await writeFile(path.join(out, 'after.json'), JSON.stringify(after, null, 2));
}

/** Lines added and removed between two files (git's own diff; it needn't be a repo). */
function changedLines(a, b) {
  try {
    execFileSync('git', ['diff', '--no-index', '--numstat', a, b], { encoding: 'utf8' });
    return '0';
  } catch (err) {
    const [added, removed] = String(err.stdout).trim().split(/\s+/);
    return `+${added} −${removed}`;
  }
}

async function summary(folder) {
  const read = async (file) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null);
  const crit = (r) => (r ? r.bugs.filter((b) => CRITICAL.includes(b.severity)).length : '–');
  const pts = (r) => (r ? `${score(r.items).points}/${r.items.length}` : '–');
  const rows = [];
  const details = [];
  for (const build of (await readdir(folder)).sort()) {
    const out = path.join(folder, build, 'reviewfix');
    const before = await read(path.join(out, 'before.json'));
    if (!before) continue;
    const fix = await read(path.join(out, 'fix.json'));
    const after = await read(path.join(out, 'after.json'));
    const passed = !fix ? 'not needed' : fix.ok ? `passed (${fix.attempts.length} attempt(s))` : 'failed, original kept';
    const diff = fix?.ok ? changedLines(path.join(folder, build, 'game.html'), path.join(out, 'game.html')) : '–';
    rows.push(`| ${build} | ${crit(before)} | ${passed} | ${diff} | ${crit(after)} | ${pts(before)} → ${pts(after)} |`);
    if (!fix) continue;
    details.push(`## ${build}`, '', 'Asked to fix:', '', ...before.bugs.filter((b) => CRITICAL.includes(b.severity)).map((b) => `- ${b.severity}: ${b.what}`), '');
    if (fix.changelog) details.push('The builder says it changed:', '', fix.changelog.trim(), '');
    if (after) details.push('Critical bugs the second review sees:', '', ...(after.bugs.filter((b) => CRITICAL.includes(b.severity)).map((b) => `- ${b.severity}: ${b.what}`).concat(crit(after) ? [] : ['- none'])), '');
  }
  return [
    `# Review and fix: ${path.basename(folder)}`,
    '',
    'Critical = crash or stuck. The score is the design checklist (implemented 1, partial ½).',
    '',
    '| Build | Critical before | Fix | Lines changed | Critical after | Score before → after |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    ...details,
  ].join('\n');
}
