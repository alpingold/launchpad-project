/**
 * TEST-ONLY game: "first to tap N times wins" (N = options.target, default 3).
 * Tiny on purpose, it exists to prove the game contract works end to end.
 * It is never registered in the real server.
 *
 * @type {import('../../src/games/contract.js').GameModule}
 */
export default {
  id: 'count-game',
  name: 'Count to Three',
  description: 'First to tap the button enough times wins.',
  minPlayers: 1,
  maxPlayers: 12,

  createGame(ctx, options) {
    const target = Number.isInteger(options.target) && options.target > 0 ? options.target : 3;
    /** @type {Record<string, number>} taps per player id */
    const taps = Object.fromEntries(ctx.players.map((p) => [p.id, 0]));
    const tapView = { view: 'button', label: 'Tap!', action: { tap: true } };

    ctx.broadcast(tapView);
    ctx.sendToHost({ view: 'message', title: `First to ${target} taps wins!` });

    return {
      onAction(playerId, action) {
        // Rule 5: actions are untrusted. Object.hasOwn, not `playerId in taps`: `in` would
        // also match built-in names like "constructor".
        if (!Object.hasOwn(taps, playerId) || action.tap !== true) return;
        taps[playerId]++;
        if (taps[playerId] < target) return;

        const rankings = Object.keys(taps).sort((a, b) => taps[b] - taps[a]);
        ctx.broadcast({
          view: 'scoreboard',
          title: 'Results',
          rows: rankings.map((id) => ({ playerId: id, score: taps[id] })),
        });
        ctx.endGame({ rankings });
      },

      onPlayerReconnect(playerId) {
        ctx.sendToPlayer(playerId, tapView);
      },

      onHostReconnect() {
        ctx.sendToHost({ view: 'message', title: `First to ${target} taps wins!` });
      },
    };
  },
};
