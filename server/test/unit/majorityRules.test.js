import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRunner } from '../../src/games/GameRunner.js';
import { validateGameModule } from '../../src/games/contract.js';
import majorityRules from '../../src/games/majority-rules/index.js';
import { find, texts, headline } from '../helpers/screens.js';

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
    deliver: (target, screen) => delivered.push({ target, screen }),
    onEnd: (results) => ended.push(results),
  });
  runner.start();

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
  /** Picks answer number `answer` (0-based) for this round, as the phone would. */
  const pick = (playerId, answer) => {
    const option = find(latest(playerId), 'choice').options[answer];
    runner.handleAction(playerId, option.action);
  };
  /** "Round 2 of 3": the first line of every answering screen. */
  const roundLine = () => texts(latest('host'))[0];
  /** The host's "1 of 3 answered" bar. */
  const answered = () => find(latest('host'), 'progress')?.label;
  return { runner, latest, tick, pick, ended, roundLine, answered };
}

test('follows the game contract', () => {
  assert.deepEqual(validateGameModule(majorityRules), []);
});

test('a round starts with a question and a choice on every phone, and a timer bar on the host', (t) => {
  const { latest, roundLine, answered } = play(t);
  const phone = latest(ALEX);
  assert.deepEqual(texts(phone).slice(0, 1), ['Round 1 of 3']);
  assert.match(texts(phone)[1], /\?$/, 'the question');
  const choice = find(phone, 'choice');
  assert.equal(choice.options.length, 4);
  assert.deepEqual(choice.options[2].action, { answer: 2, round: 1 });
  assert.deepEqual(latest(BLAKE), phone, 'everyone gets the same question');

  const timer = find(latest('host'), 'timer');
  assert.deepEqual(timer, { type: 'timer', startedAt: 1_000_000, endsAt: 1_000_000 + 20_000, style: 'bar' }, 'uses ctx.now(), not the real clock');
  assert.equal(roundLine(), 'Round 1 of 3');
  assert.equal(answered(), '0 of 3 answered');
});

test('answering locks you in and updates the host count', (t) => {
  const { latest, pick, answered } = play(t);
  pick(ALEX, 0);
  assert.ok(texts(latest(ALEX)).includes('Answer locked in! Waiting for everyone else…'));
  assert.match(find(latest(ALEX), 'card').children[0].text, /^You picked: /);
  assert.equal(find(latest(ALEX), 'choice'), undefined, 'no more answering');
  assert.equal(answered(), '1 of 3 answered');
  assert.ok(find(latest(BLAKE), 'choice'));
});

test('when everyone has answered, the most popular answer scores', (t) => {
  const { latest, pick } = play(t);
  pick(ALEX, 1);
  pick(BLAKE, 1);
  pick(CASEY, 3);
  const host = latest('host'); // result
  assert.equal(headline(host), 'The crowd picked');
  assert.equal(texts(host)[1], texts(latest(ALEX))[1].replace('+1 point for ', ''), 'then the winning answer, huge');
  assert.ok(texts(host).includes('2 players scored a point.'));
  const bars = find(host, 'card').children;
  assert.deepEqual(
    bars.map((b) => [b.value, b.max, b.tone]),
    [
      [0, 3, 'muted'],
      [2, 3, 'good'],
      [0, 3, 'muted'],
      [1, 3, 'muted'],
    ],
    'how many picked each answer; the winner highlighted',
  );
  assert.equal(headline(latest(ALEX)), 'You agreed with the crowd!');
  assert.match(headline(latest(CASEY)), /^The crowd picked /);
  assert.ok(texts(latest(CASEY)).includes('No point this time.'));
});

test('a tie for most popular: everyone in the tie scores', (t) => {
  const { latest, pick, tick, ended } = play(t, { rounds: 1 });
  pick(ALEX, 0);
  pick(BLAKE, 2);
  tick(20_000); // Casey never answers
  assert.match(texts(latest('host'))[1], / & /, 'both answers named');
  assert.equal(headline(latest(ALEX)), 'You agreed with the crowd!');
  assert.equal(headline(latest(BLAKE)), 'You agreed with the crowd!');
  tick(5_000);
  tick(6_000);
  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE, CASEY], scores: { [ALEX]: 1, [BLAKE]: 1, [CASEY]: 0 } }]);
});

test('if nobody answers, the round ends after 20 s anyway', (t) => {
  const { latest, tick, roundLine } = play(t);
  tick(19_999);
  assert.ok(find(latest('host'), 'timer'));
  tick(1);
  assert.deepEqual(texts(latest('host')), ['Nobody answered!', 'On to the next one.']);
  tick(5_000);
  assert.equal(roundLine(), 'Round 2 of 3');
});

test('answers for another round, out of range, or a second time are ignored', (t) => {
  const { runner, pick, answered } = play(t);
  for (const action of [{ answer: 0, round: 2 }, { answer: 9, round: 1 }, { answer: -1, round: 1 }, { answer: '0', round: 1 }, {}]) {
    runner.handleAction(ALEX, action);
  }
  assert.equal(answered(), '0 of 3 answered', 'nothing counted');
  pick(ALEX, 0);
  runner.handleAction(ALEX, { answer: 1, round: 1 }); // changing your mind isn't allowed
  assert.equal(answered(), '1 of 3 answered');
});

test('a disconnected player is not waited for', (t) => {
  const { runner, latest, pick, answered } = play(t);
  runner.playerDisconnected(CASEY);
  assert.equal(answered(), '0 of 2 answered');
  pick(ALEX, 0);
  pick(BLAKE, 0);
  assert.equal(headline(latest('host')), 'The crowd picked', 'round ended without Casey');
});

test('a full game: three rounds, final scoreboard, then endGame with scores', (t) => {
  const { latest, pick, tick, ended, roundLine } = play(t);
  for (let round = 1; round <= 3; round++) {
    assert.equal(roundLine(), `Round ${round} of 3`);
    pick(ALEX, 0);
    pick(BLAKE, 0);
    pick(CASEY, round === 2 ? 0 : 1); // Casey agrees once
    tick(5_000);
  }
  assert.equal(headline(latest('host')), 'Final scores');
  assert.deepEqual(find(latest(CASEY), 'scoreboard').rows, [
    { playerId: ALEX, score: 3 },
    { playerId: BLAKE, score: 3 },
    { playerId: CASEY, score: 1 },
  ]);
  tick(6_000);
  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE, CASEY], scores: { [ALEX]: 3, [BLAKE]: 3, [CASEY]: 1 } }]);
});

test('options.rounds sets the number of rounds; bad values fall back to 3', (t) => {
  assert.equal(play(t, { rounds: 5 }).roundLine(), 'Round 1 of 5');
  t.mock.timers.reset();
  assert.equal(play(t, { rounds: 99 }).roundLine(), 'Round 1 of 3');
});

test('different seeds ask the questions in a different order', (t) => {
  const first = (seed) => {
    const question = texts(play(t, { seed }).latest(ALEX))[1];
    t.mock.timers.reset();
    return question;
  };
  const questions = new Set([1, 2, 3, 4, 5].map(first));
  assert.ok(questions.size > 1);
});
