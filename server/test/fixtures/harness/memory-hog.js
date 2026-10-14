export default {
  contractVersion: 3,
  id: "memory-hog",
  name: "Memory hog",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    const hoard = [];
    while (true) hoard.push(new Array(1e6).fill(1)); // ~8 MB more every time around
  },
};
