import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRunner } from '../../src/games/GameRunner.js';
import { validateGameModule } from '../../src/games/contract.js';
import reactionRace from '../../src/games/reaction-race/index.js';
import { knownAssetIds, assetIdsIn } from '../helpers/assets.js';
import { find, texts, headline } from '../helpers/screens.js';

const PLAYERS = [
  { id: 'p_aaaa1111', name: 'Alex' },
  { id: 'p_bbbb2222', name: 'Blake' },
  { id: 'p_cccc3333', name: 'Casey' },
];
const [ALEX, BLAKE, CASEY] = PLAYERS.map((p) => p.id);

/**
 * Runs Reaction Race through the real GameRunner with mock time.
 * Returns helpers to look at the latest screen for each phone and the host, and to move time forward.
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
  const head = (who) => headline(latest(who));
  /** "Round 2 of 5": the first line of the host's in-round screens. */
  const roundLine = () => texts(latest('host'))[0];
  const isGo = () => head('host') === 'GO!';
  const tap = (playerId, round) => runner.handleAction(playerId, { tap: true, round });

  return { runner, delivered, ended, latest, head, roundLine, tick, tickUntil, isGo, tap };
}

test('follows the game contract', () => {
  assert.deepEqual(validateGameModule(reactionRace), []);
});

test('round 1 starts with "get ready" on the host and a waiting button on phones', (t) => {
  const { latest } = play(t);
  assert.deepEqual(latest('host'), {
    blocks: [
      { type: 'text', text: 'Round 1 of 5', tone: 'muted' },
      { type: 'text', text: 'Get ready…', size: 'huge', bold: true },
      { type: 'text', text: 'Wait for GO!', size: 'big' },
    ],
  });
  assert.deepEqual(latest(ALEX), {
    blocks: [
      { type: 'text', text: 'Round 1 of 5', tone: 'muted' },
      { type: 'button', label: 'Wait for it…', action: { tap: true, round: 1 }, size: 'big', tone: 'muted' },
      { type: 'text', text: 'Your wins: 0', tone: 'muted' },
    ],
  });
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
  assert.deepEqual(find(latest(BLAKE), 'button'), { type: 'button', label: 'TAP!', action: { tap: true, round: 1 }, asset: 'go-sign', size: 'big', tone: 'good' });
  assert.equal(find(latest('host'), 'image').asset, 'go-sign');
});

test('first tap after GO wins the round; later taps change nothing', (t) => {
  const { latest, tickUntil, isGo, tap, head } = play(t);
  tickUntil(isGo);
  tap(BLAKE, 1);
  tap(ALEX, 1);

  assert.equal(head('host'), 'Blake wins round 1!');
  assert.equal(find(latest('host'), 'image').asset, 'trophy');
  assert.equal(head(BLAKE), 'You won this round!');
  assert.equal(head(ALEX), 'Blake was fastest!');
});

test('tapping before GO is a false start: sit out the round', (t) => {
  const { latest, tickUntil, isGo, tap, head } = play(t);
  tap(ALEX, 1); // too early
  assert.equal(head(ALEX), 'Too soon!');
  assert.equal(find(latest(BLAKE), 'button').label, 'Wait for it…', 'others unaffected');

  tickUntil(isGo);
  assert.equal(head(ALEX), 'Too soon!', 'no TAP! button for a false starter');
  tap(ALEX, 1); // ignored
  assert.equal(head('host'), 'GO!');
  tap(CASEY, 1);
  assert.equal(head('host'), 'Casey wins round 1!');
});

test('if everyone false-starts, the round ends right away instead of waiting', (t) => {
  const { latest, tick, tap, isGo, head, roundLine } = play(t);
  tap(ALEX, 1);
  tap(BLAKE, 1);
  assert.equal(head('host'), 'Get ready…', 'Casey can still tap: keep going');
  tap(CASEY, 1);
  assert.equal(head('host'), 'Everyone tapped too early!');
  assert.equal(head(ALEX), 'Everyone tapped too early!');
  tick(10_000);
  assert.equal(isGo(), false, 'the old GO timer was cancelled');
  assert.equal(roundLine(), 'Round 2 of 5', 'next round started after the result pause');
});

