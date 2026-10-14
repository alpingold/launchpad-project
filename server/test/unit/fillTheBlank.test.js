import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRunner } from '../../src/games/GameRunner.js';
import { validateGameModule } from '../../src/games/contract.js';
import fillTheBlank from '../../src/games/fill-the-blank/index.js';
import { find, texts, headline, blocksOf } from '../helpers/screens.js';

const PLAYERS = [
  { id: 'p_aaaa1111', name: 'Alex' },
  { id: 'p_bbbb2222', name: 'Blake' },
  { id: 'p_cccc3333', name: 'Casey' },
];
const [ALEX, BLAKE, CASEY] = PLAYERS.map((p) => p.id);

/** Runs Fill the Blank through the real GameRunner with mock time; returns helpers. */
function play(t, { rounds, seed = 1, players = PLAYERS } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 1_000_000;
  const delivered = [];
  const ended = [];
  const runner = new GameRunner({
    game: fillTheBlank,
    players,
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
  const answer = (playerId, text, round = 1) => runner.handleAction(playerId, { answer: true, round }, text);
  /** Votes for the option with this label, as the phone would. */
  const vote = (playerId, label) => {
    const option = find(latest(playerId), 'choice').options.find((o) => o.label === label);
    runner.handleAction(playerId, option.action);
  };
  const progress = () => find(latest('host'), 'progress').label;
  return { runner, ended, latest, tick, answer, vote, progress };
}

test('follows the game contract', () => {
  assert.deepEqual(validateGameModule(fillTheBlank), []);
});

test('everyone gets the prompt and a text box; answers are counted on the big screen', (t) => {
  const { latest, answer, progress } = play(t);
  const prompt = texts(latest('host'))[1];
  assert.match(prompt, /___$/);
  assert.ok(find(latest(ALEX), 'textInput'));
  assert.equal(progress(), '0 of 3 answered');
  answer(ALEX, 'a live goose');
  assert.equal(headline(latest(ALEX)), 'Answer in!');
  assert.ok(texts(latest(ALEX)).includes('a live goose'));
  assert.equal(progress(), '1 of 3 answered');
  answer(ALEX, 'changed my mind'); // one answer each
  assert.ok(texts(latest(ALEX)).includes('a live goose'));
});

test("voting: you can't vote for your own answer, and a forged vote for it is dropped", (t) => {
  const { runner, latest, answer, progress } = play(t);
  answer(ALEX, 'a live goose');
  answer(BLAKE, 'wet socks');
  answer(CASEY, 'a tuba');
  const labels = (who) => find(latest(who), 'choice').options.map((o) => o.label).sort();
  assert.deepEqual(labels(ALEX), ['a tuba', 'wet socks']);
  assert.deepEqual(labels(BLAKE), ['a live goose', 'a tuba']);
  assert.equal(progress(), '0 of 3 voted');
  // The big screen shows all three answers, without names.
  const cards = blocksOf(latest('host')).filter((b) => b.type === 'card');
  assert.equal(cards.length, 3);
  assert.ok(!JSON.stringify(latest('host')).includes('Alex'));

  // Alex's own answer isn't on Alex's screen, so its vote action never reaches the game.
  const own = find(latest(BLAKE), 'choice').options.find((o) => o.label === 'a live goose').action;
  runner.handleAction(ALEX, own);
  assert.equal(progress(), '0 of 3 voted');
});

test('the reveal: most votes first, with authors; a vote is a point', (t) => {
  const { latest, answer, vote, tick } = play(t, { rounds: 1 });
  answer(ALEX, 'a live goose');
  answer(BLAKE, 'wet socks');
  answer(CASEY, 'a tuba');
  vote(ALEX, 'a tuba');
  vote(BLAKE, 'a tuba');
  vote(CASEY, 'wet socks');
  const cards = blocksOf(latest('host')).filter((b) => b.type === 'card');
  assert.deepEqual(
    cards.map((c) => texts({ blocks: c.children })),
    [
      ['a tuba', 'by Casey · 2 votes'],
      ['wet socks', 'by Blake · 1 vote'],
      ['a live goose', 'by Alex · 0 votes'],
    ],
  );
  assert.equal(cards[0].tone, 'good', 'the winner is highlighted');
  assert.equal(headline(latest(CASEY)), 'Your answer got 2 votes!');
  tick(8000);
  assert.deepEqual(find(latest('host'), 'scoreboard').rows, [
    { playerId: CASEY, score: 2 },
    { playerId: BLAKE, score: 1 },
    { playerId: ALEX, score: 0 },
  ]);
});

test('timers: writing ends after 60 s, voting after 30 s, with whatever came in', (t) => {
  const { latest, answer, tick } = play(t, { rounds: 1 });
  answer(ALEX, 'a live goose');
  answer(BLAKE, 'wet socks');
  tick(60_000); // Casey never answers
  assert.ok(find(latest(CASEY), 'choice'), 'Casey can still vote');
  assert.equal(find(latest(CASEY), 'choice').options.length, 2);
  tick(30_000);
  assert.ok(texts(latest('host')).some((x) => x.startsWith('by ')), 'reveal');
  assert.equal(headline(latest(CASEY)), 'You sat this one out.');
});

test('with fewer than two answers there is nothing to vote on', (t) => {
  const { latest, answer, tick } = play(t, { rounds: 1 });
  answer(ALEX, 'lonely answer');
  tick(60_000);
  assert.ok(texts(latest('host')).includes('Not enough answers to vote on this time!'));
});

test('disconnected players are not waited for', (t) => {
  const { runner, answer, vote, progress, latest } = play(t);
  runner.playerDisconnected(CASEY);
  assert.equal(progress(), '0 of 2 answered');
  answer(ALEX, 'a live goose');
  answer(BLAKE, 'wet socks');
  assert.equal(progress(), '0 of 2 voted');
  vote(ALEX, 'wet socks');
  vote(BLAKE, 'a live goose');
  assert.ok(texts(latest('host')).some((x) => x.startsWith('by ')), 'reveal without Casey');
});

test('a full game: three rounds, then endGame with scores', (t) => {
  const { ended, answer, vote, tick } = play(t);
  for (let round = 1; round <= 3; round++) {
    answer(ALEX, `alex ${round}`, round);
    answer(BLAKE, `blake ${round}`, round);
    answer(CASEY, `casey ${round}`, round);
    vote(ALEX, `blake ${round}`);
    vote(BLAKE, `alex ${round}`);
    vote(CASEY, `alex ${round}`);
    tick(8000);
  }
  tick(8000);
  assert.deepEqual(ended, [{ rankings: [ALEX, BLAKE, CASEY], scores: { [ALEX]: 6, [BLAKE]: 3, [CASEY]: 0 } }]);
});
