import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRunner } from '../../src/games/GameRunner.js';
import { seededRandom } from '../../src/games/random.js';
import countGame from '../fixtures/countGame.js';

const PLAYERS = [
  { id: 'p_aaaa1111', name: 'Alex' },
  { id: 'p_bbbb2222', name: 'Blake' },
];
const [ALEX, BLAKE] = PLAYERS.map((p) => p.id);

/**
 * A runner for `game` whose deliver/onEnd just record what happened.
 * `game` can be a full module, or just a createGame function for one-off test games.
 */
function run(game, { options, seed = 42 } = {}) {
  const module = typeof game === 'function' ? { ...countGame, id: 'test-game', createGame: game } : game;
  const delivered = []; // [{ target, view }]
  const ended = []; // results passed to onEnd
  const runner = new GameRunner({
    game: module,
    players: PLAYERS,
    options,
    seed,
    deliver: (target, view) => delivered.push({ target, view }),
    onEnd: (results) => ended.push(results),
  });
  runner.start();
  return { runner, delivered, ended };
}

/** Silences console.error while a test deliberately breaks a game (keeps output readable). */
function quietErrors(t) {
  t.mock.method(console, 'error', () => {});
}

// --- The count game: a full happy path ------------------------------------------------

test('count game: start sends the first views', () => {
  const { delivered, ended } = run(countGame);
  assert.deepEqual(delivered, [
    { target: { to: 'all' }, view: { view: 'button', label: 'Tap!', action: { tap: true } } },
    { target: { to: 'host' }, view: { view: 'message', title: 'First to 3 taps wins!' } },
  ]);
  assert.deepEqual(ended, []);
});

test('count game: actions route to the game, and the first to 3 wins', () => {
  const { runner, delivered, ended } = run(countGame);
  runner.handleAction(ALEX, { tap: true });
  runner.handleAction(BLAKE, { tap: true });
  runner.handleAction(ALEX, { tap: true });
  assert.deepEqual(ended, []);
  runner.handleAction(ALEX, { tap: true });

  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE] }]);
  assert.deepEqual(delivered.at(-1).view, {
    view: 'scoreboard',
    title: 'Results',
    rows: [
      { playerId: ALEX, score: 3 },
      { playerId: BLAKE, score: 1 },
    ],
  });
});

test('count game: options are passed in (target 1)', () => {
  const { runner, ended } = run(countGame, { options: { target: 1 } });
  runner.handleAction(BLAKE, { tap: true });
  assert.deepEqual(ended, [{ rankings: [BLAKE, ALEX] }]);
});

test('count game: bad actions and unknown players are ignored', () => {
  const { runner, ended } = run(countGame, { options: { target: 1 } });
  runner.handleAction(ALEX, { tap: 'yes' });
  runner.handleAction(ALEX, {});
  runner.handleAction('p_notinthisgame', { tap: true });
  runner.handleAction('constructor', { tap: true });
  assert.deepEqual(ended, []);
});

test('count game: reconnecting player and host get their current view again', () => {
  const { runner, delivered } = run(countGame);
  delivered.length = 0;
  runner.playerReconnected(BLAKE);
  runner.hostReconnected();
  assert.deepEqual(delivered, [
    { target: { to: 'player', playerId: BLAKE }, view: { view: 'button', label: 'Tap!', action: { tap: true } } },
    { target: { to: 'host' }, view: { view: 'message', title: 'First to 3 taps wins!' } },
  ]);
});

test('after the game ends, nothing more reaches it or comes out of it', () => {
  const { runner, delivered, ended } = run(countGame, { options: { target: 1 } });
  runner.handleAction(ALEX, { tap: true });
  const count = delivered.length;
  runner.handleAction(ALEX, { tap: true });
  runner.playerReconnected(ALEX);
  assert.equal(delivered.length, count);
  assert.equal(ended.length, 1, 'onEnd called exactly once');
});

// --- Broken games end cleanly, never crash ---------------------------------------------

test('a game that throws in onAction ends with { error: true }', (t) => {
  quietErrors(t);
  const { runner, ended } = run(() => ({
    onAction() {
      throw new Error('bug in game');
    },
  }));
  assert.doesNotThrow(() => runner.handleAction(ALEX, {}));
  assert.deepEqual(ended, [{ error: true }]);
});

test('a game that throws in createGame ends with { error: true }', (t) => {
  quietErrors(t);
  const { ended } = run(() => {
    throw new Error('cannot start');
  });
  assert.deepEqual(ended, [{ error: true }]);
});

test('createGame must return an object with onAction', (t) => {
  quietErrors(t);
  assert.deepEqual(run(() => ({})).ended, [{ error: true }]);
  assert.deepEqual(run(() => undefined).ended, [{ error: true }]);
});

test('an invalid view ends the game (and is never delivered)', (t) => {
  quietErrors(t);
  const { delivered, ended } = run((ctx) => {
    ctx.broadcast({ view: 'html', html: '<script>alert(1)</script>' });
    return { onAction() {} };
  });
  assert.deepEqual(delivered, []);
  assert.deepEqual(ended, [{ error: true }]);
});

test('a game can catch a contract error itself and carry on', () => {
  const { delivered, ended } = run((ctx) => {
    try {
      ctx.broadcast({ view: 'nope' });
    } catch (err) {
      assert.equal(err.name, 'GameContractError');
    }
    ctx.broadcast({ view: 'message', title: 'Recovered' });
    return { onAction() {} };
  });
  assert.deepEqual(delivered.map((d) => d.view.title), ['Recovered']);
  assert.deepEqual(ended, []);
});

