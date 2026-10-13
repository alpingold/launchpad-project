import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintGameSource, stripCommentsAndStrings, MAX_SOURCE_BYTES } from '../../src/games/harness/lint.js';
import { VirtualClock, simulateGame, SCENARIOS } from '../../src/games/harness/simulate.js';
import { checkGameSource, loadAssetIds, playerCountsFor, formatReport } from '../../src/games/harness/check.js';
import { checkGameFile } from '../../src/games/harness/index.js';
import reactionRace from '../../src/games/reaction-race/index.js';

// The game test harness (plan §11c, A2). Broken example games live in fixtures/harness/.

const file = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const REACTION_RACE = file('../../src/games/reaction-race/index.js');
const fixture = (name) => file(`../fixtures/harness/${name}.js`);

// --- Lint ------------------------------------------------------------------------------

test('lint: the real games are clean', () => {
  assert.deepEqual(lintGameSource(readFileSync(REACTION_RACE, 'utf8')), []);
  assert.deepEqual(lintGameSource(readFileSync(file('../fixtures/countGame.js'), 'utf8')), []);
});

test('lint: each rule is caught, with its line number', () => {
  const cases = [
    ["import fs from 'node:fs';", /imports are not allowed/],
    ["const fs = require('fs');", /imports are not allowed/],
    ['const m = import("x");', /imports are not allowed/],
    ['export const x = 1;', /only `export default/],
    ['eval("1");', /eval and Function/],
    ['new Function("return 1");', /eval and Function/],
    ['globalThis.x = 1;', /cannot reach the server/],
    ['process.exit();', /cannot reach the server/],
    ['fetch("https://example.com");', /cannot reach the server/],
    ['({}).constructor.constructor("x");', /constructor/],
    ['async function f() {}', /no async code/],
    ['new Promise(() => {});', /no async code/],
    ['setTimeout(() => {}, 5);', /use ctx.setTimeout/],
    ['setInterval(() => {}, 5);', /use ctx.setTimeout/],
    ['const r = Math.random();', /use ctx.random/],
    ['const r = Math . random();', /use ctx.random/],
    ['const t = Date.now();', /use ctx.now/],
    ['const d = new Date();', /use ctx.now/],
  ];
  for (const [code, pattern] of cases) {
    const problems = lintGameSource(`// first line\n${code}\n`);
    assert.ok(problems.some((p) => p.startsWith('line 2:') && pattern.test(p)), `${code} → ${JSON.stringify(problems)}`);
  }
});

test('lint: allowed code is not flagged', () => {
  const ok = [
    'export default {};',
    'ctx.setTimeout(next, 1000); ctx.clearTimeout(id);',
    'const t = ctx.now(); const r = ctx.random();',
    'const updateDate = 1; const myPromise = 2; obj.process = 3;',
    'const s = "Date.now() and Math.random() in a string";',
    "const s = 'import this';",
    '// Date, async, eval in a comment\n/* setTimeout in a block comment */',
    'const s = `Round ${round}: Date is just text here`;',
  ];
  for (const code of ok) assert.deepEqual(lintGameSource(code), [], code);
});

test('lint: code inside ${...} in a template still counts, even when nested', () => {
  assert.match(lintGameSource('const s = `now: ${Date.now()}`;')[0], /use ctx.now/);
  assert.match(lintGameSource('const s = `a ${`b ${Math.random()} c`} d`;')[0], /use ctx.random/);
  assert.deepEqual(lintGameSource('const s = `a ${ { x: 1 }.x } b ${`Date`}`;'), []);
});

test('lint: stripping keeps every line in place', () => {
  const source = 'a /* x\ny */ b\n"str" `t\n${c}`\n// end';
  const stripped = stripCommentsAndStrings(source);
  assert.equal(stripped.split('\n').length, source.split('\n').length);
  assert.equal(stripped.length, source.length);
});

test('lint: source that is too big is refused', () => {
  const problems = lintGameSource('x'.repeat(MAX_SOURCE_BYTES + 1));
  assert.match(problems[0], /the limit is 64 KB/);
});

// --- The simulator ---------------------------------------------------------------------

test('VirtualClock fires timers in time order (ties in the order they were set)', () => {
  const clock = new VirtualClock();
  const fired = [];
  clock.setTimeout(() => fired.push('b'), 200);
  clock.setTimeout(() => fired.push('a'), 100);
  clock.setTimeout(() => fired.push('c'), 200);
  const cancelled = clock.setTimeout(() => fired.push('x'), 50);
  clock.clearTimeout(cancelled);
  while (clock.pending) clock.takeNext().fn();
  assert.deepEqual(fired, ['a', 'b', 'c']);
  assert.equal(clock.now, 200);
});

test('Reaction Race ends cleanly in every scenario, in no real time', () => {
  const assetIds = loadAssetIds();
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const playerCount of [1, 3, 12]) {
      const run = simulateGame(reactionRace, { playerCount, scenario, seed: 5, assetIds });
      assert.deepEqual(run.problems, [], `${scenario}, ${playerCount} players`);
      assert.ok(run.ended?.rankings, `${scenario}, ${playerCount} players: ended with rankings`);
      assert.ok(run.simulatedSeconds > 10, 'simulated time passes, even though the test is instant');
    }
  }
});

