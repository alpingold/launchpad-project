export default {
  contractVersion: 2,
  id: "stuck",
  name: "Stuck",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    const tapped = new Set();
    ctx.broadcast({ view: 'button', label: 'Tap when ready', action: { ready: true } });
    return {
      onAction(playerId) {
        tapped.add(playerId);
        // Waits for EVERY player, with no timeout: one player who never taps blocks everyone.
        if (tapped.size === ctx.players.length) ctx.endGame({ rankings: [...tapped] });
      },
    };
  },
};
