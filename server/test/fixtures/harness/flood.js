export default {
  contractVersion: 3,
  id: "flood",
  name: "Flood",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ blocks: [{ type: 'button', label: 'Tap', action: { tap: true } }] });
    ctx.setTimeout(() => ctx.endGame({ rankings: [] }), 20_000);
    return {
      onAction(playerId) {
        for (let i = 0; i < 100; i++) ctx.sendToHost({ blocks: [{ type: 'text', text: `Update ${i}` }] });
        ctx.sendToPlayer(playerId, { blocks: [{ type: 'button', label: 'Tap', action: { tap: true } }] });
      },
    };
  },
};
