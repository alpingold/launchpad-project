export default {
  contractVersion: 3,
  id: 'syntax-error',
  createGame(ctx) {
    ctx.broadcast({ blocks: [{ type: 'text', text: 'Oops' }] }
  },
};
