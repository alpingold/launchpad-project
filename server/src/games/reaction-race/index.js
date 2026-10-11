// REACTION RACE: the demo game (plan §4c).
//
// Each round: everyone waits, then after a random 2–5 seconds the screens say GO.
// The first player whose tap reaches the server wins the round. Tapping before GO
// is a false start: you sit out the rest of that round. Most round wins after
// all rounds wins the game.
//
// How it's built (a pattern worth copying for other games):
//  - All game state lives in a few variables inside createGame.
//  - hostView() and playerView(id) describe what each screen should show RIGHT NOW,
//    based only on that state.
//  - Whenever the state changes, showEveryone() sends those views out.
//  - A refreshed phone or host screen just gets its current view again.
//
// Fairness note: "first" means first to arrive at the server. A phone on slower Wi-Fi
// is slightly disadvantaged. Fine for a demo; a real reaction minigame might measure
// time on the phone instead (and then have to trust it, which brings its own problems).

const DEFAULT_ROUNDS = 5;
const GO_DELAY_MIN_MS = 2000; // shortest wait before GO
const GO_DELAY_MAX_MS = 5000; // longest wait before GO
const ROUND_TIMEOUT_MS = 10_000; // nobody tapped after GO: move on
const RESULT_PAUSE_MS = 2500; // how long a round's result stays up
const FINAL_PAUSE_MS = 6000; // how long the final scoreboard stays up before the lobby

/** @type {import('../contract.js').GameModule} */
export default {
  id: 'reaction-race',
  name: 'Reaction Race',
  description: 'Wait for GO, then tap as fast as you can. Tap too early and you sit out the round.',
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
    /** @type {Record<string, number>} round wins per player id */
    const scores = Object.fromEntries(ctx.players.map((p) => [p.id, 0]));
    /** players who tapped before GO this round */
    let falseStarts = new Set();
    /** @type {string | null} who won the current round (null = nobody) */
    let roundWinner = null;
    /** @type {'timeout' | 'false-starts'} why a round had no winner */
    let noWinnerReason = 'timeout';
    /** players currently disconnected (they can't tap, so don't wait for them) */
    const away = new Set();
    let timer = null; // the one pending ctx timer, if any

    // --- What each screen shows right now ------------------------------------------

    function standings() {
      // Highest score first; ties keep join order (sort is stable).
      return ctx.players.map((p) => p.id).sort((a, b) => scores[b] - scores[a]);
    }

    function scoreboard(title) {
      return { view: 'scoreboard', title, rows: standings().map((id) => ({ playerId: id, score: scores[id] })) };
    }

    function hostView() {
      switch (phase) {
        case 'ready':
          return { view: 'message', title: `Round ${round} of ${rounds}`, text: 'Get ready… wait for GO!' };
        case 'go':
          return { view: 'message', title: 'GO!', asset: 'go-sign' };
        case 'result':
          return roundWinner
            ? { view: 'message', title: `${nameOf[roundWinner]} wins round ${round}!`, asset: 'trophy' }
            : noWinnerView();
        case 'final':
          return scoreboard('Final scores');
      }
    }

    function playerView(playerId) {
      if (phase === 'final') return scoreboard('Final scores');
      if (phase === 'result') {
        if (!roundWinner) return noWinnerView();
        if (roundWinner === playerId) return { view: 'message', title: 'You won this round!', asset: 'trophy' };
        return { view: 'message', title: `${nameOf[roundWinner]} was fastest!` };
      }
      if (falseStarts.has(playerId)) {
        return { view: 'message', title: 'Too soon!', text: 'You tapped before GO. Wait for the next round.' };
      }
      // The action carries the round number, so a late tap from a previous round is ignored.
      const action = { tap: true, round };
      return phase === 'go'
        ? { view: 'button', label: 'TAP!', action, asset: 'go-sign' }
        : { view: 'button', label: 'Wait for it…', action };
    }

    function noWinnerView() {
      return noWinnerReason === 'false-starts'
        ? { view: 'message', title: 'Everyone tapped too early!' }
        : { view: 'message', title: 'Nobody tapped in time!' };
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
      falseStarts = new Set();
      roundWinner = null;
      noWinnerReason = 'timeout';
      showEveryone();
      const delay = GO_DELAY_MIN_MS + ctx.random() * (GO_DELAY_MAX_MS - GO_DELAY_MIN_MS);
      after(delay, () => {
        phase = 'go';
        showEveryone();
        after(ROUND_TIMEOUT_MS, () => finishRound(null));
      });
    }

    /**
     * If everyone who could still tap has false-started, nobody can win this round:
     * end it now instead of waiting for the 10-second timeout.
     */
    function endRoundIfEveryoneIsOut() {
      if (phase !== 'ready' && phase !== 'go') return;
      if (falseStarts.size === 0) return; // e.g. everyone just disconnected: keep waiting
      const someoneCanTap = ctx.players.some((p) => !falseStarts.has(p.id) && !away.has(p.id));
      if (!someoneCanTap) finishRound(null, 'false-starts');
    }

    function finishRound(winner, reason = 'timeout') {
      phase = 'result';
      roundWinner = winner;
      noWinnerReason = reason;
      if (winner) scores[winner]++;
      showEveryone();
      after(RESULT_PAUSE_MS, () => {
        if (round < rounds) {
          round++;
          startRound();
        } else {
          phase = 'final';
          showEveryone();
          after(FINAL_PAUSE_MS, () => ctx.endGame({ rankings: standings() }));
        }
      });
    }

    startRound();

    return {
      onAction(playerId, action) {
        // Untrusted input: only a tap for THIS round counts, and only from someone still in it.
        if (action.tap !== true || action.round !== round || falseStarts.has(playerId)) return;
        if (phase === 'ready') {
          falseStarts.add(playerId);
          ctx.sendToPlayer(playerId, playerView(playerId));
          endRoundIfEveryoneIsOut();
        } else if (phase === 'go') {
          finishRound(playerId);
        }
        // Taps during 'result' or 'final' are simply ignored.
      },

      onPlayerDisconnect(playerId) {
        away.add(playerId);
        endRoundIfEveryoneIsOut();
      },

      onPlayerReconnect(playerId) {
        away.delete(playerId);
        ctx.sendToPlayer(playerId, playerView(playerId));
      },

      onHostReconnect() {
        ctx.sendToHost(hostView());
      },
    };
  },
};