test('the same seed plays the same game', () => {
  const assetIds = loadAssetIds();
  const play = () => simulateGame(reactionRace, { playerCount: 4, scenario: 'sloppy', seed: 9, assetIds });
  const a = play();
  const b = play();
  assert.deepEqual(a.ended, b.ended);
  assert.equal(a.views, b.views);
});

test('player counts tried: smallest, a typical 3, and largest', () => {
  assert.deepEqual(playerCountsFor({ minPlayers: 1, maxPlayers: 12 }), [1, 3, 12]);
  assert.deepEqual(playerCountsFor({ minPlayers: 4, maxPlayers: 8 }), [4, 8]);
  assert.deepEqual(playerCountsFor({ minPlayers: 2, maxPlayers: 2 }), [2]);
});

test('checkGameSource: Reaction Race passes every check (18 simulated games)', async () => {
  const report = await checkGameSource(readFileSync(REACTION_RACE, 'utf8'));
  assert.deepEqual(report.problems, []);
  assert.equal(report.ok, true);
  assert.equal(report.runs.length, 18);
  assert.match(formatReport(report, 'reaction-race'), /^PASS {2}reaction-race: .*18 simulated games/);
});

// --- Broken games, checked in a separate locked-down process (as generated games will be) ---

const BROKEN = [
  ['bad-view', /^Broke the game contract in createGame: .*unknown field "lable" \(bad-view\.js line \d+\)/],
  ['throws', /^Crashed in onAction: TypeError: .*'<playerId>'.* \(throws\.js line 13\)/],
  ['stuck', /^Got stuck: .*ctx\.setTimeout fallback/],
  ['never-ends', /^Didn't finish within 30 simulated minutes/],
  ['unknown-asset', /^Uses art "dragon", which isn't in the art library\. Use only these asset ids: go-sign, trophy/],
  ['silent', /^The host screen never got a view/],
  ['silent', /^No player ever got a view/],
  ['flood', /^Sends too many views at once: 101/],
  ['slow', /^Too slow: one action or timer took \d+ ms/],
  ['lint-errors', /^Lint, line 11: use ctx\.random\(\)/],
  ['lint-errors', /^Lint, line 12: use ctx\.now\(\)/],
  ['lint-errors', /^Lint, line 14: no async code/],
  ['no-version', /^The GameModule is invalid: contractVersion must be 2/],
  ['syntax-error', /^Could not load the game: SyntaxError/],
  ['memory-hog', /^Ran out of memory while playing/],
];

for (const [name, pattern] of BROKEN) {
  test(`harness catches ${name}: ${pattern.source.slice(1, 45)}…`, async () => {
    const report = await checkGameFile(fixture(name));
    assert.equal(report.ok, false);
    assert.ok(
      report.problems.some((p) => pattern.test(p.message)),
      `expected ${pattern}, got:\n${formatReport(report, name)}`,
    );
  });
}

test('the same bug in many runs is reported once, with how many runs hit it', async () => {
  const report = await checkGameFile(fixture('bad-view'));
  assert.equal(report.problems.length, 1);
  assert.equal(report.problems[0].runs, 18);
  assert.match(report.problems[0].where, /1 player, scenario "eager"/);
});

test('an infinite loop is reported as hung instead of freezing the caller', async () => {
  const started = Date.now();
  const report = await checkGameFile(fixture('infinite-loop'), { timeoutMs: 2000 });
  assert.ok(Date.now() - started < 10_000);
  assert.match(report.problems[0].message, /^Hung: still running after 2 s, while playing: 1 player.*infinite loop/);
});

test('the checking process cannot read files on the machine (Node permission model)', async () => {
  const report = await checkGameFile(fixture('sneaky-fs'));
  const messages = report.problems.map((p) => p.message);
  assert.ok(messages.some((m) => /^Lint, line \d+: games cannot reach/.test(m)), messages.join('\n'));
  assert.ok(messages.some((m) => /^Crashed in createGame: Error: Access to this API has been restricted/.test(m)), messages.join('\n'));
});

test('npm run check-game: exit code 0 for a passing game, 1 for a failing one, --json for machines', () => {
  const cli = file('../../src/games/harness/cli.js');
  const pass = spawnSync(process.execPath, [cli, REACTION_RACE], { encoding: 'utf8' });
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /^PASS/);

  const fail = spawnSync(process.execPath, [cli, fixture('bad-view'), '--json'], { encoding: 'utf8' });
  assert.equal(fail.status, 1);
  assert.equal(JSON.parse(fail.stdout).ok, false);
});
