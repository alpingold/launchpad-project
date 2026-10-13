export default {
  contractVersion: 2,
  id: "flood",
  name: "Flood",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ view: 'button', label: 'Tap', action: { tap: true } });
    ctx.setTimeout(() => ctx.endGame({ rankings: [] }), 20_000);
    return {
      onAction(playerId) {
        for (let i = 0; i < 100; i++) ctx.sendToHost({ view: 'message', title: `Update ${i}` });
        ctx.sendToPlayer(playerId, { view: 'button', label: 'Tap', action: { tap: true } });
      },
    };
  },
};