test('a disconnected player is not waited for when everyone else false-starts', (t) => {
  const { runner, latest, tap, head } = play(t);
  runner.playerDisconnected(CASEY);
  tap(ALEX, 1);
  tap(BLAKE, 1);
  assert.equal(head('host'), 'Everyone tapped too early!');
});

test('the round also ends if the last player who could tap disconnects', (t) => {
  const { runner, latest, tap, head } = play(t);
  tap(ALEX, 1);
  tap(BLAKE, 1);
  runner.playerDisconnected(CASEY);
  assert.equal(head('host'), 'Everyone tapped too early!');
});

test('if everyone disconnects without false-starting, the round keeps waiting', (t) => {
  const { runner, latest } = play(t);
  for (const p of PLAYERS) runner.playerDisconnected(p.id);
  assert.equal(headline(latest('host')), 'Get ready…');
});

test('taps from another round, or malformed taps, are ignored', (t) => {
  const { runner, latest, tickUntil, isGo, head } = play(t);
  tickUntil(isGo);
  for (const action of [{ tap: true, round: 2 }, { tap: true, round: 0 }, { tap: true }, { tap: 'yes', round: 1 }, {}]) {
    runner.handleAction(ALEX, action);
  }
  assert.equal(head('host'), 'GO!');
});

test('if nobody taps within 10 s of GO, the round has no winner', (t) => {
  const { latest, tick, tickUntil, isGo, head } = play(t);
  tickUntil(isGo);
  tick(9_950);
  assert.equal(head('host'), 'GO!');
  tick(100);
  assert.equal(head('host'), 'Nobody tapped in time!');
});

test('a full 5-round game: final scoreboard, then endGame with rankings', (t) => {
  const { latest, ended, tickUntil, tick, isGo, tap, roundLine } = play(t);
  const winners = [ALEX, BLAKE, ALEX, ALEX, BLAKE];
  for (const [i, winner] of winners.entries()) {
    const round = i + 1;
    tickUntil(() => roundLine() === `Round ${round} of 5`);
    tickUntil(isGo);
    tap(winner, round);
  }
  tickUntil(() => find(latest('host'), 'scoreboard'));
  assert.deepEqual(latest(CASEY), {
    blocks: [
      { type: 'text', text: 'Final scores', size: 'big', bold: true },
      {
        type: 'scoreboard',
        rows: [
          { playerId: ALEX, score: 3 },
          { playerId: BLAKE, score: 2 },
          { playerId: CASEY, score: 0 },
        ],
      },
    ],
  });
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
  tap(ALEX, 1); // false start, so Alex's current screen is "Too soon!"
  tickUntil(isGo);
  delivered.length = 0;
  runner.playerReconnected(ALEX);
  runner.playerReconnected(BLAKE);
  runner.hostReconnected();
  assert.deepEqual(delivered.map((d) => [d.target.playerId ?? d.target.to, headline(d.screen) ?? find(d.screen, 'button').label]), [
    [ALEX, 'Too soon!'],
    [BLAKE, 'TAP!'],
    ['host', 'GO!'],
  ]);
});

test('a player disconnecting mid-round does not stop the game', (t) => {
  const { runner, latest, tickUntil, isGo, tap, head } = play(t);
  runner.playerDisconnected(ALEX);
  tickUntil(isGo);
  tap(BLAKE, 1);
  assert.equal(head('host'), 'Blake wins round 1!');
});

test('works with a single player', (t) => {
  const { ended, latest, tickUntil, tick, isGo, tap } = play(t, { rounds: 1, players: [PLAYERS[0]] });
  tickUntil(isGo);
  tap(ALEX, 1);
  tickUntil(() => find(latest('host'), 'scoreboard'));
  tick(6000);
  assert.deepEqual(ended, [{ rankings: [ALEX], scores: { [ALEX]: 1 } }]);
});

// A small "simulated players" check (plan §5, E4): many games with random tapping must
// always finish cleanly, and every screen must use art that exists in the library.
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
    for (const id of assetIdsIn(game.delivered.map((d) => d.screen))) {
      assert.ok(known.has(id), `seed ${seed}: unknown asset id "${id}"`);
    }
    t.mock.timers.reset();
  }
});
