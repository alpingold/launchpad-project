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
function run(game, { options, seed = 42, now } = {}) {
  const module = typeof game === 'function' ? { ...countGame, id: 'test-game', createGame: game } : game;
  const delivered = []; // [{ target, screen }]
  const ended = []; // results passed to onEnd
  const runner = new GameRunner({
    game: module,
    players: PLAYERS,
    options,
    seed,
    now,
    deliver: (target, screen) => delivered.push({ target, screen }),
    onEnd: (results) => ended.push(results),
  });
  runner.start();
  return { runner, delivered, ended };
}

/**
 * Wraps a one-off test game so it starts by showing everyone a button whose action is {}.
 * Needed because the runner only passes on actions that are on the player's screen.
 */
const TAP = { blocks: [{ type: 'button', label: 'Tap', action: {} }] };
function tappable(createGame) {
  return (ctx, options) => {
    ctx.broadcast(TAP);
    return createGame(ctx, options);
  };
}

/** Silences console.error while a test deliberately breaks a game (keeps output readable). */
function quietErrors(t) {
  t.mock.method(console, 'error', () => {});
}

// --- The count game: a full happy path ------------------------------------------------

test('count game: start sends the first screens', () => {
  const { delivered, ended } = run(countGame);
  assert.deepEqual(delivered, [
    { target: { to: 'all' }, screen: { blocks: [{ type: 'button', label: 'Tap!', action: { tap: true } }] } },
    { target: { to: 'host' }, screen: { blocks: [{ type: 'text', text: 'First to 3 taps wins!' }] } },
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

  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE], scores: { [ALEX]: 3, [BLAKE]: 1 } }]);
  assert.deepEqual(delivered.at(-1).screen, {
    blocks: [
      { type: 'text', text: 'Results', size: 'big' },
      {
        type: 'scoreboard',
        rows: [
          { playerId: ALEX, score: 3 },
          { playerId: BLAKE, score: 1 },
        ],
      },
    ],
  });
});

test('count game: options are passed in (target 1)', () => {
  const { runner, ended } = run(countGame, { options: { target: 1 } });
  runner.handleAction(BLAKE, { tap: true });
  assert.deepEqual(ended, [{ rankings: [BLAKE, ALEX], scores: { [ALEX]: 0, [BLAKE]: 1 } }]);
});

test('count game: bad actions and unknown players are ignored', () => {
  const { runner, ended } = run(countGame, { options: { target: 1 } });
  runner.handleAction(ALEX, { tap: 'yes' });
  runner.handleAction(ALEX, {});
  runner.handleAction('p_notinthisgame', { tap: true });
  runner.handleAction('constructor', { tap: true });
  assert.deepEqual(ended, []);
});

