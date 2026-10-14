import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRunner } from '../../src/games/GameRunner.js';
import { validateGameModule } from '../../src/games/contract.js';
import reactionRace from '../../src/games/reaction-race/index.js';
import { knownAssetIds, assetIdsIn } from '../helpers/assets.js';
import { find, texts, headline, blocksOf } from '../helpers/screens.js';

const PLAYERS = [
  { id: 'p_aaaa1111', name: 'Alex' },
  { id: 'p_bbbb2222', name: 'Blake' },
  { id: 'p_cccc3333', name: 'Casey' },
];
const [ALEX, BLAKE, CASEY] = PLAYERS.map((p) => p.id);

/**
 * Runs Reaction Race through the real GameRunner with mock time (timers AND ctx.now(), so
 * the platform's "arrived before GO" check sees the same clock).
 */
function play(t, { rounds, seed = 1, players = PLAYERS } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 1_000_000;
  const delivered = [];
  const ended = [];
  const runner = new GameRunner({
    game: reactionRace,
    players,
    options: rounds === undefined ? {} : { rounds },
    seed,
    now: () => clock,
    deliver: (target, screen) => delivered.push({ target, screen }),
    onEnd: (results) => ended.push(results),
  });
  runner.start();

  /** The latest screen sent to the host or to one player (broadcasts count for both). */
  function latest(who) {
    for (let i = delivered.length - 1; i >= 0; i--) {
      const { target, screen } = delivered[i];
      if (target.to === 'all') return screen;
      if (who === 'host' && target.to === 'host') return screen;
      if (target.to === 'player' && target.playerId === who) return screen;
    }
    return undefined;
  }
  const tick = (ms) => {
    clock += ms;
    t.mock.timers.tick(ms);
  };
  /** Moves time forward in small steps until `check()` is true. */
  function tickUntil(check, maxMs = 30_000) {
    for (let waited = 0; !check(); waited += 50) {
      if (waited > maxMs) throw new Error('condition never became true');
      tick(50);
    }
  }
  const head = (who) => headline(latest(who));
  /** "Round 2 of 5": the first line of the host's in-round screens. */
  const roundLine = () => texts(latest('host'))[0];
  const isGo = () => head('host') === 'GO!';
  /** What a phone's reaction widget sends: a time in ms, or 'early'. */
  const tap = (playerId, round, result) =>
    runner.handleAction(playerId, { tap: true, round }, result === 'early' ? { early: true } : { ms: result });

  return { runner, delivered, ended, latest, head, roundLine, tick, tickUntil, isGo, tap, now: () => clock };
}

test('follows the game contract', () => {
  assert.deepEqual(validateGameModule(reactionRace), []);
});

test('a round starts with "get ready" on the host and a reaction widget on phones', (t) => {
  const { latest, now } = play(t);
  assert.deepEqual(texts(latest('host')), ['Round 1 of 5', 'Get ready…', 'Wait for GO!']);
  const widget = find(latest(ALEX), 'reaction');
  assert.deepEqual(widget.action, { tap: true, round: 1 });
  const delay = widget.goAt - now();
  assert.ok(delay >= 2000 && delay <= 5000, `GO in 2–5 s (got ${delay} ms)`);
  assert.deepEqual(latest(BLAKE), latest(ALEX), 'everyone gets the same GO time');
});

test('GO comes after a random 2–5 seconds, different for different seeds', (t) => {
  const goTimes = new Set();
  for (const seed of [1, 2, 3, 4, 5]) {
    const game = play(t, { seed });
    goTimes.add(find(game.latest(ALEX), 'reaction').goAt);
    game.tick(1950);
    assert.equal(game.isGo(), false, 'never before 2 s');
    game.tickUntil(game.isGo);
    t.mock.timers.reset();
  }
  assert.ok(goTimes.size > 1, 'GO time is random');
});

test('at GO only the big screen changes: phones keep their widget (re-sending would restart it)', (t) => {
  const { delivered, tickUntil, isGo, latest } = play(t);
  const before = delivered.length;
  tickUntil(isGo);
  assert.deepEqual(
    delivered.slice(before).map((d) => d.target.to),
    ['host'],
  );
  assert.equal(find(latest('host'), 'image').asset, 'go-sign');
});

