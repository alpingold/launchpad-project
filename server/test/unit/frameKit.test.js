import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// party.kit (client/src/game/frame/kit.js, plan §13o): the game-logic helpers that run inside
// a game's frame. They touch no page, so they're tested here in Node, with a pretend `party`.

const KIT_SOURCE = readFileSync(new URL('../../../client/src/game/frame/kit.js', import.meta.url), 'utf8');

/** A fresh party.kit; players: [id, connected?][]. Timers go through Node's (mockable) ones. */
function makeKit(players = [['p_a'], ['p_b'], ['p_c']]) {
  const party = {
    players: players.map(([id, connected = true]) => ({ id, name: id, connected })),
    now: () => Date.now(),
  };
  // Run in THIS realm (not node:vm), so its arrays and objects compare equal to ours.
  // Timers are looked up on each call, so node:test's mock timers apply.
  const window = {};
  new Function('window', 'setTimeout', 'clearTimeout', KIT_SOURCE)(window, (...a) => setTimeout(...a), (...a) => clearTimeout(...a));
  return { kit: window.__partyKit(party), party };
}

test('phases: enter, time out into the next, and come back after a reload with the time left', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  try {
    const { kit } = makeKit();
    const log = [];
    const g = { flow: {} };
    let saves = 0;
    const defs = {
      ask: { ms: 20_000, enter: () => log.push('enter ask'), timeout: () => flow.go('reveal') },
      reveal: { ms: 3_000, enter: () => log.push('enter reveal'), timeout: () => flow.go('final') },
      final: { enter: () => log.push('enter final') },
    };
    const flow = kit.phases(defs, { state: g.flow, onChange: () => saves++ });
    flow.go('ask');
    assert.deepEqual([flow.phase, flow.endsAt, flow.left()], ['ask', 21_000, 20_000]);
    assert.deepEqual(g.flow, { phase: 'ask', endsAt: 21_000 }, 'the state is the plain object the game saves');
    mock.timers.tick(19_999);
    assert.equal(flow.phase, 'ask');
    mock.timers.tick(1);
    assert.equal(flow.phase, 'reveal');

    // A reload 1 s into the reveal: a new page, the same saved state.
    mock.timers.tick(1_000);
    flow.stop(); // the old page is gone
    const saved = JSON.parse(JSON.stringify(g.flow));
    const again = kit.phases(defs, { state: saved });
    defs.reveal.timeout = () => again.go('final');
    again.resume();
    assert.equal(again.left(), 2_000);
    mock.timers.tick(2_000);
    assert.equal(again.phase, 'final');
    assert.equal(again.endsAt, null, 'no ms: no time limit');
    assert.deepEqual(log, ['enter ask', 'enter reveal', 'enter final']);
    assert.equal(saves, 2);
    assert.throws(() => flow.go('nope'), /no phase "nope"/);
  } finally {
    mock.timers.reset();
  }
});

test('phases: an enter() that moves on at once, and a time-limit override', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  try {
    const { kit } = makeKit();
    let timedOut = 0;
    const flow = kit.phases({
      skip: { ms: 1_000, enter: () => flow.go('wait'), timeout: () => timedOut++ },
      wait: { ms: 5_000, timeout: () => timedOut++ },
    });
    flow.go('skip');
    assert.equal(flow.phase, 'wait');
    mock.timers.tick(1_000);
    assert.equal(timedOut, 0, "skip's timer never ran");
    flow.go('wait', { ms: 100 });
    mock.timers.tick(100);
    assert.equal(timedOut, 1);
  } finally {
    mock.timers.reset();
  }
});

test('votes: only real votes count, waiting skips who left, ties are broken as asked', () => {
  const { kit } = makeKit([['p_a'], ['p_b'], ['p_c', false]]);
  const v = kit.vote.start(['North', 'East']);
  assert.equal(kit.vote.cast(v, 'p_a', 'South'), false, 'not an option');
  assert.equal(kit.vote.cast(v, 'p_zz', 'North'), false, 'not a voter');
  assert.equal(kit.vote.cast(v, 'p_a', 'North'), true);
  assert.deepEqual(kit.vote.waitingFor(v), ['p_b'], 'p_c has left: not waited for');
  kit.vote.cast(v, 'p_b', 'East');
  assert.deepEqual(kit.vote.waitingFor(v), []);
  assert.deepEqual(JSON.parse(JSON.stringify(v)), v, 'a plain object: it saves as it is');

  const tie = kit.vote.result(v, { tie: 'first' });
  assert.deepEqual([tie.winner, tie.counts, tie.tied], ['North', { North: 1, East: 1 }, ['North', 'East']]);
  assert.equal(kit.vote.result(v, { tie: 'none' }).winner, null);
  assert.ok(['North', 'East'].includes(kit.vote.result(v).winner), 'random among the tied');
  kit.vote.cast(v, 'p_b', 'North'); // changed their mind
  assert.deepEqual(kit.vote.result(v).counts, { North: 2, East: 0 });
  assert.equal(kit.vote.result(kit.vote.start(['A', 'B']), { tie: 'first' }).winner, 'A', 'no votes: everything ties');
});

