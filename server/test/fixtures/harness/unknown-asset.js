export default {
  contractVersion: 3,
  id: "unknown-asset",
  name: "Unknown asset",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ blocks: [{ type: 'text', text: 'Here be dragons' }, { type: 'image', asset: 'dragon' }] });
    ctx.setTimeout(() => ctx.endGame({ rankings: [] }), 1000);
    return { onAction() {} };
  },
};
