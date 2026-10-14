// FILL THE BLANK: everyone writes an answer, then everyone votes for the funniest
// (plan §12, K4).
//
// Each round shows a prompt with a blank ("The worst thing to bring to a picnic: ___").
// Everyone types an answer on their phone. Then all the answers appear, without names,
// and everyone votes for their favorite (not their own). Each vote is a point, and the
// reveal shows who wrote what.
//
// What it shows about the kit (an example for the AI generator):
//  - textInput for free answers, then a choice built from those answers
//  - different screens per player: you can't vote for your own answer, so your choice
//    leaves it out (the platform then drops a forged vote for it, too)
//  - two waits per round (writing, voting), each with a timer and "everyone's done" check
//  - a reveal built from cards: answer, author, votes (kept small: 12 answers must fit in
//    one screen's 60 blocks)

const WRITE_TIME_MS = 60_000;
const VOTE_TIME_MS = 30_000;
const REVEAL_PAUSE_MS = 8000;
const FINAL_PAUSE_MS = 8000;
const DEFAULT_ROUNDS = 3;

const PROMPTS = [
  'The worst thing to bring to a picnic: ___',
  'A terrible name for a pet goldfish: ___',
  "What's really at the bottom of the ocean: ___",
  'The secret ingredient in the dining hall food: ___',
  'A rejected flavor of ice cream: ___',
  'The worst thing to hear from your pilot: ___',
  'A strange thing to find in your backpack: ___',
  'The real reason the dinosaurs went extinct: ___',
  'A bad slogan for a dentist: ___',
  'What aliens think humans do for fun: ___',
  'The worst superpower: ___',
  'A weird thing to say at a job interview: ___',
  'A new Olympic sport nobody asked for: ___',
  'The first thing a robot would buy: ___',
  'A terrible theme for a birthday party: ___',
  "What your cat is thinking right now: ___",
  'The worst thing to yell in a library: ___',
  'A rejected name for a new planet: ___',
  'Something you should never microwave: ___',
  'The title of your autobiography: ___',
];

