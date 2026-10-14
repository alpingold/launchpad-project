// SKETCH & GUESS: one player draws a secret word, everyone else guesses it (plan §12, K4).
//
// Each round a different player is the artist. They get a word and a drawPad; when they
// send the drawing, it appears on the big screen and every other phone, and the others
// type guesses until they get it or time runs out. Wrong guesses show up on the big
// screen (half the fun). Points: a right guess scores 2 (3 if you're first), and the
// artist scores 1 for every player who got it.
//
// What it shows about the kit (an example for the AI generator):
//  - drawPad on one phone, drawing blocks everywhere else; textInput for guesses
//  - per-player screens: the artist sees the word, nobody else does
//  - a wrong guess re-sends only THAT player's screen (a fresh text box) and the big
//    screen, not everyone's: each screen gets a new screen only when it changes
//  - every wait has a timer: the artist may never finish, guessers may never get it

const DRAW_TIME_MS = 60_000;
const GUESS_TIME_MS = 45_000;
const REVEAL_PAUSE_MS = 6000;
const FINAL_PAUSE_MS = 8000;
const MAX_ROUNDS = 8;

const WORDS = [
  'cat', 'house', 'pizza', 'rocket', 'snowman', 'guitar', 'tree', 'bicycle', 'sun', 'fish',
  'robot', 'castle', 'banana', 'spider', 'rainbow', 'train', 'cupcake', 'dragon', 'umbrella', 'volcano',
  'ghost', 'airplane', 'turtle', 'crown', 'moon', 'ice cream', 'octopus', 'ladder', 'tent', 'candle',
  'skateboard', 'whale', 'cactus', 'basketball', 'penguin', 'lighthouse', 'sandwich', 'butterfly', 'clock', 'mermaid',
];

/** Letters and digits only, lowercase: "Ice-Cream!" and "icecream" are the same guess. */
const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Right if it's the word, or the word with/without a plural "s". */
function isRight(guess, word) {
  const g = normalize(guess);
  const w = normalize(word);
  return g === w || g === `${w}s` || `${g}s` === w;
}

