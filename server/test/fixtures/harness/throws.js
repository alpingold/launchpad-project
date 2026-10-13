export default {
  contractVersion: 2,
  id: "throws",
  name: "Throws",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ view: 'button', label: 'Tap', action: { tap: true } });
    let scores;
    return {
      onAction(playerId) {
        scores[playerId] = 1; // bug: scores was never set to an object
      },
    };
  },
};
