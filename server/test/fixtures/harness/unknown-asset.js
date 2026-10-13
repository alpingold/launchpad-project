export default {
  contractVersion: 2,
  id: "unknown-asset",
  name: "Unknown asset",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ view: 'message', title: 'Here be dragons', asset: 'dragon' });
    ctx.setTimeout(() => ctx.endGame({ rankings: [] }), 1000);
    return { onAction() {} };
  },
};