test('turns: in order, skipping players who left, rounds counted', () => {
  const { kit, party } = makeKit();
  const t = kit.turns.start();
  assert.equal(kit.turns.current(t), 'p_a');
  assert.equal(kit.turns.next(t), 'p_b');
  party.players[2].connected = false;
  assert.equal(kit.turns.next(t), 'p_a', 'p_c is skipped');
  assert.equal(t.round, 2);
  party.players.forEach((p) => (p.connected = false));
  assert.equal(kit.turns.next(t), null, 'nobody left');
});

test('rank: rankings and scores for party.end; ties share a place; no score is 0', () => {
  const { kit } = makeKit([['p_a'], ['p_b'], ['p_c'], ['p_d']]);
  const r = kit.rank({ p_a: 3, p_b: 7, p_c: 3 });
  assert.deepEqual(r.rankings, ['p_b', 'p_a', 'p_c', 'p_d']);
  assert.deepEqual(r.scores, { p_a: 3, p_b: 7, p_c: 3, p_d: 0 });
  assert.deepEqual(r.places, { p_b: 1, p_a: 2, p_c: 2, p_d: 4 });
});

test('small things: ordinal, colours, dice, shuffle, camera', () => {
  const { kit } = makeKit();
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(kit.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
  assert.equal(kit.colors.length, 12);
  assert.equal(kit.colorOf('p_b'), kit.colors[1]);
  assert.equal(kit.colorOf('p_b'), kit.colorOf('p_b'), 'the same every time');
  for (let i = 0; i < 200; i++) {
    const r = kit.roll(6);
    assert.ok(Number.isInteger(r) && r >= 1 && r <= 6);
  }
  assert.deepEqual([...kit.shuffle([1, 2, 3, 4])].sort(), [1, 2, 3, 4]);
  assert.equal(kit.pick([]), undefined);
  assert.deepEqual([kit.camera(5, 45, 120), kit.camera(60, 45, 120), kit.camera(118, 45, 120), kit.camera(10, 45, 30)], [0, 38, 75, 0]);
});

test('platformer: lands, jumps about 2.6 tiles, walls stop it, one-way platforms, touches, falls out', () => {
  const { kit } = makeKit();
  /** Runs a body for `seconds` at 60 steps a second; returns everything it touched. */
  const run = (world, b, input, seconds) => {
    const touched = [];
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) touched.push(...world.step(b, typeof input === 'function' ? input(t) : input, 1 / 60));
    return touched;
  };

  // Standing, running into a coin and a wall.
  const room = kit.platformer(['##########', '#        #', '#        #', '# S  $  ##', '##########']);
  assert.deepEqual([room.cols, room.rows, room.find('S')], [10, 5, [{ x: 2, y: 3 }]]);
  const a = room.body(room.find('S')[0]);
  run(room, a, {}, 0.3);
  assert.deepEqual([a.y, a.onGround], [4, true], 'standing on the floor below S');
  const touched = run(room, a, { right: true }, 1.5);
  assert.ok(touched.some((t) => t.ch === '$' && t.x === 5 && t.y === 3), 'touched the coin');
  assert.ok(Math.abs(a.x - (8 - 0.7)) < 1e-9, `stopped at the wall in column 8 (x ${a.x})`);
  room.set(5, 3, ' ');
  assert.equal(room.lines()[3], '# S     ##', 'set() changes a tile');

  // A jump straight up: about 2.6 tiles high.
  const tall = kit.platformer(['#######', '#     #', '#     #', '#     #', '#     #', '#     #', '#  S  #', '#######']);
  const b = tall.body(tall.find('S')[0]);
  let highest = b.y;
  run(tall, b, (t) => {
    highest = Math.min(highest, b.y);
    return { jump: t < 0.05 };
  }, 1.2);
  assert.ok(b.y - highest > 2.4 && b.y - highest < 2.9, `jump height ${b.y - highest}`);
  assert.equal(b.onGround, true, 'back on the floor');

  // A one-way platform: jump up through it, land on top of it.
  const shelf = kit.platformer(['#######', '#     #', '#     #', '#     #', '#  =  #', '#  S  #', '#######']); // 2 tiles up
  const c = shelf.body(shelf.find('S')[0]);
  run(shelf, c, (t) => ({ jump: t < 0.05 }), 1.5);
  assert.deepEqual([c.y, c.onGround], [4, true], 'went up through it, and landed on top of it');

  // A hole in the floor: out of the world.
  const pit = kit.platformer(['#####', '# S #', '## ##']);
  const d = pit.body(pit.find('S')[0]);
  assert.ok(run(pit, d, {}, 1.5).some((t) => t.ch === 'fell'));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'bodies are plain objects: they save as they are');
});
