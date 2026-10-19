// `npm run review-builds -- <folder> [<folder> …] [--again] [--only <build>]`
//
// The reviewer (plan §47): scores how much of its design each game in a compare-builds folder
// (generator/out/<name>/) actually does. For each folder it makes the design's checklist once
// (checklist.json, from design.md; edit it by hand if an item is wrong, and it's kept), then
// reviews every build's game.html against it (review.json in the build's folder), and writes
// review.md: a table of every build's score, by area, with the bugs the reviewer saw.
//
// The reviewer is a model, so its claims are checked: an item marked implemented, partial or
// wrong must cite lines that exist and mention something from the item; if not, it's counted
// as "unverified" (and as 0 in the score).
//
// --again reviews builds that already have a review.json; --only reviews just that build.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runGeneratorInSandbox } from '../src/generation/sandbox.js';
import { AREAS } from '../../generator/src/review.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { again: { type: 'boolean', default: false }, only: { type: 'string' } },
});
const cwd = process.env.INIT_CWD || process.cwd(); // npm runs scripts from the repo root
if (positionals.length === 0) {
  console.error('Usage: npm run review-builds -- <folder> [<folder> …] [--again] [--only <build>]');
  process.exit(2);
}
const log = (text) => console.log(`${new Date().toLocaleTimeString()}  ${text}`);
const IDEA = 'Review a built party game against its design.'; // jobs need an idea; the reviewer doesn't use it

for (const folder of positionals.map((p) => path.resolve(cwd, p))) {
  const name = path.basename(folder);
  const design = await readFile(path.join(folder, 'design.md'), 'utf8').catch(() => null);
  if (!design) {
    console.error(`${name}: no design.md, skipped`);
    continue;
  }

  // The checklist: made once per design, then reused (and editable by hand).
  const checklistFile = path.join(folder, 'checklist.json');
  let checklist;
  if (existsSync(checklistFile)) {
    checklist = JSON.parse(await readFile(checklistFile, 'utf8'));
  } else {
    log(`${name}: making the checklist`);
    const made = await runGeneratorInSandbox({ step: 'checklist', idea: IDEA, design }, { onStep: () => {} });
    if (!made.ok) {
      console.error(`${name}: no checklist (${made.error})`);
      continue;
    }
    checklist = made.checklist;
    await writeFile(checklistFile, JSON.stringify(checklist, null, 2));
    log(`${name}: ${checklist.length} checklist items`);
  }

  // Every build with a game, reviewed side by side.
  const builds = (await readdir(folder, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && existsSync(path.join(folder, d.name, 'game.html')))
    .map((d) => d.name)
    .filter((b) => !values.only || b === values.only)
    .filter((b) => values.again || !existsSync(path.join(folder, b, 'review.json')));
  await Promise.all(
    builds.map(async (build) => {
      const source = await readFile(path.join(folder, build, 'game.html'), 'utf8');
      log(`${name}/${build}: reviewing`);
      const res = await runGeneratorInSandbox({ step: 'review', idea: IDEA, checklist, source }, { onStep: () => {} });
      if (!res.ok) return log(`${name}/${build}: no review (${res.error})`);
      const review = { ...res.review, items: verify(checklist, res.review.items, source), usage: res.usage, seconds: res.seconds };
      await writeFile(path.join(folder, build, 'review.json'), JSON.stringify(review, null, 2));
      const s = score(review.items);
      log(`${name}/${build}: ${s.points}/${s.of} (${s.unverified} unverified), ${review.bugs.length} bug(s), ${res.seconds} s`);
    }),
  );
  await writeFile(path.join(folder, 'review.md'), await summary(folder, name, checklist));
  console.log(`\n${await summary(folder, name, checklist)}`);
}

/** Words worth looking for: lower case, 4+ letters, from the item and the reviewer's note. */
function keywords(text) {
  const stop = new Set(['with', 'when', 'each', 'that', 'this', 'from', 'their', 'shows', 'show', 'every', 'after', 'into', 'than', 'then', 'they', 'have', 'there']);
  return [...new Set(String(text).toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !stop.has(w));
}

/**
 * Checks each claim against the code: the lines must exist, and some word from the item or the
 * note (or a camelCase part of one) must appear on or near them. Adds `verified` to each item.
 */
export function verify(checklist, items, source) {
  const code = source.split('\n');
  const near = (lines) =>
    lines
      .flatMap((n) => code.slice(Math.max(0, n - 3), n + 2))
      .join('\n')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase();
  return checklist.map((it) => {
    const got = items.find((x) => x.id === it.id) ?? { id: it.id, status: 'missing', lines: [], note: '(the reviewer skipped it)' };
    if (got.status === 'missing') return { ...got, area: it.area, text: it.text, verified: true };
    const lines = (got.lines ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= code.length);
    const text = near(lines);
    const verified = lines.length > 0 && keywords(`${it.text} ${got.note}`).some((w) => text.includes(w.slice(0, 6)));
    return { ...got, area: it.area, text: it.text, verified };
  });
}

/** implemented 1, partial ½ (only when verified). */
function score(items, area) {
  const of = items.filter((i) => !area || i.area === area);
  const points = of.reduce((n, i) => n + (!i.verified ? 0 : i.status === 'implemented' ? 1 : i.status === 'partial' ? 0.5 : 0), 0);
  return { points, of: of.length, unverified: of.filter((i) => !i.verified).length };
}

async function summary(folder, name, checklist) {
  const rows = [];
  for (const build of (await readdir(folder)).sort()) {
    const file = path.join(folder, build, 'review.json');
    if (!existsSync(file)) continue;
    const r = JSON.parse(await readFile(file, 'utf8'));
    rows.push({ build, r, total: score(r.items) });
  }
  const pct = (s) => (s.of ? `${Math.round((100 * s.points) / s.of)}%` : '–');
  const lines = [
    `# Review: ${name}`,
    '',
    `${checklist.length} checklist items (checklist.json). implemented = 1, partial = ½, unverified = 0.`,
    '',
    `| Build | Score | ${AREAS.join(' | ')} | Unverified | Bugs |`,
    `|---|---|${AREAS.map(() => '---').join('|')}|---|---|`,
    ...rows.map(({ build, r, total }) => `| ${build} | ${total.points}/${total.of} (${pct(total)}) | ${AREAS.map((a) => pct(score(r.items, a))).join(' | ')} | ${total.unverified} | ${r.bugs.length} |`),
    '',
  ];
  for (const { build, r } of rows) {
    if (r.bugs.length + r.deadCode.length === 0) continue;
    lines.push(`## ${build}`, '');
    for (const b of r.bugs) lines.push(`- bug (lines ${b.lines.join(', ') || '?'}): ${b.what}`);
    for (const d of r.deadCode) lines.push(`- dead code (lines ${d.lines.join(', ') || '?'}): ${d.what}`);
    lines.push('');
  }
  return lines.join('\n');
}