test('the fastest time wins, whoever arrives first; everyone sees all the times', (t) => {
  const { latest, head, tickUntil, isGo, tap } = play(t);
  tickUntil(isGo);
  tap(CASEY, 1, 400); // arrives first, but slower
  assert.equal(head(CASEY), '400 ms');
  assert.ok(texts(latest(CASEY)).includes('Waiting for the others…'));
  assert.equal(find(latest('host'), 'progress').label, '1 of 3 tapped');
  tap(ALEX, 1, 310);
  tap(BLAKE, 1, 215);
  assert.equal(head('host'), 'Blake wins round 1!');
  assert.deepEqual(
    find(latest('host'), 'card').children.map((row) => texts({ blocks: row.children })[0]),
    ['215 ms', '310 ms', '400 ms'],
    'fastest first',
  );
  assert.equal(head(BLAKE), 'You won this round!');
  assert.equal(head(ALEX), 'Blake was fastest!');
  assert.ok(texts(latest(ALEX)).includes('Your time: 310 ms'));
});

test('tapping before GO is a false start: no time this round', (t) => {
  const { latest, head, tickUntil, isGo, tap } = play(t);
  tap(ALEX, 1, 'early');
  assert.equal(head(ALEX), 'Too soon!');
  assert.ok(find(latest(BLAKE), 'reaction'), 'others unaffected');
  tickUntil(isGo);
  tap(ALEX, 1, 150); // a second result this round is ignored
  tap(BLAKE, 1, 300);
  tap(CASEY, 1, 350);
  assert.equal(head('host'), 'Blake wins round 1!');
  assert.ok(texts(latest(ALEX)).includes('Your time: too soon!'));
});

test('a "reaction time" that arrives before GO is impossible, so the platform drops it', (t) => {
  const { head, tap } = play(t);
  tap(ALEX, 1, 250); // GO is still seconds away on the server's clock
  assert.equal(head(ALEX), undefined, 'still the widget, no result');
  assert.equal(head('host'), 'Get ready…');
});

test('if everyone false-starts, the round ends right away with no winner', (t) => {
  const { head, roundLine, tick, tap } = play(t);
  tap(ALEX, 1, 'early');
  tap(BLAKE, 1, 'early');
  assert.equal(head('host'), 'Get ready…', 'Casey can still play: keep going');
  tap(CASEY, 1, 'early');
  assert.equal(head('host'), 'Nobody got a time!');
  tick(4000);
  assert.equal(roundLine(), 'Round 2 of 5', 'next round after the result pause');
});

test('disconnected players are not waited for', (t) => {
  const { runner, head, tickUntil, isGo, tap } = play(t);
  runner.playerDisconnected(CASEY);
  tickUntil(isGo);
  tap(ALEX, 1, 300);
  tap(BLAKE, 1, 250);
  assert.equal(head('host'), 'Blake wins round 1!');
});

test('the round also ends when the last player it was waiting for disconnects', (t) => {
  const { runner, head, tickUntil, isGo, tap } = play(t);
  tickUntil(isGo);
  tap(ALEX, 1, 300);
  tap(BLAKE, 1, 250);
  runner.playerDisconnected(CASEY);
  assert.equal(head('host'), 'Blake wins round 1!');
});

test("results for another round, or that aren't valid, are ignored", (t) => {
  const { runner, head, tickUntil, isGo } = play(t);
  tickUntil(isGo);
  runner.handleAction(ALEX, { tap: true, round: 2 }, { ms: 200 });
  runner.handleAction(ALEX, { tap: true, round: 1 }, { ms: 20 }); // faster than possible
  runner.handleAction(ALEX, { tap: true, round: 1 }); // no result
  runner.handleAction(ALEX, { tap: true, round: 1 }, { ms: 200, extra: 1 });
  assert.equal(head('host'), 'GO!');
  assert.equal(head(ALEX), undefined, 'Alex still has the widget');
});

