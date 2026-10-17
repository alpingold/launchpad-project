import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Claim Jumpers' rules (server/src/games/claim-jumpers/game.html): the board's pure rule
// functions, run here without a browser. The browser test (e2e/tests/claim-jumpers.spec.js)
// plays claims and a clash; jumps and safe camps are hard to reach there, so they're tested here.

const source = readFileSync(new URL('../../src/games/claim-jumpers/game.html', import.meta.url), 'utf8');
const start = source.indexOf('// ---- Shared: the rules');
const end = source.indexOf('// ---- Shared: drawing');
const rules = vm.runInNewContext(`${source.slice(start, end)}\n({ movesFor, resolve, ring, goldFor, pointsOf, standings, sizeFor })`);
/** Results made in the vm have its own Array/Object, so compare them as plain JSON. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const S = 6;
const at = (r, c) => r * S + c;
/** A 6 × 6 board: player 0's camp at (1,1), player 1's at (4,4), gold at (2,3) and (3,2). */
function board(owned = {}) {
  const cells = Array(S * S).fill(-1);
  cells[at(1, 1)] = 0;
  cells[at(4, 4)] = 1;
  for (const [sq, p] of Object.entries(owned)) cells[Number(sq)] = p;
  return { size: S, cells, camps: [at(1, 1), at(4, 4)], gold: [at(2, 3), at(3, 2)] };
}

test('at the start, a player may claim exactly the empty squares next to their camp', () => {
  assert.deepEqual(plain(rules.movesFor(board(), 0)), { [at(0, 1)]: 'claim', [at(1, 0)]: 'claim', [at(1, 2)]: 'claim', [at(2, 1)]: 'claim' });
});

test('a rival square touching yours on 2 sides can be jumped; on 1 side it cannot', () => {
  const b = board({ [at(1, 2)]: 0, [at(2, 1)]: 0, [at(2, 2)]: 1, [at(1, 3)]: 1 });
  const moves = rules.movesFor(b, 0);
  assert.equal(moves[at(2, 2)], 'jump'); // touched from (1,2) and (2,1)
  assert.equal(moves[at(1, 3)], undefined); // touched only from (1,2)
});

test("a camp can never be jumped, even when it's surrounded", () => {
  const b = board({ [at(3, 4)]: 0, [at(4, 3)]: 0, [at(4, 5)]: 0, [at(5, 4)]: 0 });
  assert.equal(rules.movesFor(b, 0)[at(4, 4)], undefined);
});

test('the reveal: one picker gets the square (claim or jump); two on one square clash and nobody gets it', () => {
  const b = board({ [at(1, 2)]: 0, [at(2, 1)]: 0, [at(2, 2)]: 1, [at(3, 4)]: 1 });
  const { cells, claims, clashes } = rules.resolve(b, { 0: at(2, 2), 1: at(2, 4) });
  assert.equal(cells[at(2, 2)], 0, 'player 0 jumped it');
  assert.equal(cells[at(2, 4)], 1, 'player 1 claimed it');
  assert.deepEqual(plain(claims.sort((x, y) => x[0] - y[0])), [[at(2, 2), 0, 1], [at(2, 4), 1, -1]]);
  assert.deepEqual(plain(clashes), []);

  const clash = rules.resolve(board({ [at(1, 2)]: 0, [at(3, 3)]: 1 }), { 0: at(2, 3), 1: at(2, 3) });
  assert.deepEqual(plain(clash.clashes), [[at(2, 3), [0, 1]]]);
  assert.equal(clash.cells[at(2, 3)], -1, 'nobody got it');
});

test('points: 1 per square, 3 for gold; ties go to more gold', () => {
  const b = board({ [at(2, 3)]: 0, [at(4, 3)]: 1, [at(4, 2)]: 1 });
  assert.equal(rules.pointsOf(b, 0), 4); // camp + a gold square
  assert.equal(rules.pointsOf(b, 1), 3);
  assert.deepEqual(plain(rules.standings(b, 2)), [0, 1]);
  const tied = board({ [at(2, 3)]: 0, [at(4, 3)]: 1, [at(4, 2)]: 1, [at(5, 4)]: 1 }); // 4 points each
  assert.deepEqual(plain(rules.standings(tied, 2)), [0, 1], 'player 0 has the gold');
});

test('board sizes and gold: no gold on a camp ring, for 2 to 6 players', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const size = rules.sizeFor(n);
    const ring = rules.ring(size);
    const gold = rules.goldFor(size);
    assert.equal(new Set(ring).size, ring.length);
    assert.ok(ring.length >= n);
    assert.ok(gold.every((g) => !ring.includes(g)), `${n} players: gold stays off the camp ring`);
  }
});
