// MAJORITY RULES: guess what the crowd will pick.
//
// Each round, every phone shows the same question with a few answers. When everyone has
// answered (or time runs out), the most popular answer wins: everyone who picked it
// scores a point. If answers tie for most popular, all of them count. Most points after
// the last round wins.
//
// The second example game (plan §11, A4), written to show the patterns the AI generator
// should copy, next to Reaction Race:
//  - All state in a few variables inside createGame; hostView() and playerView(id)
//    describe what each screen shows RIGHT NOW; showEveryone() sends them out.
//  - Every wait for players has a ctx.setTimeout fallback, because people walk away.
//  - Actions carry the round number, and are checked against the current state.
//  - A countdown uses ctx.now(), never Date.
//  - endGame reports scores, so ties are shown as ties.

const DEFAULT_ROUNDS = 3;
const ANSWER_TIME_MS = 20_000; // how long players get to answer
const RESULT_PAUSE_MS = 5_000; // how long a round's result stays up
const FINAL_PAUSE_MS = 6_000; // how long the final scoreboard stays up

const QUESTIONS = [
  { prompt: 'Best pizza topping?', answers: ['Pepperoni', 'Mushrooms', 'Pineapple', 'Just cheese'] },
  { prompt: 'Which superpower would you pick?', answers: ['Flying', 'Invisibility', 'Teleporting', 'Mind reading'] },
  { prompt: 'Best way to spend a snow day?', answers: ['Sledding', 'Movie marathon', 'Sleeping in', 'Snowball fight'] },
  { prompt: 'Which pet would you rather have?', answers: ['Dog', 'Cat', 'Fish', 'Dragon'] },
  { prompt: 'Best time of day?', answers: ['Sunrise', 'Lunchtime', 'Sunset', 'Midnight'] },
  { prompt: 'What would you bring to a desert island?', answers: ['A knife', 'A good book', 'A guitar', 'Sunscreen'] },
];

/** @type {import('../contract.js').GameModule} */
export default {
  contractVersion: 2,
  id: 'majority-rules',
  name: 'Majority Rules',
  description: 'Pick the answer you think most people will pick. Agree with the crowd to score!',
  minPlayers: 2,
  maxPlayers: 12,

  createGame(ctx, options) {
    const rounds = Number.isInteger(options.rounds) && options.rounds >= 1 && options.rounds <= 6 ? options.rounds : DEFAULT_ROUNDS;
    // Shuffle the questions with ctx.random (repeatable in tests), then use the first few.
    const questions = [...QUESTIONS];
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }

    // --- State ---------------------------------------------------------------------
    let round = 1;
    /** @type {'answering' | 'result' | 'final'} */
    let phase = 'answering';
    let endsAt = 0; // when answering closes (server time, from ctx.now())
    /** @type {Record<string, number>} points per player id */
    const scores = Object.fromEntries(ctx.players.map((p) => [p.id, 0]));
    /** @type {Map<string, number>} this round: player id → index of the answer they picked */
    let picks = new Map();
    /** @type {number[]} this round's winning answer indexes (several if tied; empty if nobody answered) */
    let winners = [];
    /** players who are disconnected right now (don't wait for them) */
    const away = new Set();
    let timer = null; // the one pending ctx timer

    const question = () => questions[round - 1];
    const present = () => ctx.players.filter((p) => !away.has(p.id));

    // --- What each screen shows right now ------------------------------------------

    function standings() {
      // Most points first; ties keep join order (sort is stable).
      return ctx.players.map((p) => p.id).sort((a, b) => scores[b] - scores[a]);
    }

    function scoreboard(title) {
      return { view: 'scoreboard', title, rows: standings().map((id) => ({ playerId: id, score: scores[id] })) };
    }

    function winningText() {
      return winners.map((i) => question().answers[i]).join(' & ');
    }

    function hostView() {
      if (phase === 'final') return scoreboard('Final scores');
      if (phase === 'result') {
        if (winners.length === 0) return { view: 'message', title: 'Nobody answered!', text: 'On to the next one.' };
        const scorers = ctx.players.filter((p) => winners.includes(picks.get(p.id))).length;
        return {
          view: 'message',
          title: `The crowd picked: ${winningText()}`,
          text: `${scorers} player${scorers === 1 ? '' : 's'} scored a point.`,
          asset: 'trophy',
        };
      }
      const answered = present().filter((p) => picks.has(p.id)).length;
      return {
        view: 'countdown',
        title: `Round ${round}/${rounds}: ${question().prompt} (${answered}/${present().length} answered)`,
        endsAt,
      };
    }

    function playerView(playerId) {
      if (phase === 'final') return scoreboard('Final scores');
      if (phase === 'result') {
        if (winners.length === 0) return { view: 'message', title: 'Nobody answered!' };
        return winners.includes(picks.get(playerId))
          ? { view: 'message', title: 'You agreed with the crowd!', text: `+1 point for ${winningText()}`, asset: 'trophy' }
          : { view: 'message', title: `The crowd picked ${winningText()}`, text: 'No point this time.' };
      }
      if (picks.has(playerId)) {
        return { view: 'message', title: 'Answer locked in!', text: 'Waiting for everyone else…' };
      }
      return {
        view: 'choice',
        prompt: question().prompt,
        // The action carries the round, so a late tap from an old round is ignored.
        options: question().answers.map((label, answer) => ({ label, action: { answer, round } })),
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
      phase = 'answering';
      picks = new Map();
      winners = [];
      endsAt = ctx.now() + ANSWER_TIME_MS;
      showEveryone();
      after(ANSWER_TIME_MS, finishRound); // fallback: never wait forever
    }

    /** Ends the round early once everyone who is here has answered. */
    function finishIfEveryoneAnswered() {
      if (phase === 'answering' && present().length > 0 && present().every((p) => picks.has(p.id))) finishRound();
    }

    function finishRound() {
      phase = 'result';
      const counts = question().answers.map(() => 0);
      for (const answer of picks.values()) counts[answer]++;
      const best = Math.max(...counts);
      winners = best === 0 ? [] : counts.flatMap((count, i) => (count === best ? [i] : []));
      for (const [playerId, answer] of picks) if (winners.includes(answer)) scores[playerId]++;
      showEveryone();

      after(RESULT_PAUSE_MS, () => {
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
      onAction(playerId, action) {
        // Untrusted input: only an answer for THIS round, in range, from someone who hasn't answered.
        if (phase !== 'answering' || action.round !== round || picks.has(playerId)) return;
        const { answer } = action;
        if (!Number.isInteger(answer) || answer < 0 || answer >= question().answers.length) return;
        picks.set(playerId, answer);
        ctx.sendToPlayer(playerId, playerView(playerId));
        ctx.sendToHost(hostView()); // the answered count went up
        finishIfEveryoneAnswered();
      },

      onPlayerDisconnect(playerId) {
        away.add(playerId);
        if (phase === 'answering') {
          ctx.sendToHost(hostView());
          finishIfEveryoneAnswered();
        }
      },

      onPlayerReconnect(playerId) {
        away.delete(playerId); // the platform puts their latest view back on their screen
        if (phase === 'answering') ctx.sendToHost(hostView());
      },
    };
  },
};
