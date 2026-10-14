export default {
  contractVersion: 3,
  id: "lint-errors",
  name: "Lint errors",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    // Works, but breaks rules 4 and 7. (The words Date and Math.random in this comment
    // don't count; only real code does.)
    const delay = 1000 + Math.random() * 1000;
    const startedAt = Date.now();
    ctx.broadcast({ blocks: [{ type: 'text', text: `Started at ${startedAt}` }] });
    async function unused() {}
    ctx.setTimeout(() => ctx.endGame({ rankings: [] }), delay);
    return { onAction() {} };
  },
};