test('views over 8 KB end the game, even if every field is within its own limit', (t) => {
  quietErrors(t);
  // 8 options, each carrying a 2 KB action object: valid fields, ~17 KB in total.
  const options = Array.from({ length: 8 }, () => ({ label: 'Pick', action: { blob: 'x'.repeat(2000) } }));
  const { delivered, ended } = run((ctx) => {
    ctx.broadcast({ view: 'choice', prompt: 'Pick one', options });
    return { onAction() {} };
  });
  assert.deepEqual(delivered, []);
  assert.deepEqual(ended, [{ error: true }]);
});

test('the delivered view is a copy: changing the original later changes nothing', () => {
  let original;
  const { delivered } = run((ctx) => {
    original = { view: 'message', title: 'Before' };
    ctx.broadcast(original);
    return { onAction() {} };
  });
  original.title = 'After';
  assert.equal(delivered[0].view.title, 'Before');
});

test('sendToPlayer to an unknown id ends the game', (t) => {
  quietErrors(t);
  const { ended } = run((ctx) => {
    ctx.sendToPlayer('p_nobody00', { view: 'message', title: 'Hi' });
    return { onAction() {} };
  });
  assert.deepEqual(ended, [{ error: true }]);
});

test('endGame with invalid results ends the game with an error instead', (t) => {
  quietErrors(t);
  const bad = [undefined, {}, { rankings: 'Alex' }, { rankings: ['p_unknown0'] }, { rankings: [ALEX, ALEX] }, { rankings: [], winner: ALEX }];
  for (const results of bad) {
    const { runner, ended } = run((ctx) => ({ onAction: () => ctx.endGame(results) }));
    runner.handleAction(ALEX, {});
    assert.deepEqual(ended, [{ error: true }], JSON.stringify(results));
  }
});

test('endGame may rank only some players', () => {
  const { runner, ended } = run((ctx) => ({ onAction: () => ctx.endGame({ rankings: [BLAKE] }) }));
  runner.handleAction(ALEX, {});
  assert.deepEqual(ended, [{ rankings: [BLAKE] }]);
});

test('ctx.players is a frozen copy', () => {
  let players;
  run((ctx) => {
    players = ctx.players;
    return { onAction() {} };
  });
  assert.deepEqual(players, PLAYERS);
  assert.ok(Object.isFrozen(players) && Object.isFrozen(players[0]));
});

test('options are a copy: the game changing them does not affect the caller', () => {
  const options = { target: 2, nested: { a: 1 } };
  run((ctx, opts) => {
    opts.nested.a = 99;
    return { onAction() {} };
  }, { options });
  assert.equal(options.nested.a, 1);
});

// --- Timers and randomness ----------------------------------------------------------------

test('ctx.setTimeout runs later; clearTimeout cancels', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fired = [];
  run((ctx) => {
    ctx.setTimeout(() => fired.push('a'), 1000);
    const b = ctx.setTimeout(() => fired.push('b'), 2000);
    assert.equal(typeof b, 'number');
    ctx.clearTimeout(b);
    return { onAction() {} };
  });
  t.mock.timers.tick(5000);
  assert.deepEqual(fired, ['a']);
});

test('a throwing timer callback ends the game', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  quietErrors(t);
  const { ended } = run((ctx) => {
    ctx.setTimeout(() => {
      throw new Error('timer bug');
    }, 100);
    return { onAction() {} };
  });
  t.mock.timers.tick(100);
  assert.deepEqual(ended, [{ error: true }]);
});

test('ending the game cancels its pending timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fired = [];
  const { runner } = run((ctx) => {
    ctx.setTimeout(() => fired.push('late'), 5000);
    return { onAction: () => ctx.endGame({ rankings: [] }) };
  });
  runner.handleAction(ALEX, {});
  t.mock.timers.tick(10_000);
  assert.deepEqual(fired, []);
});

test('dispose (room closed) cancels timers and calls the game dispose hook once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const { runner, ended } = run((ctx) => {
    ctx.setTimeout(() => calls.push('timer'), 1000);
    return { onAction() {}, dispose: () => calls.push('dispose') };
  });
  runner.dispose();
  runner.dispose();
  t.mock.timers.tick(5000);
  assert.deepEqual(calls, ['dispose']);
  assert.deepEqual(ended, [], 'a disposed game reports no results');
});

test('setTimeout rejects bad arguments', (t) => {
  quietErrors(t);
  for (const [fn, ms] of [['not a fn', 10], [() => {}, -1], [() => {}, 11 * 60_000], [() => {}, NaN], [() => {}, '10']]) {
    const { ended } = run((ctx) => {
      ctx.setTimeout(fn, ms);
      return { onAction() {} };
    });
    assert.deepEqual(ended, [{ error: true }], `${typeof fn}, ${ms}`);
  }
});

test('ctx.random is repeatable for the same seed and different for another', () => {
  const sample = (seed) => {
    let numbers;
    run((ctx) => {
      numbers = [ctx.random(), ctx.random(), ctx.random()];
      return { onAction() {} };
    }, { seed });
    return numbers;
  };
  assert.deepEqual(sample(7), sample(7));
  assert.notDeepEqual(sample(7), sample(8));
  for (const n of sample(7)) assert.ok(n >= 0 && n < 1);
});

test('seededRandom spreads values across [0, 1)', () => {
  const random = seededRandom(123);
  const buckets = Array(10).fill(0);
  for (let i = 0; i < 10_000; i++) buckets[Math.floor(random() * 10)]++;
  for (const count of buckets) assert.ok(count > 800 && count < 1200, `bucket ${count}`);
});
