import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Claim Jumpers' rules (server/src/games/claim-jumpers/game.html, plan §36c): the pure rule
// functions, run here without a browser. The browser test (e2e/tests/claim-jumpers.spec.js)
// plays a claim jump, a split and dynamite; the edge cases are tested here.

const source = readFileSync(new URL('../../src/games/claim-jumpers/game.html', import.meta.url), 'utf8');
const start = source.indexOf('// ---- Shared: the rules');
const end = source.indexOf('// ---- Shared: drawing');
const rules = vm.runInNewContext(`${source.slice(start, end)}\n({ makeClaims, crewSizes, checkPlan, resolveRound, standings, ROUNDS, CREW })`);
/** Results made in the vm have its own Array/Object, so compare them as plain JSON. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const claims = (...values) => values.map((value) => ({ value, mystery: false }));
const plan = (crew, tnt = null) => ({ crew, tnt });

test('a round has players + 1 claims worth 1–5, one of them a "?" worth 0–8; the Mother Lode doubles them', () => {
  for (let k = 0; k < 50; k++) {
    for (const n of [2, 4, 6]) {
      const round = rules.makeClaims(n, 1);
      assert.equal(round.length, n + 1);
      assert.equal(round.filter((c) => c.mystery).length, 1);
      for (const c of round) assert.ok(c.mystery ? c.value >= 0 && c.value <= 8 : c.value >= 1 && c.value <= 5);
    }
  }
  // Claims worth 5 and 3, then the "?" goes first (0.2 × 3 claims → place 0), worth 2 (0.25 × 9).
  const values = [0.99, 0.5, 0.2, 0.25];
  const lode = rules.makeClaims(2, rules.ROUNDS, () => values.shift());
  assert.deepEqual(plain(lode), [{ value: 4, mystery: true }, { value: 10, mystery: false }, { value: 6, mystery: false }]);
});

test('the biggest crew takes the gold; a tie for biggest is a claim jump and nobody gets it', () => {
  const { results, gains } = rules.resolveRound(claims(3, 4, 5), [plan([3, 2, 0]), plan([2, 2, 1]), plan([0, 1, 4])], 3);
  assert.equal(results[0].winner, 0); // 3 beats 2
  assert.equal(results[1].winner, -1); // 2 and 2 tie for biggest (the 1 doesn't matter)
  assert.deepEqual(plain(results[1].jumped), [0, 1]);
  assert.equal(results[2].winner, 2);
  assert.deepEqual(plain(gains), [3, 0, 5]);
  assert.deepEqual(plain(results[0].crews), [[0, 3], [1, 2]], 'crews, biggest first');
});

test('dynamite: nobody gets that claim, however big the crew; a claim nobody visits stays empty', () => {
  const { results, gains } = rules.resolveRound(claims(5, 2), [plan([0, 0], 0), plan([5, 0])], 2);
  assert.equal(results[0].winner, -1);
  assert.deepEqual(plain(results[0].boom), [0]);
  assert.deepEqual(plain(results[0].jumped), []);
  assert.equal(results[1].winner, -1);
  assert.deepEqual(plain(results[1].crews), []);
  assert.deepEqual(plain(gains), [0, 0]);
});

test('a player who sent no plan just sits out', () => {
  const { results, gains } = rules.resolveRound(claims(4), [null, plan([1])], 2);
  assert.equal(results[0].winner, 1);
  assert.deepEqual(plain(gains), [0, 4]);
});

test('plans: at most your crew, whole numbers, dynamite only once and never under your own crew', () => {
  assert.deepEqual(plain(rules.checkPlan(plan([2, 3, 0]), 3, 5, true)), { crew: [2, 3, 0], tnt: null });
  assert.equal(rules.checkPlan(plan([3, 3, 0]), 3, 5, true), null, '6 prospectors, only 5');
  assert.deepEqual(plain(rules.checkPlan(plan([3, 3, 0]), 3, 6, true)), { crew: [3, 3, 0], tnt: null }, 'last place has 6');
  assert.equal(rules.checkPlan(plan([1, -1, 0]), 3, 5, true), null);
  assert.equal(rules.checkPlan(plan([1.5, 0, 0]), 3, 5, true), null);
  assert.equal(rules.checkPlan(plan([1, 1]), 3, 5, true), null, 'one count per claim');
  assert.equal(rules.checkPlan(plan([0, 0, 0], 2), 3, 5, false), null, 'dynamite already used');
  assert.equal(rules.checkPlan(plan([0, 0, 1], 2), 3, 5, true), null, 'dynamite under your own crew');
  assert.equal(rules.checkPlan(plan([0, 0, 0], 3), 3, 5, true), null, 'no such claim');
  assert.deepEqual(plain(rules.checkPlan(plan([5, 0, 0], 2), 3, 5, true)), { crew: [5, 0, 0], tnt: 2 });
  assert.equal(rules.checkPlan('5 on A', 3, 5, true), null);
});

test('catch-up: last place gets one more prospector, but not when everyone is tied', () => {
  assert.deepEqual(plain(rules.crewSizes([0, 0, 0])), [5, 5, 5]);
  assert.deepEqual(plain(rules.crewSizes([4, 0, 7])), [5, 6, 5]);
  assert.deepEqual(plain(rules.crewSizes([2, 2, 9])), [6, 6, 5]);
});

test('standings: most gold first, then most claims won, then seat', () => {
  assert.deepEqual(plain(rules.standings([5, 9, 5], [1, 2, 3])), [1, 2, 0]);
  assert.deepEqual(plain(rules.standings([4, 4], [2, 2])), [0, 1]);
});
