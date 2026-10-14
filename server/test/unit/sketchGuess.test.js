import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRunner } from '../../src/games/GameRunner.js';
import { validateGameModule } from '../../src/games/contract.js';
import sketchGuess from '../../src/games/sketch-guess/index.js';
import { find, texts, headline } from '../helpers/screens.js';

const PLAYERS = [
  { id: 'p_aaaa1111', name: 'Alex' },
  { id: 'p_bbbb2222', name: 'Blake' },
  { id: 'p_cccc3333', name: 'Casey' },
];
const [ALEX, BLAKE, CASEY] = PLAYERS.map((p) => p.id);
const DRAWING = [{ color: 'black', points: [100, 100, 900, 600] }];

/** Runs Sketch & Guess through the real GameRunner with mock time; returns helpers. */
function play(t, { rounds, seed = 1, players = PLAYERS } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 1_000_000;
  const delivered = [];
  const ended = [];
  const runner = new GameRunner({
    game: sketchGuess,
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
  /** The artist's secret word, read off their phone. */
  const secretWord = (artist) => texts(latest(artist))[1];
  const draw = (artist, round = 1) => runner.handleAction(artist, { drawing: true, round }, { strokes: DRAWING });
  const guess = (playerId, text, round = 1) => runner.handleAction(playerId, { guess: true, round }, text);
  return { runner, delivered, ended, latest, tick, secretWord, draw, guess, head: (who) => headline(latest(who)) };
}

test('follows the game contract', () => {
  assert.deepEqual(validateGameModule(sketchGuess), []);
});

test('round 1: the first player draws a secret word; nobody else sees it', (t) => {
  const { latest, secretWord, head } = play(t);
  const word = secretWord(ALEX);
  assert.ok(find(latest(ALEX), 'drawPad'), 'Alex has the drawing pad');
  assert.equal(texts(latest(ALEX))[0], 'Your word (keep it secret!):');
  assert.equal(head(BLAKE), 'Alex is drawing…');
  assert.equal(head('host'), 'Alex is drawing…');
  for (const who of [BLAKE, CASEY, 'host']) {
    assert.ok(!JSON.stringify(latest(who)).includes(`"${word}"`), `${who} can't see the word`);
  }
  assert.equal(find(latest('host'), 'timer').endsAt, 1_000_000 + 60_000);
});

test('the drawing goes to everyone; guessers get a text box, the big screen a timer', (t) => {
  const { latest, draw, head } = play(t);
  draw(ALEX);
  assert.deepEqual(find(latest('host'), 'drawing').strokes, DRAWING);
  assert.equal(head('host'), 'What did Alex draw?');
  assert.ok(find(latest(BLAKE), 'textInput'));
  assert.deepEqual(find(latest(BLAKE), 'drawing').strokes, DRAWING);
  assert.equal(find(latest(ALEX), 'textInput'), undefined, 'the artist does not guess');
});

test('wrong guesses: a fresh box for that player, and the guess on the big screen', (t) => {
  const { latest, draw, guess, delivered } = play(t);
  draw(ALEX);
  const before = delivered.length;
  guess(BLAKE, 'definitely not it');
  assert.deepEqual(
    delivered.slice(before).map((d) => d.target.playerId ?? d.target.to),
    [BLAKE, 'host'],
    "nobody else's screen changes",
  );
  assert.ok(texts(latest(BLAKE)).includes('Not “definitely not it”. Try again!'));
  assert.ok(texts(latest('host')).includes('Blake: “definitely not it”?'));
});

test('right guesses score (first 3, then 2), the artist 1 each; spelling and plurals are forgiven', (t) => {
  const { latest, secretWord, draw, guess, head, tick } = play(t, { rounds: 1 });
  const word = secretWord(ALEX);
  draw(ALEX);
  guess(CASEY, `  ${word.toUpperCase()}!! `);
  assert.equal(head(CASEY), 'You got it!');
  assert.equal(find(latest('host'), 'progress').label, '1 of 2 got it');
  guess(BLAKE, `${word.replace(/ /g, '')}s`);
  assert.equal(head('host'), 'The word was', 'everyone got it: reveal right away');
  assert.ok(texts(latest('host')).includes('Got it: Casey, Blake'));
  assert.ok(texts(latest(CASEY)).includes('+3 points'));
  assert.ok(texts(latest(BLAKE)).includes('+2 points'));
  assert.ok(texts(latest(ALEX)).includes('+2 points'));
  tick(6000);
  assert.deepEqual(find(latest('host'), 'scoreboard').rows, [
    { playerId: CASEY, score: 3 },
    { playerId: ALEX, score: 2 },
    { playerId: BLAKE, score: 2 },
  ]);
});

test("guesses from the artist, another round, or after you've got it don't count", (t) => {
  const { latest, secretWord, draw, guess, head } = play(t);
  const word = secretWord(ALEX);
  draw(ALEX);
  guess(ALEX, word);
  guess(BLAKE, word, 2);
  assert.equal(find(latest('host'), 'progress').label, '0 of 2 got it');
  guess(BLAKE, word);
  guess(BLAKE, word); // again
  assert.equal(find(latest('host'), 'progress').label, '1 of 2 got it');
  assert.equal(head(BLAKE), 'You got it!');
});

test('the artist runs out of time: the word is revealed and the next player draws', (t) => {
  const { latest, head, tick } = play(t);
  tick(60_000);
  assert.equal(head('host'), 'The word was');
  assert.ok(texts(latest('host')).includes('Alex ran out of time to draw.'));
  tick(6000);
  assert.ok(find(latest(BLAKE), 'drawPad'), "round 2 is Blake's turn");
});

test('guessing time runs out after 45 s', (t) => {
  const { latest, draw, head, tick } = play(t);
  draw(ALEX);
  tick(44_999);
  assert.ok(find(latest(BLAKE), 'textInput'));
  tick(1);
  assert.equal(head('host'), 'The word was');
  assert.ok(texts(latest('host')).includes('Nobody got it!'));
});

test('an artist who leaves while drawing is skipped', (t) => {
  const { runner, latest } = play(t);
  runner.playerDisconnected(ALEX);
  assert.ok(texts(latest('host')).includes('Alex left, so their turn is skipped.'));
});

test('guessers who leave are not waited for', (t) => {
  const { runner, secretWord, draw, guess, head } = play(t);
  const word = secretWord(ALEX);
  draw(ALEX);
  runner.playerDisconnected(CASEY);
  guess(BLAKE, word);
  assert.equal(head('host'), 'The word was', 'only Blake was left to guess, and Blake got it');
});

test('by default everyone draws once; the game ends with a scoreboard and scores', (t) => {
  const { latest, ended, draw, tick } = play(t);
  for (const [round, artist] of [ALEX, BLAKE, CASEY].entries()) {
    assert.ok(find(latest(artist), 'drawPad'), `round ${round + 1}: ${artist} draws`);
    draw(artist, round + 1);
    tick(45_000); // nobody guesses
    tick(6000); // the reveal (two ticks: mock timers don't run a timer set during the same tick)
  }
  assert.equal(headline(latest('host')), 'Final scores');
  tick(8000);
  assert.equal(ended.length, 1);
  assert.deepEqual(ended[0].scores, { [ALEX]: 0, [BLAKE]: 0, [CASEY]: 0 });
});
