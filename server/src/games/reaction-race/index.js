// REACTION RACE: the demo game (plan §4c), rebuilt on the reaction widget (plan §12, K4).
//
// Each round: everyone waits, then after a random 2–5 seconds the screens say GO.
// The fastest reaction wins the round. Tapping before GO is a false start: no time for
// you this round. Most round wins after all rounds wins the game.
//
// How it's built (a pattern worth copying for other games):
//  - All game state lives in a few variables inside createGame.
//  - hostView() and playerView(id) describe what each screen should show RIGHT NOW,
//    based only on that state, as a list of blocks (text, image, widget, scoreboard…).
//  - Whenever the state changes, showEveryone() sends those screens out.
//  - A refreshed phone or host screen needs nothing from us: the platform remembers
//    the latest screen on each and sends it again.
//
// Fairness: each phone measures its own reaction time (the `reaction` widget), from the
// moment GO appears on it to the tap. So a phone on slow Wi-Fi isn't at a disadvantage.
// The platform rejects impossible times (under 80 ms, or arriving before GO).
//
// Careful with widgets: re-sending a phone's screen restarts its widget. So at GO only the
// big screen changes; each phone gets a new screen once its own result is in.

const DEFAULT_ROUNDS = 5;
const GO_DELAY_MIN_MS = 2000; // shortest wait before GO
const GO_DELAY_MAX_MS = 5000; // longest wait before GO
const TAP_WINDOW_MS = 5000; // after GO, how long to wait for everyone's result
const RESULT_PAUSE_MS = 4000; // how long a round's result stays up
const FINAL_PAUSE_MS = 6000; // how long the final scoreboard stays up before the lobby

