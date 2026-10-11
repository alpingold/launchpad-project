import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRunner } from '../../src/games/GameRunner.js';
import { validateGameModule } from '../../src/games/contract.js';
import reactionRace from '../../src/games/reaction-race/index.js';
import { knownAssetIds, assetIdsIn } from '../helpers/assets.js';

const PLAYERS = [
  { id: 'p_aaaa1111', name: 'Alex' },
  { id: 'p_bbbb2222', name: 'Blake' },
  { id: 'p_cccc3333', name: 'Casey' },
];
const [ALEX, BLAKE, CASEY] = PLAYERS.map((p) => p.id);

/**
 * Runs Reaction Race through the real GameRunner with mock time.
 * Returns helpers to look at the latest view for each screen and to move time forward.
 */
function play(t, { rounds, seed = 1, players = PLAYERS } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const delivered = [];
  const ended = [];
  const runner = new GameRunner({
    game: reactionRace,
    players,
    options: rounds === undefined ? {} : { rounds },
    seed,
    deliver: (target, view) => delivered.push({ target, view }),
    onEnd: (results) => ended.push(results),
  });
  runner.start();

  /** The latest view sent to the host or to one player (broadcasts count for both). */
  function latest(who) {
    for (let i = delivered.length - 1; i >= 0; i--) {
      const { target, view } = delivered[i];
      if (target.to === 'all') return view;
      if (who === 'host' && target.to === 'host') return view;
      if (target.to === 'player' && target.playerId === who) return view;
    }
    return undefined;
  }

  let elapsed = 0;
  function tick(ms) {
    t.mock.timers.tick(ms);
    elapsed += ms;
  }
  /** Moves time forward in small steps until `check()` is true; returns how long that took. */
  function tickUntil(check, maxMs = 30_000) {
    const start = elapsed;
    while (!check()) {
      if (elapsed - start > maxMs) throw new Error('condition never became true');
      tick(50);
    }
    return elapsed - start;
  }
  const isGo = () => latest('host')?.title === 'GO!';
  const tap = (playerId, round) => runner.handleAction(playerId, { tap: true, round });

  return { runner, delivered, ended, latest, tick, tickUntil, isGo, tap };
}

test('follows the game contract', () => {
  assert.deepEqual(validateGameModule(reactionRace), []);
});

test('round 1 starts with "get ready" on the host and a waiting button on phones', (t) => {
  const { latest } = play(t);
  assert.deepEqual(latest('host'), { view: 'message', title: 'Round 1 of 5', text: 'Get ready… wait for GO!' });
  assert.deepEqual(latest(ALEX), { view: 'button', label: 'Wait for it…', action: { tap: true, round: 1 } });
});

test('GO comes after a random 2–5 seconds, different for different seeds', (t) => {
  const delays = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const game = play(t, { seed });
    game.tick(1950);
    assert.equal(game.isGo(), false, 'never before 2 s');
    const delay = 1950 + game.tickUntil(game.isGo);
    assert.ok(delay >= 2000 && delay <= 5050, `delay ${delay}`);
    delays.push(delay);
    t.mock.timers.reset();
  }
  assert.ok(new Set(delays).size > 1, 'not always the same delay');
});

test('at GO, phones get the TAP! button with the go-sign art', (t) => {
  const { latest, tickUntil, isGo } = play(t);
  tickUntil(isGo);
  assert.deepEqual(latest(BLAKE), { view: 'button', label: 'TAP!', action: { tap: true, round: 1 }, asset: 'go-sign' });
  assert.deepEqual(latest('host'), { view: 'message', title: 'GO!', asset: 'go-sign' });
});

test('first tap after GO wins the round; later taps change nothing', (t) => {
  const { latest, tickUntil, isGo, tap } = play(t);
  tickUntil(isGo);
  tap(BLAKE, 1);
  tap(ALEX, 1);

  assert.deepEqual(latest('host'), { view: 'message', title: 'Blake wins round 1!', asset: 'trophy' });
  assert.deepEqual(latest(BLAKE), { view: 'message', title: 'You won this round!', asset: 'trophy' });
  assert.deepEqual(latest(ALEX), { view: 'message', title: 'Blake was fastest!' });
});

test('tapping before GO is a false start: sit out the round', (t) => {
  const { latest, tickUntil, isGo, tap } = play(t);
  tap(ALEX, 1); // too early
  assert.equal(latest(ALEX).title, 'Too soon!');
  assert.equal(latest(BLAKE).label, 'Wait for it…', 'others unaffected');

  tickUntil(isGo);
  assert.equal(latest(ALEX).title, 'Too soon!', 'no TAP! button for a false starter');
  tap(ALEX, 1); // ignored
  assert.equal(latest('host').title, 'GO!');
  tap(CASEY, 1);
  assert.equal(latest('host').title, 'Casey wins round 1!');
});

test('if everyone false-starts, the round ends right away instead of waiting', (t) => {
  const { latest, tick, tap, isGo } = play(t);
  tap(ALEX, 1);
  tap(BLAKE, 1);
  assert.equal(latest('host').title, 'Round 1 of 5', 'Casey can still tap: keep going');
  tap(CASEY, 1);
  assert.deepEqual(latest('host'), { view: 'message', title: 'Everyone tapped too early!' });
  assert.deepEqual(latest(ALEX), { view: 'message', title: 'Everyone tapped too early!' });
  tick(10_000);
  assert.equal(isGo(), false, 'the old GO timer was cancelled');
  assert.equal(latest('host').title, 'Round 2 of 5', 'next round started after the result pause');
});

