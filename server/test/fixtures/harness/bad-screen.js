export default {
  contractVersion: 3,
  id: "bad-screen",
  name: "Bad screen",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ blocks: [{ type: 'button', lable: 'Go', action: {} }] }); // typo: lable
    return { onAction() {} };
  },
};
