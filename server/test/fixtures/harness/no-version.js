export default {
  id: 'no-version',
  name: 'No version',
  description: 'Test-only broken game.',
  minPlayers: 1,
  maxPlayers: 4,
  createGame() {
    return { onAction() {} };
  },
};
