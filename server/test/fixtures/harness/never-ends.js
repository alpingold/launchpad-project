export default {
  contractVersion: 2,
  id: "never-ends",
  name: "Never ends",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    let round = 0;
    function nextRound() {
      round++;
      ctx.broadcast({ view: 'message', title: `Round ${round}` });
      ctx.setTimeout(nextRound, 10_000); // forgets to stop after the last round
    }
    nextRound();
    return { onAction() {} };
  },
};
