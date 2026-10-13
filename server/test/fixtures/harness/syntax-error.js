export default {
  contractVersion: 2,
  id: 'syntax-error',
  createGame(ctx) {
    ctx.broadcast({ view: 'message', title: 'Oops' }
  },
};
