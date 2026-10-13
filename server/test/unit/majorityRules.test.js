import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRunner } from '../../src/games/GameRunner.js';
import { validateGameModule } from '../../src/games/contract.js';
import majorityRules from '../../src/games/majority-rules/index.js';

const PLAYERS = [
  { id: 'p_aaaa1111', name: 'Alex' },
  { id: 'p_bbbb2222', name: 'Blake' },
  { id: 'p_cccc3333', name: 'Casey' },
];
const [ALEX, BLAKE, CASEY] = PLAYERS.map((p) => p.id);

/** Runs Majority Rules through the real GameRunner with mock time; returns helpers. */
function play(t, { rounds, seed = 1 } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 1_000_000;
  const delivered = [];
  const ended = [];
  const runner = new GameRunner({
    game: majorityRules,
    players: PLAYERS,
    options: rounds === undefined ? {} : { rounds },
    seed,
    now: () => clock,
    deliver: (target, view) => delivered.push({ target, view }),
    onEnd: (results) => ended.push(results),
  });
  runner.start();

  function latest(who) {
    for (let i = delivered.length - 1; i >= 0; i--) {
      const { target, view } = delivered[i];
      if (target.to === 'all') return view;
      if (who === 'host' && target.to === 'host') return view;
      if (target.to === 'player' && target.playerId === who) return view;
    }
    return undefined;
  }
  const tick = (ms) => {
    clock += ms;
    t.mock.timers.tick(ms);
  };
  /** Picks answer number `answer` (0-based) for this round, as the phone would. */
  const pick = (playerId, answer) => {
    const option = latest(playerId).options[answer];
    runner.handleAction(playerId, option.action);
  };
  return { runner, latest, tick, pick, ended };
}

test('follows the game contract', () => {
  assert.deepEqual(validateGameModule(majorityRules), []);
});

test('a round starts with a choice on every phone and a countdown on the host', (t) => {
  const { latest } = play(t);
  const phone = latest(ALEX);
  assert.equal(phone.view, 'choice');
  assert.equal(phone.options.length, 4);
  assert.deepEqual(phone.options[2].action, { answer: 2, round: 1 });
  assert.deepEqual(latest(BLAKE), phone, 'everyone gets the same question');

  const host = latest('host');
  assert.equal(host.view, 'countdown');
  assert.equal(host.endsAt, 1_000_000 + 20_000, 'uses ctx.now(), not the real clock');
  assert.match(host.title, /^Round 1\/3: .+\? \(0\/3 answered\)$/);
});

test('answering locks you in and updates the host count', (t) => {
  const { latest, pick } = play(t);
  pick(ALEX, 0);
  assert.equal(latest(ALEX).title, 'Answer locked in!');
  assert.match(latest('host').title, /\(1\/3 answered\)$/);
  assert.equal(latest(BLAKE).view, 'choice');
});

test('when everyone has answered, the most popular answer scores', (t) => {
  const { latest, pick } = play(t);
  pick(ALEX, 1);
  pick(BLAKE, 1);
  pick(CASEY, 3);
  const answers = latest('host'); // result
  assert.match(answers.title, /^The crowd picked: /);
  assert.equal(answers.text, '2 players scored a point.');
  assert.equal(latest(ALEX).title, 'You agreed with the crowd!');
  assert.match(latest(CASEY).title, /^The crowd picked /);
  assert.equal(latest(CASEY).text, 'No point this time.');
});

test('a tie for most popular: everyone in the tie scores', (t) => {
  const { latest, pick, tick, ended } = play(t, { rounds: 1 });
  pick(ALEX, 0);
  pick(BLAKE, 2);
  tick(20_000); // Casey never answers
  assert.match(latest('host').title, / & /, 'both answers named');
  assert.equal(latest(ALEX).title, 'You agreed with the crowd!');
  assert.equal(latest(BLAKE).title, 'You agreed with the crowd!');
  tick(5_000);
  tick(6_000);
  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE, CASEY], scores: { [ALEX]: 1, [BLAKE]: 1, [CASEY]: 0 } }]);
});

test('if nobody answers, the round ends after 20 s anyway', (t) => {
  const { latest, tick } = play(t);
  tick(19_999);
  assert.equal(latest('host').view, 'countdown');
  tick(1);
  assert.deepEqual(latest('host'), { view: 'message', title: 'Nobody answered!', text: 'On to the next one.' });
  tick(5_000);
  assert.match(latest('host').title, /^Round 2\/3/);
});

test('answers for another round, out of range, or a second time are ignored', (t) => {
  const { runner, latest, pick } = play(t);
  const before = latest('host').title;
  for (const action of [{ answer: 0, round: 2 }, { answer: 9, round: 1 }, { answer: -1, round: 1 }, { answer: '0', round: 1 }, {}]) {
    runner.handleAction(ALEX, action);
  }
  assert.equal(latest('host').title, before, 'nothing counted');
  pick(ALEX, 0);
  runner.handleAction(ALEX, { answer: 1, round: 1 }); // changing your mind isn't allowed
  assert.match(latest('host').title, /\(1\/3 answered\)$/);
});

test('a disconnected player is not waited for', (t) => {
  const { runner, latest, pick } = play(t);
  runner.playerDisconnected(CASEY);
  assert.match(latest('host').title, /\(0\/2 answered\)$/);
  pick(ALEX, 0);
  pick(BLAKE, 0);
  assert.match(latest('host').title, /^The crowd picked/, 'round ended without Casey');
});

test('a full game: three rounds, final scoreboard, then endGame with scores', (t) => {
  const { latest, pick, tick, ended } = play(t);
  for (let round = 1; round <= 3; round++) {
    assert.match(latest('host').title, new RegExp(`^Round ${round}/3`));
    pick(ALEX, 0);
    pick(BLAKE, 0);
    pick(CASEY, round === 2 ? 0 : 1); // Casey agrees once
    tick(5_000);
  }
  assert.equal(latest('host').view, 'scoreboard');
  assert.deepEqual(latest(CASEY).rows, [
    { playerId: ALEX, score: 3 },
    { playerId: BLAKE, score: 3 },
    { playerId: CASEY, score: 1 },
  ]);
  tick(6_000);
  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE, CASEY], scores: { [ALEX]: 3, [BLAKE]: 3, [CASEY]: 1 } }]);
});

test('options.rounds sets the number of rounds; bad values fall back to 3', (t) => {
  assert.match(play(t, { rounds: 5 }).latest('host').title, /^Round 1\/5/);
  t.mock.timers.reset();
  assert.match(play(t, { rounds: 99 }).latest('host').title, /^Round 1\/3/);
});

test('different seeds ask the questions in a different order', (t) => {
  const first = (seed) => {
    const prompt = play(t, { seed }).latest(ALEX).prompt;
    t.mock.timers.reset();
    return prompt;
  };
  const prompts = new Set([1, 2, 3, 4, 5].map(first));
  assert.ok(prompts.size > 1);
});