test('count game: reconnecting player and host get their current screen again', () => {
  const { runner, delivered } = run(countGame);
  delivered.length = 0;
  runner.playerReconnected(BLAKE);
  runner.hostReconnected();
  assert.deepEqual(delivered, [
    { target: { to: 'player', playerId: BLAKE }, screen: { blocks: [{ type: 'button', label: 'Tap!', action: { tap: true } }] } },
    { target: { to: 'host' }, screen: { blocks: [{ type: 'text', text: 'First to 3 taps wins!' }] } },
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
  const { runner, ended } = run(
    tappable(() => ({
      onAction() {
        throw new Error('bug in game');
      },
    })),
  );
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

test('an invalid screen ends the game (and is never delivered)', (t) => {
  quietErrors(t);
  const { delivered, ended } = run((ctx) => {
    ctx.broadcast({ blocks: [{ type: 'html', html: '<script>alert(1)</script>' }] });
    return { onAction() {} };
  });
  assert.deepEqual(delivered, []);
  assert.deepEqual(ended, [{ error: true }]);
});

test('a game can catch a contract error itself and carry on', () => {
  const { delivered, ended } = run((ctx) => {
    try {
      ctx.broadcast({ blocks: [{ type: 'nope' }] });
    } catch (err) {
      assert.equal(err.name, 'GameContractError');
    }
    ctx.broadcast({ blocks: [{ type: 'text', text: 'Recovered' }] });
    return { onAction() {} };
  });
  assert.deepEqual(delivered.map((d) => d.screen.blocks[0].text), ['Recovered']);
  assert.deepEqual(ended, []);
});

test('screens over 8 KB end the game, even if every field is within its own limit', (t) => {
  quietErrors(t);
  // 8 options, each carrying a 2 KB action object: valid fields, ~17 KB in total.
  const options = Array.from({ length: 8 }, () => ({ label: 'Pick', action: { blob: 'x'.repeat(2000) } }));
  const { delivered, ended } = run((ctx) => {
    ctx.broadcast({ blocks: [{ type: 'choice', options }] });
    return { onAction() {} };
  });
  assert.deepEqual(delivered, []);
  assert.deepEqual(ended, [{ error: true }]);
});

test('the delivered screen is a copy: changing the original later changes nothing', () => {
  let original;
  const { delivered } = run((ctx) => {
    original = { blocks: [{ type: 'text', text: 'Before' }] };
    ctx.broadcast(original);
    return { onAction() {} };
  });
  original.blocks[0].text = 'After';
  assert.equal(delivered[0].screen.blocks[0].text, 'Before');
});

test('a screen naming a player who isn\'t in the game ends the game', (t) => {
  quietErrors(t);
  const { delivered, ended } = run((ctx) => {
    ctx.broadcast({ blocks: [{ type: 'playerName', playerId: 'p_ghost000' }] });
    return { onAction() {} };
  });
  assert.deepEqual(delivered, []);
  assert.deepEqual(ended, [{ error: true }]);
});

test('sendToPlayer to an unknown id ends the game', (t) => {
  quietErrors(t);
  const { ended } = run((ctx) => {
    ctx.sendToPlayer('p_nobody00', { blocks: [{ type: 'text', text: 'Hi' }] });
    return { onAction() {} };
  });
  assert.deepEqual(ended, [{ error: true }]);
});

test('endGame with invalid results ends the game with an error instead', (t) => {
  quietErrors(t);
  const bad = [undefined, {}, { rankings: 'Alex' }, { rankings: ['p_unknown0'] }, { rankings: [ALEX, ALEX] }, { rankings: [], winner: ALEX },
    { rankings: [], scores: [1, 2] }, { rankings: [], scores: { p_unknown0: 1 } }, { rankings: [], scores: { [ALEX]: '3' } },
    { rankings: [], scores: { [ALEX]: Infinity } }];
  for (const results of bad) {
    const { runner, ended } = run(tappable((ctx) => ({ onAction: () => ctx.endGame(results) })));
    runner.handleAction(ALEX, {});
    assert.deepEqual(ended, [{ error: true }], JSON.stringify(results));
  }
});

test('endGame may rank only some players', () => {
  const { runner, ended } = run(tappable((ctx) => ({ onAction: () => ctx.endGame({ rankings: [BLAKE] }) })));
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
  const { runner } = run(
    tappable((ctx) => {
      ctx.setTimeout(() => fired.push('late'), 5000);
      return { onAction: () => ctx.endGame({ rankings: [] }) };
    }),
  );
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

// --- Contract v2 (plan §11b) ---------------------------------------------------------------

test('only actions on the player\'s screen right now reach the game', () => {
  const received = [];
  const { runner } = run((ctx) => {
    ctx.sendToPlayer(ALEX, {
      blocks: [
        { type: 'text', text: 'Pick one' },
        {
          type: 'choice',
          options: [
            { label: 'Red', action: { pick: 'red', round: 1 } },
            { label: 'Blue', action: { pick: 'blue', round: 1 } },
          ],
        },
      ],
    });
    return { onAction: (playerId, action) => received.push([playerId, action]) };
  });

  runner.handleAction(ALEX, { round: 1, pick: 'blue' }); // key order doesn't matter
  runner.handleAction(ALEX, { pick: 'green', round: 1 }); // not an option
  runner.handleAction(ALEX, { pick: 'red', round: 1, extra: true }); // extra field
  runner.handleAction(ALEX, { pick: 'red' }); // missing field
  runner.handleAction(BLAKE, { pick: 'red', round: 1 }); // Blake was never shown this choice
  assert.deepEqual(received, [[ALEX, { round: 1, pick: 'blue' }]]);
});

test('input reaches the game checked and cleaned up; bad input never does', () => {
  const received = [];
  const { runner } = run((ctx) => {
    ctx.sendToPlayer(ALEX, { blocks: [{ type: 'textInput', maxLength: 30, action: { caption: true, round: 1 } }] });
    ctx.sendToPlayer(BLAKE, { blocks: [{ type: 'button', label: 'Go', action: { go: 1 } }] });
    return { onAction: (...args) => received.push(args) };
  });
  runner.handleAction(ALEX, { caption: true, round: 1 }, '  A cat on a skateboard  ');
  runner.handleAction(ALEX, { caption: true, round: 1 }, 'x'.repeat(31)); // too long
  runner.handleAction(ALEX, { caption: true, round: 1 }); // no text
  runner.handleAction(ALEX, { caption: true, round: 1 }, ['not', 'text']);
  runner.handleAction(BLAKE, { go: 1 }, 'a button takes no input');
  runner.handleAction(BLAKE, { go: 1 });
  assert.deepEqual(received, [
    [ALEX, { caption: true, round: 1 }, 'A cat on a skateboard'],
    [BLAKE, { go: 1 }],
  ]);
});

test('once a screen changes, actions from the old screen are dropped', () => {
  const received = [];
  const { runner } = run((ctx) => {
    ctx.broadcast({ blocks: [{ type: 'button', label: 'Go', action: { go: 1 } }] });
    return {
      onAction(playerId, action) {
        received.push(action);
        ctx.sendToPlayer(playerId, { blocks: [{ type: 'text', text: 'Thanks!' }] });
      },
    };
  });
  runner.handleAction(ALEX, { go: 1 });
  runner.handleAction(ALEX, { go: 1 }); // a double tap: Alex's screen now says "Thanks!"
  runner.handleAction(BLAKE, { go: 1 }); // Blake still has the button
  assert.deepEqual(received, [{ go: 1 }, { go: 1 }]);
});

test('reconnecting: the platform resends the latest screen to each phone and the host, with no game code needed', () => {
  const { runner, delivered } = run((ctx) => {
    ctx.broadcast({ blocks: [{ type: 'text', text: 'Round 1' }] });
    ctx.sendToPlayer(ALEX, { blocks: [{ type: 'button', label: 'Go', action: {} }] });
    ctx.sendToHost({ blocks: [{ type: 'text', text: 'Host only' }] });
    return { onAction() {} };
  });
  delivered.length = 0;
  runner.playerReconnected(ALEX);
  runner.playerReconnected(BLAKE);
  runner.hostReconnected();
  assert.deepEqual(delivered, [
    { target: { to: 'player', playerId: ALEX }, screen: { blocks: [{ type: 'button', label: 'Go', action: {} }] } },
    { target: { to: 'player', playerId: BLAKE }, screen: { blocks: [{ type: 'text', text: 'Round 1' }] } },
    { target: { to: 'host' }, screen: { blocks: [{ type: 'text', text: 'Host only' }] } },
  ]);
});

test('reconnecting before any screen was sent sends nothing', () => {
  const { runner, delivered } = run(() => ({ onAction() {} }));
  runner.playerReconnected(ALEX);
  runner.hostReconnected();
  assert.deepEqual(delivered, []);
});

test('reconnect hooks run first; if a hook sends a new screen, it is not sent twice', () => {
  const calls = [];
  const { runner, delivered } = run((ctx) => {
    ctx.broadcast({ blocks: [{ type: 'text', text: 'Old' }] });
    return {
      onAction() {},
      onPlayerReconnect(playerId) {
        calls.push(playerId);
        ctx.sendToPlayer(playerId, { blocks: [{ type: 'text', text: 'Welcome back' }] });
      },
      onHostReconnect() {
        calls.push('host'); // updates nothing: the platform resends the host screen
      },
    };
  });
  delivered.length = 0;
  runner.playerReconnected(ALEX);
  runner.hostReconnected();
  assert.deepEqual(calls, [ALEX, 'host']);
  assert.deepEqual(delivered.map((d) => d.screen.blocks[0].text), ['Welcome back', 'Old']);
});

test('ctx.now gives the server clock', () => {
  let seen;
  run(
    (ctx) => {
      seen = ctx.now();
      return { onAction() {} };
    },
    { now: () => 1_700_000_000_000 },
  );
  assert.equal(seen, 1_700_000_000_000);
});

test('endGame accepts scores, and passes on a copy', () => {
  const scores = { [ALEX]: 2, [BLAKE]: 2 };
  const { runner, ended } = run(tappable((ctx) => ({ onAction: () => ctx.endGame({ rankings: [ALEX, BLAKE], scores }) })));
  runner.handleAction(ALEX, {});
  scores[ALEX] = 99;
  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE], scores: { [ALEX]: 2, [BLAKE]: 2 } }]);
});
