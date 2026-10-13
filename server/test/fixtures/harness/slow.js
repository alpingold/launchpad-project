export default {
  contractVersion: 2,
  id: "slow",
  name: "Slow",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    ctx.broadcast({ view: 'button', label: 'Tap', action: { tap: true } });
    ctx.setTimeout(() => ctx.endGame({ rankings: [] }), 20_000);
    return {
      onAction() {
        let x = 0;
        for (let i = 0; i < 5e8; i++) x += i; // far too much work for one tap
        return x;
      },
    };
  },
};