/** @type {import('../contract.js').GameModule} */
export default {
  contractVersion: 3,
  id: 'sketch-guess',
  name: 'Sketch & Guess',
  description: 'Take turns drawing a secret word on your phone while everyone else races to guess it.',
  minPlayers: 2,
  maxPlayers: 12,

  createGame(ctx, options) {
    // By default everyone draws once (up to 8 rounds). options.rounds is mostly for tests.
    const defaultRounds = Math.min(ctx.players.length, MAX_ROUNDS);
    const rounds = Number.isInteger(options.rounds) && options.rounds >= 1 && options.rounds <= MAX_ROUNDS ? options.rounds : defaultRounds;
    const nameOf = Object.fromEntries(ctx.players.map((p) => [p.id, p.name]));

    // Shuffle the words with ctx.random (repeatable in tests); round N uses words[N - 1].
    const words = [...WORDS];
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }

    // --- State ---------------------------------------------------------------------
    let round = 1;
    /** @type {'drawing' | 'guessing' | 'reveal' | 'final'} */
    let phase = 'drawing';
    let endsAt = 0; // when the current drawing/guessing time runs out (server time)
    let phaseLength = DRAW_TIME_MS;
    /** @type {{ color: string, points: number[] }[] | null} this round's drawing */
    let strokes = null;
    /** @type {string[]} this round's right guessers, in order */
    let solvedBy = [];
    /** @type {Map<string, string>} each guesser's latest wrong guess this round */
    let lastWrong = new Map();
    /** @type {{ name: string, guess: string }[]} the latest wrong guesses, for the big screen */
    let wrongFeed = [];
    let revealNote = ''; // why the round ended, if it's worth saying
    /** @type {Record<string, number>} points per player id */
    const scores = Object.fromEntries(ctx.players.map((p) => [p.id, 0]));
    const away = new Set();
    let timer = null;

    const artist = () => ctx.players[(round - 1) % ctx.players.length].id;
    const word = () => words[(round - 1) % words.length];
    const guessers = () => ctx.players.filter((p) => p.id !== artist());

    // --- What each screen shows right now ------------------------------------------

    function standings() {
      return ctx.players.map((p) => p.id).sort((a, b) => scores[b] - scores[a]);
    }

    function finalScores() {
      return {
        blocks: [
          { type: 'text', text: 'Final scores', size: 'big', bold: true },
          { type: 'scoreboard', rows: standings().map((id) => ({ playerId: id, score: scores[id] })) },
        ],
      };
    }

    const roundLine = () => ({ type: 'text', text: `Round ${round} of ${rounds}`, tone: 'muted' });
    const timerBar = () => ({ type: 'timer', startedAt: endsAt - phaseLength, endsAt, style: 'bar' });
    const theDrawing = (size) => ({ type: 'drawing', strokes, size });

    function guessedCount() {
      const total = guessers().length;
      return { type: 'progress', value: solvedBy.length, max: Math.max(1, total), label: `${solvedBy.length} of ${total} got it`, tone: 'good' };
    }

    function hostView() {
      if (phase === 'final') return finalScores();
      if (phase === 'drawing') {
        return {
          blocks: [roundLine(), { type: 'text', text: `${nameOf[artist()]} is drawing…`, size: 'huge', bold: true }, timerBar()],
        };
      }
      if (phase === 'guessing') {
        return {
          blocks: [
            roundLine(),
            { type: 'text', text: `What did ${nameOf[artist()]} draw?`, size: 'big', bold: true },
            theDrawing('normal'), // 'big' pushes the guesses below the bottom of a laptop screen
            timerBar(),
            guessedCount(),
            ...(wrongFeed.length
              ? [{ type: 'row', children: wrongFeed.map((w) => ({ type: 'text', text: `${w.name}: “${w.guess}”?`, tone: 'muted' })) }]
              : []),
          ],
        };
      }
      // reveal
      return {
        blocks: [
          roundLine(),
          { type: 'text', text: 'The word was', size: 'big' },
          { type: 'text', text: word(), size: 'huge', bold: true, tone: 'accent' },
          ...(strokes ? [theDrawing('normal')] : []),
          { type: 'text', text: revealNote || (solvedBy.length ? `Got it: ${solvedBy.map((id) => nameOf[id]).join(', ')}` : 'Nobody got it!') },
        ],
      };
    }

    function playerView(playerId) {
      if (phase === 'final') return finalScores();
      const isArtist = playerId === artist();
      if (phase === 'drawing') {
        if (isArtist) {
          return {
            blocks: [
              { type: 'text', text: 'Your word (keep it secret!):', tone: 'muted' },
              { type: 'text', text: word(), size: 'big', bold: true },
              timerBar(),
              // The round number in the action: a drawing from an old round is ignored.
              { type: 'drawPad', colors: ['black', 'red', 'blue', 'green', 'yellow', 'brown'], submitLabel: 'Done!', action: { drawing: true, round } },
            ],
          };
        }
        return { blocks: [roundLine(), { type: 'text', text: `${nameOf[artist()]} is drawing…`, size: 'big', bold: true }, { type: 'text', text: 'Get ready to guess!', tone: 'muted' }, timerBar()] };
      }
      if (phase === 'guessing') {
        if (isArtist) {
          return { blocks: [theDrawing('normal'), { type: 'text', text: 'Everyone is guessing your drawing…', bold: true }, guessedCount(), timerBar()] };
        }
        if (solvedBy.includes(playerId)) {
          return {
            blocks: [theDrawing('small'), { type: 'text', text: 'You got it!', size: 'big', tone: 'good', bold: true }, { type: 'text', text: `It's “${word()}”.` }, guessedCount()],
          };
        }
        const wrong = lastWrong.get(playerId);
        return {
          blocks: [
            theDrawing('normal'),
            timerBar(),
            ...(wrong ? [{ type: 'text', text: `Not “${wrong}”. Try again!`, tone: 'bad' }] : []),
            { type: 'textInput', placeholder: 'Your guess', maxLength: 40, submitLabel: 'Guess', action: { guess: true, round } },
          ],
        };
      }
      // reveal: what this round earned you
      const points = solvedBy.includes(playerId) ? (solvedBy[0] === playerId ? 3 : 2) : isArtist ? solvedBy.length : 0;
      return {
        blocks: [
          { type: 'text', text: 'The word was', tone: 'muted' },
          { type: 'text', text: word(), size: 'big', bold: true },
          { type: 'text', text: points ? `+${points} point${points === 1 ? '' : 's'}` : 'No points this time.', tone: points ? 'good' : 'muted' },
          { type: 'text', text: `Your score: ${scores[playerId]}`, tone: 'muted' },
        ],
      };
    }

    function showEveryone() {
      ctx.sendToHost(hostView());
      for (const p of ctx.players) ctx.sendToPlayer(p.id, playerView(p.id));
    }

    // --- Moving between phases -----------------------------------------------------

    function after(ms, fn) {
      ctx.clearTimeout(timer);
      timer = ctx.setTimeout(fn, ms);
    }

    function startRound() {
      phase = 'drawing';
      strokes = null;
      solvedBy = [];
      lastWrong = new Map();
      wrongFeed = [];
      revealNote = '';
      phaseLength = DRAW_TIME_MS;
      endsAt = ctx.now() + DRAW_TIME_MS;
      // An artist who left can't draw: skip their turn.
      if (away.has(artist())) return reveal(`${nameOf[artist()]} isn't here, so their turn is skipped.`);
      showEveryone();
      after(DRAW_TIME_MS, () => reveal(`${nameOf[artist()]} ran out of time to draw.`));
    }

    function startGuessing() {
      phase = 'guessing';
      phaseLength = GUESS_TIME_MS;
      endsAt = ctx.now() + GUESS_TIME_MS;
      showEveryone();
      after(GUESS_TIME_MS, () => reveal());
    }

    /** Ends guessing early once every guesser who is here has it. */
    function revealIfEveryoneGotIt() {
      const here = guessers().filter((p) => !away.has(p.id));
      if (phase === 'guessing' && here.every((p) => solvedBy.includes(p.id))) reveal();
    }

    function reveal(note = '') {
      phase = 'reveal';
      revealNote = note;
      showEveryone();
      after(REVEAL_PAUSE_MS, () => {
        if (round < rounds) {
          round++;
          startRound();
        } else {
          phase = 'final';
          showEveryone();
          after(FINAL_PAUSE_MS, () => ctx.endGame({ rankings: standings(), scores }));
        }
      });
    }

    startRound();

    return {
      onAction(playerId, action, input) {
        if (action.round !== round) return; // something from an earlier round

        if (action.drawing === true) {
          // The platform already checked the drawing's format and colors.
          if (phase !== 'drawing' || playerId !== artist()) return;
          strokes = input.strokes;
          startGuessing();
          return;
        }

        if (action.guess === true) {
          if (phase !== 'guessing' || playerId === artist() || solvedBy.includes(playerId)) return;
          if (isRight(input, word())) {
            scores[playerId] += solvedBy.length === 0 ? 3 : 2;
            scores[artist()] += 1;
            solvedBy.push(playerId);
            ctx.sendToPlayer(playerId, playerView(playerId));
            ctx.sendToPlayer(artist(), playerView(artist())); // their "got it" count went up
            ctx.sendToHost(hostView());
            revealIfEveryoneGotIt();
          } else {
            lastWrong.set(playerId, input);
            wrongFeed = [...wrongFeed, { name: nameOf[playerId], guess: input }].slice(-4);
            ctx.sendToPlayer(playerId, playerView(playerId)); // "Not X. Try again!" and a fresh box
            ctx.sendToHost(hostView());
          }
        }
      },

      onPlayerDisconnect(playerId) {
        away.add(playerId);
        if (phase === 'drawing' && playerId === artist()) reveal(`${nameOf[playerId]} left, so their turn is skipped.`);
        else revealIfEveryoneGotIt();
      },

      onPlayerReconnect(playerId) {
        away.delete(playerId);
      },
    };
  },
};