test('if not everyone taps within 5 s of GO, the round ends with whoever did', (t) => {
  const { head, tick, tickUntil, isGo, tap } = play(t);
  tickUntil(isGo);
  tap(ALEX, 1, 500);
  tick(4950);
  assert.equal(head('host'), 'GO!');
  tick(100);
  assert.equal(head('host'), 'Alex wins round 1!');
});

test('a full 5-round game: final scoreboard, then endGame with rankings', (t) => {
  const { latest, ended, roundLine, tickUntil, tick, isGo, tap } = play(t);
  const winners = [ALEX, BLAKE, ALEX, ALEX, BLAKE];
  for (const [i, winner] of winners.entries()) {
    const round = i + 1;
    tickUntil(() => roundLine() === `Round ${round} of 5`);
    tickUntil(isGo);
    for (const p of PLAYERS) tap(p.id, round, p.id === winner ? 200 : 400);
  }
  tickUntil(() => find(latest('host'), 'scoreboard'));
  assert.deepEqual(find(latest(CASEY), 'scoreboard').rows, [
    { playerId: ALEX, score: 3 },
    { playerId: BLAKE, score: 2 },
    { playerId: CASEY, score: 0 },
  ]);
  assert.deepEqual(ended, [], 'scoreboard stays up for a moment');
  tick(6000);
  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE, CASEY], scores: { [ALEX]: 3, [BLAKE]: 2, [CASEY]: 0 } }]);
});

test('options.rounds sets the number of rounds; bad values fall back to 5', (t) => {
  assert.equal(play(t, { rounds: 1 }).roundLine(), 'Round 1 of 1');
  t.mock.timers.reset();
  assert.equal(play(t, { rounds: 99 }).roundLine(), 'Round 1 of 5');
});

test('a refreshed phone or host screen gets its current screen again', (t) => {
  const { runner, delivered, tickUntil, isGo, tap } = play(t);
  tap(ALEX, 1, 'early');
  tickUntil(isGo);
  delivered.length = 0;
  runner.playerReconnected(ALEX);
  runner.playerReconnected(BLAKE);
  runner.hostReconnected();
  assert.deepEqual(
    delivered.map((d) => [d.target.playerId ?? d.target.to, headline(d.screen) ?? blocksOf(d.screen)[1].type]),
    [
      [ALEX, 'Too soon!'],
      [BLAKE, 'reaction'],
      ['host', 'GO!'],
    ],
  );
});

test('works with a single player', (t) => {
  const { ended, latest, tickUntil, tick, isGo, tap } = play(t, { rounds: 1, players: [PLAYERS[0]] });
  tickUntil(isGo);
  tap(ALEX, 1, 300);
  tickUntil(() => find(latest('host'), 'scoreboard'));
  tick(6000);
  assert.deepEqual(ended, [{ rankings: [ALEX], scores: { [ALEX]: 1 } }]);
});

// A small "simulated players" check (plan §5, E4): many games with random results must
// always finish cleanly, and every screen must use art that exists in the library.
test('simulated games with random results always end cleanly and only use known art', (t) => {
  const known = knownAssetIds();
  for (let seed = 1; seed <= 25; seed++) {
    const game = play(t, { seed, rounds: 3 });
    const rng = (() => {
      let x = seed * 7919;
      return () => ((x = (x * 48271) % 2147483647) / 2147483647);
    })();
    let guard = 0;
    while (game.ended.length === 0) {
      if (guard++ > 2000) throw new Error(`seed ${seed}: game never ended`);
      game.tick(50);
      for (const p of PLAYERS) {
        if (rng() < 0.05) game.tap(p.id, 1 + Math.floor(rng() * 3), rng() < 0.2 ? 'early' : 100 + Math.floor(rng() * 900));
      }
    }
    assert.equal(game.ended[0].error, undefined, `seed ${seed} ended with an error`);
    assert.equal(game.ended[0].rankings.length, 3);
    for (const id of assetIdsIn(game.delivered.map((d) => d.screen))) {
      assert.ok(known.has(id), `seed ${seed}: unknown asset id "${id}"`);
    }
    t.mock.timers.reset();
  }
});
