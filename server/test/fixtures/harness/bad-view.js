export default {
  contractVersion: 2,
  id: "bad-view",
  name: "Bad view",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ view: 'button', lable: 'Go', action: {} }); // typo: lable
    return { onAction() {} };
  },
};
