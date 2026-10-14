export default {
  contractVersion: 3,
  id: "infinite-loop",
  name: "Infinite loop",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ blocks: [{ type: 'button', label: 'Tap', action: { tap: true } }] });
    return {
      onAction() {
        while (true) {} // never returns
      },
    };
  },
};