/** @type {import('../contract.js').GameModule} */
export default {
  contractVersion: 3,
  id: 'fill-the-blank',
  name: 'Fill the Blank',
  description: 'Everyone writes the funniest answer to a prompt, then votes for their favorite. Each vote is a point.',
  minPlayers: 3,
  maxPlayers: 12,

  createGame(ctx, options) {
    const rounds = Number.isInteger(options.rounds) && options.rounds >= 1 && options.rounds <= 5 ? options.rounds : DEFAULT_ROUNDS;
    const nameOf = Object.fromEntries(ctx.players.map((p) => [p.id, p.name]));

    // Shuffle the prompts with ctx.random (repeatable in tests); round N uses prompts[N - 1].
    const prompts = [...PROMPTS];
    for (let i = prompts.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [prompts[i], prompts[j]] = [prompts[j], prompts[i]];
    }

    // --- State ---------------------------------------------------------------------
    let round = 1;
    /** @type {'writing' | 'voting' | 'reveal' | 'final'} */
    let phase = 'writing';
    let endsAt = 0;
    let phaseLength = WRITE_TIME_MS;
    /** @type {Map<string, string>} this round: author id → answer */
    let answers = new Map();
    /** @type {{ author: string, text: string }[]} this round's answers in voting order (shuffled) */
    let ballot = [];
    /** @type {Map<string, number>} this round: voter id → ballot index */
    let votes = new Map();
    /** @type {Record<string, number>} points per player id */
    const scores = Object.fromEntries(ctx.players.map((p) => [p.id, 0]));
    const away = new Set();
    let timer = null;

    const prompt = () => prompts[round - 1];
    const here = () => ctx.players.filter((p) => !away.has(p.id));
    const votesFor = (i) => [...votes.values()].filter((v) => v === i).length;
    /** Ballot indexes this player may vote for: everything but their own answer. */
    const choicesFor = (playerId) => ballot.flatMap((entry, i) => (entry.author === playerId ? [] : [i]));
    /** Players who can vote this round (anyone with at least one answer that isn't theirs). */
    const voters = () => here().filter((p) => choicesFor(p.id).length > 0);

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
    const promptText = (size = 'big') => ({ type: 'text', text: prompt(), size, bold: true });
    const timerBar = () => ({ type: 'timer', startedAt: endsAt - phaseLength, endsAt, style: 'bar' });
    /** Answers sit in a grid on the big screen, so even 12 of them fit without scrolling. */
    const answerGrid = (cards) => ({ type: 'grid', columns: ballot.length > 6 ? 3 : 2, children: cards });

    function hostView() {
      if (phase === 'final') return finalScores();
      if (phase === 'writing') {
        const done = here().filter((p) => answers.has(p.id)).length;
        return {
          blocks: [
            roundLine(),
            promptText('huge'),
            { type: 'text', text: 'Write your answer on your phone!' },
            timerBar(),
            { type: 'progress', value: done, max: Math.max(1, here().length), label: `${done} of ${here().length} answered` },
          ],
        };
      }
      if (phase === 'voting') {
        const done = voters().filter((p) => votes.has(p.id)).length;
        return {
          blocks: [
            roundLine(),
            promptText(),
            answerGrid(ballot.map((entry) => ({ type: 'card', children: [{ type: 'text', text: entry.text, size: 'big' }] }))),
            { type: 'text', text: 'Vote for your favorite on your phone!' },
            timerBar(),
            { type: 'progress', value: done, max: Math.max(1, voters().length), label: `${done} of ${voters().length} voted` },
          ],
        };
      }
      // reveal: most votes first
      if (ballot.length < 2) {
        return { blocks: [roundLine(), promptText(), { type: 'text', text: 'Not enough answers to vote on this time!', size: 'big' }] };
      }
      const order = ballot.map((_, i) => i).sort((a, b) => votesFor(b) - votesFor(a));
      const top = votesFor(order[0]);
      return {
        blocks: [
          roundLine(),
          promptText(),
          answerGrid(
            order.map((i) => ({
              type: 'card',
              tone: top > 0 && votesFor(i) === top ? 'good' : 'normal',
              // Three blocks per answer, so 12 answers stay under the 60-blocks-per-screen limit.
              children: [
                { type: 'text', text: ballot[i].text, size: 'big', bold: true },
                { type: 'text', text: `by ${nameOf[ballot[i].author]} · ${votesFor(i)} vote${votesFor(i) === 1 ? '' : 's'}`, tone: 'muted' },
              ],
            })),
          ),
        ],
      };
    }

    function playerView(playerId) {
      if (phase === 'final') return finalScores();
      if (phase === 'writing') {
        if (answers.has(playerId)) {
          return {
            blocks: [
              roundLine(),
              { type: 'text', text: 'Answer in!', size: 'big', tone: 'good', bold: true },
              { type: 'card', children: [{ type: 'text', text: answers.get(playerId) }] },
              { type: 'text', text: 'Waiting for everyone else…', tone: 'muted' },
            ],
          };
        }
        return {
          blocks: [
            roundLine(),
            promptText(),
            timerBar(),
            // The round number in the action: an answer from an old round is ignored.
            { type: 'textInput', placeholder: 'Your answer', maxLength: 60, action: { answer: true, round } },
          ],
        };
      }
      if (phase === 'voting') {
        const mine = choicesFor(playerId);
        if (votes.has(playerId) || mine.length === 0) {
          return { blocks: [roundLine(), { type: 'text', text: votes.has(playerId) ? 'Vote in!' : 'Sit back: nothing to vote on.', size: 'big', bold: true }, timerBar()] };
        }
        return {
          blocks: [
            roundLine(),
            promptText('normal'),
            { type: 'text', text: 'Which answer is funniest?', size: 'big', bold: true },
            timerBar(),
            { type: 'choice', options: mine.map((i) => ({ label: ballot[i].text, action: { vote: i, round } })) },
          ],
        };
      }
      // reveal
      const mineIndex = ballot.findIndex((entry) => entry.author === playerId);
      const got = mineIndex === -1 ? null : votesFor(mineIndex);
      return {
        blocks: [
          roundLine(),
          {
            type: 'text',
            text: got === null ? 'You sat this one out.' : `Your answer got ${got} vote${got === 1 ? '' : 's'}!`,
            size: 'big',
            tone: got ? 'good' : 'normal',
            bold: true,
          },
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
      phase = 'writing';
      answers = new Map();
      ballot = [];
      votes = new Map();
      phaseLength = WRITE_TIME_MS;
      endsAt = ctx.now() + WRITE_TIME_MS;
      showEveryone();
      after(WRITE_TIME_MS, startVoting); // fallback: never wait forever
    }

    function startVoting() {
      // Shuffle the answers, so the order doesn't give away who wrote what.
      ballot = [...answers].map(([author, text]) => ({ author, text }));
      for (let i = ballot.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.random() * (i + 1));
        [ballot[i], ballot[j]] = [ballot[j], ballot[i]];
      }
      if (ballot.length < 2) return reveal(); // nothing to choose between
      phase = 'voting';
      phaseLength = VOTE_TIME_MS;
      endsAt = ctx.now() + VOTE_TIME_MS;
      showEveryone();
      after(VOTE_TIME_MS, reveal);
    }

    function reveal() {
      phase = 'reveal';
      for (const i of votes.values()) scores[ballot[i].author]++;
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

    /** Moves on early once everyone who is here is done with the current step. */
    function moveOnIfEveryoneIsDone() {
      if (phase === 'writing' && here().length > 0 && here().every((p) => answers.has(p.id))) startVoting();
      else if (phase === 'voting' && voters().every((p) => votes.has(p.id))) reveal();
    }

    startRound();

    return {
      onAction(playerId, action, input) {
        if (action.round !== round) return; // from an earlier round
        if (action.answer === true) {
          // The platform already trimmed the text and checked its length.
          if (phase !== 'writing' || answers.has(playerId)) return;
          answers.set(playerId, input);
          ctx.sendToPlayer(playerId, playerView(playerId));
          ctx.sendToHost(hostView()); // the answered count went up
        } else if (Number.isInteger(action.vote)) {
          if (phase !== 'voting' || votes.has(playerId) || !choicesFor(playerId).includes(action.vote)) return;
          votes.set(playerId, action.vote);
          ctx.sendToPlayer(playerId, playerView(playerId));
          ctx.sendToHost(hostView());
        } else {
          return;
        }
        moveOnIfEveryoneIsDone();
      },

      onPlayerDisconnect(playerId) {
        away.add(playerId);
        if (phase === 'writing' || phase === 'voting') {
          ctx.sendToHost(hostView());
          moveOnIfEveryoneIsDone();
        }
      },

      onPlayerReconnect(playerId) {
        away.delete(playerId);
      },
    };
  },
};