/** @type {import('../contract.js').GameModule} */
export default {
  contractVersion: 3,
  id: 'reaction-race',
  name: 'Reaction Race',
  description: 'Wait for GO, then tap as fast as you can. Your phone times you. Tap too early and you sit out the round.',
  minPlayers: 1,
  maxPlayers: 12,

  createGame(ctx, options) {
    // options.rounds (1–10) is mostly for tests; the host picker uses the default.
    const rounds = Number.isInteger(options.rounds) && options.rounds >= 1 && options.rounds <= 10 ? options.rounds : DEFAULT_ROUNDS;
    const nameOf = Object.fromEntries(ctx.players.map((p) => [p.id, p.name]));

    // --- State ---------------------------------------------------------------------
    let round = 1;
    /** @type {'ready' | 'go' | 'result' | 'final'} */
    let phase = 'ready';
    let goAt = 0; // when GO shows this round (server time)
    /** @type {Record<string, number>} round wins per player id */
    const scores = Object.fromEntries(ctx.players.map((p) => [p.id, 0]));
    /** @type {Map<string, { ms: number } | { early: true }>} this round's results, in arrival order */
    let results = new Map();
    /** @type {string | null} who won the current round (null = nobody) */
    let roundWinner = null;
    /** players currently disconnected (they can't tap, so don't wait for them) */
    const away = new Set();
    let timer = null; // the one pending ctx timer, if any

    // --- What each screen shows right now ------------------------------------------

    function standings() {
      // Highest score first; ties keep join order (sort is stable).
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

    /** A small "Round 2 of 5" line at the top of every in-round screen. */
    const roundLine = () => ({ type: 'text', text: `Round ${round} of ${rounds}`, tone: 'muted' });

    /** How one player did this round, in words. */
    function resultText(id) {
      const r = results.get(id);
      if (!r) return 'no tap';
      return 'early' in r ? 'too soon!' : `${r.ms} ms`;
    }

    /** Everyone's times this round, fastest first, then false starts and no-shows. */
    function timesList() {
      const order = (id) => {
        const r = results.get(id);
        return !r ? 20_000 : 'early' in r ? 10_001 : r.ms;
      };
      const ids = ctx.players.map((p) => p.id).sort((a, b) => order(a) - order(b));
      return {
        type: 'card',
        children: ids.map((id) => ({
          type: 'row',
          gap: 'big',
          children: [
            { type: 'playerName', playerId: id, tone: id === roundWinner ? 'good' : 'normal' },
            { type: 'text', text: resultText(id), tone: id === roundWinner ? 'good' : 'muted' },
          ],
        })),
      };
    }

    function hostView() {
      switch (phase) {
        case 'ready':
          return { blocks: [roundLine(), { type: 'text', text: 'Get ready…', size: 'huge', bold: true }, { type: 'text', text: 'Wait for GO!', size: 'big' }] };
        case 'go': {
          const tapped = ctx.players.filter((p) => results.has(p.id)).length;
          return {
            blocks: [
              roundLine(),
              { type: 'image', asset: 'go-sign', size: 'big' },
              { type: 'text', text: 'GO!', size: 'huge', tone: 'good', bold: true },
              { type: 'progress', value: tapped, max: ctx.players.length, label: `${tapped} of ${ctx.players.length} tapped` },
            ],
          };
        }
        case 'result':
          return {
            blocks: [
              roundLine(),
              roundWinner
                ? { type: 'text', text: `${nameOf[roundWinner]} wins round ${round}!`, size: 'huge', bold: true }
                : { type: 'text', text: 'Nobody got a time!', size: 'huge', bold: true },
              timesList(),
            ],
          };
        case 'final':
          return finalScores();
      }
    }

    function playerView(playerId) {
      if (phase === 'final') return finalScores();
      const yourWins = { type: 'text', text: `Your wins: ${scores[playerId]}`, tone: 'muted' };
      if (phase === 'result') {
        const headline = !roundWinner
          ? 'Nobody got a time!'
          : roundWinner === playerId
            ? 'You won this round!'
            : `${nameOf[roundWinner]} was fastest!`;
        return {
          blocks: [
            ...(roundWinner === playerId ? [{ type: 'image', asset: 'trophy' }] : []),
            { type: 'text', text: headline, size: 'big', tone: roundWinner === playerId ? 'good' : 'normal', bold: true },
            { type: 'text', text: `Your time: ${resultText(playerId)}` },
            yourWins,
          ],
        };
      }
      const mine = results.get(playerId);
      if (mine && 'early' in mine) {
        return {
          blocks: [roundLine(), { type: 'text', text: 'Too soon!', size: 'big', tone: 'bad', bold: true }, { type: 'text', text: 'You tapped before GO. Wait for the next round.' }, yourWins],
        };
      }
      if (mine) {
        return { blocks: [roundLine(), { type: 'text', text: `${mine.ms} ms`, size: 'huge', bold: true }, { type: 'text', text: 'Waiting for the others…', tone: 'muted' }, yourWins] };
      }
      // The action carries the round number, so a result from a previous round is ignored.
      return { blocks: [roundLine(), { type: 'reaction', goAt, action: { tap: true, round } }, yourWins] };
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
      phase = 'ready';
      results = new Map();
      roundWinner = null;
      const delay = GO_DELAY_MIN_MS + ctx.random() * (GO_DELAY_MAX_MS - GO_DELAY_MIN_MS);
      goAt = ctx.now() + delay;
      showEveryone();
      after(delay, () => {
        phase = 'go';
        ctx.sendToHost(hostView()); // only the big screen: phones' widgets switch to GO by themselves
        after(TAP_WINDOW_MS, finishRound);
      });
    }

    /** Ends the round as soon as every player who is here has a result. */
    function finishIfEveryoneIsIn() {
      const here = ctx.players.filter((p) => !away.has(p.id));
      if (here.length > 0 && here.every((p) => results.has(p.id))) finishRound();
    }

    function finishRound() {
      phase = 'result';
      // Fastest valid time wins; on an exact tie, whoever's result arrived first.
      let best = null;
      for (const [id, r] of results) {
        if ('ms' in r && (best === null || r.ms < results.get(best).ms)) best = id;
      }
      roundWinner = best;
      if (best) scores[best]++;
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
      onAction(playerId, action, input) {
        // The platform already checked `input` is { ms } or { early: true }. Still: only
        // this round, only while it's running, and only one result per player.
        if (action.round !== round || (phase !== 'ready' && phase !== 'go') || results.has(playerId)) return;
        results.set(playerId, input);
        ctx.sendToPlayer(playerId, playerView(playerId));
        if (phase === 'go') ctx.sendToHost(hostView()); // the "tapped" count went up
        finishIfEveryoneIsIn();
      },

      onPlayerDisconnect(playerId) {
        away.add(playerId);
        if (phase === 'ready' || phase === 'go') finishIfEveryoneIsIn();
      },

      onPlayerReconnect(playerId) {
        away.delete(playerId); // the platform puts their latest screen back on their phone
      },
    };
  },
};
