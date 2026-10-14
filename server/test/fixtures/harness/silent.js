export default {
  contractVersion: 3,
  id: "silent",
  name: "Silent",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    // Never shows anything on any screen.
    ctx.setTimeout(() => ctx.endGame({ rankings: [] }), 1000);
    return { onAction() {} };
  },
};