test('a disconnected player is not waited for when everyone else false-starts', (t) => {
  const { runner, latest, tap } = play(t);
  runner.playerDisconnected(CASEY);
  tap(ALEX, 1);
  tap(BLAKE, 1);
  assert.equal(latest('host').title, 'Everyone tapped too early!');
});

test('the round also ends if the last player who could tap disconnects', (t) => {
  const { runner, latest, tap } = play(t);
  tap(ALEX, 1);
  tap(BLAKE, 1);
  runner.playerDisconnected(CASEY);
  assert.equal(latest('host').title, 'Everyone tapped too early!');
});

test('if everyone disconnects without false-starting, the round keeps waiting', (t) => {
  const { runner, latest } = play(t);
  for (const p of PLAYERS) runner.playerDisconnected(p.id);
  assert.equal(latest('host').title, 'Round 1 of 5');
});

test('taps from another round, or malformed taps, are ignored', (t) => {
  const { runner, latest, tickUntil, isGo } = play(t);
  tickUntil(isGo);
  for (const action of [{ tap: true, round: 2 }, { tap: true, round: 0 }, { tap: true }, { tap: 'yes', round: 1 }, {}]) {
    runner.handleAction(ALEX, action);
  }
  assert.equal(latest('host').title, 'GO!');
});

test('if nobody taps within 10 s of GO, the round has no winner', (t) => {
  const { latest, tick, tickUntil, isGo } = play(t);
  tickUntil(isGo);
  tick(9_950);
  assert.equal(latest('host').title, 'GO!');
  tick(100);
  assert.deepEqual(latest('host'), { view: 'message', title: 'Nobody tapped in time!' });
});

test('a full 5-round game: final scoreboard, then endGame with rankings', (t) => {
  const { latest, ended, tickUntil, tick, isGo, tap } = play(t);
  const winners = [ALEX, BLAKE, ALEX, ALEX, BLAKE];
  for (const [i, winner] of winners.entries()) {
    const round = i + 1;
    tickUntil(() => latest('host')?.title === `Round ${round} of 5`);
    tickUntil(isGo);
    tap(winner, round);
  }
  tickUntil(() => latest('host')?.view === 'scoreboard');
  assert.deepEqual(latest(CASEY), {
    view: 'scoreboard',
    title: 'Final scores',
    rows: [
      { playerId: ALEX, score: 3 },
      { playerId: BLAKE, score: 2 },
      { playerId: CASEY, score: 0 },
    ],
  });
  assert.deepEqual(ended, [], 'scoreboard stays up for a moment');
  tick(6000);
  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE, CASEY] }]);
});

test('options.rounds sets the number of rounds; bad values fall back to 5', (t) => {
  assert.equal(play(t, { rounds: 1 }).latest('host').title, 'Round 1 of 1');
  t.mock.timers.reset();
  assert.equal(play(t, { rounds: 99 }).latest('host').title, 'Round 1 of 5');
});

test('a refreshed phone or host screen gets its current view again', (t) => {
  const { runner, delivered, tickUntil, isGo, tap } = play(t);
  tap(ALEX, 1); // false start, so Alex's current view is "Too soon!"
  tickUntil(isGo);
  delivered.length = 0;
  runner.playerReconnected(ALEX);
  runner.playerReconnected(BLAKE);
  runner.hostReconnected();
  assert.deepEqual(delivered.map((d) => [d.target.playerId ?? d.target.to, d.view.title ?? d.view.label]), [
    [ALEX, 'Too soon!'],
    [BLAKE, 'TAP!'],
    ['host', 'GO!'],
  ]);
});

test('a player disconnecting mid-round does not stop the game', (t) => {
  const { runner, latest, tickUntil, isGo, tap } = play(t);
  runner.playerDisconnected(ALEX);
  tickUntil(isGo);
  tap(BLAKE, 1);
  assert.equal(latest('host').title, 'Blake wins round 1!');
});

test('works with a single player', (t) => {
  const { ended, latest, tickUntil, tick, isGo, tap } = play(t, { rounds: 1, players: [PLAYERS[0]] });
  tickUntil(isGo);
  tap(ALEX, 1);
  tickUntil(() => latest('host')?.view === 'scoreboard');
  tick(6000);
  assert.deepEqual(ended, [{ rankings: [ALEX] }]);
});

// A small "simulated players" check (plan §5, E4): many games with random tapping must
// always finish cleanly, and every view must use art that exists in the library.
test('simulated games with random tapping always end cleanly and only use known art', (t) => {
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
        if (rng() < 0.05) game.tap(p.id, 1 + Math.floor(rng() * 3));
      }
    }
    assert.equal(game.ended[0].error, undefined, `seed ${seed} ended with an error`);
    assert.equal(game.ended[0].rankings.length, 3);
    for (const id of assetIdsIn(game.delivered.map((d) => d.view))) {
      assert.ok(known.has(id), `seed ${seed}: unknown asset id "${id}"`);
    }
    t.mock.timers.reset();
  }
});
