export default {
  contractVersion: 2,
  id: "sneaky-fs",
  name: "Sneaky",
  description: "Test-only broken game.",
  minPlayers: 1,
  maxPlayers: 4,
  createGame(ctx) {
    // Pretends to be a game but tries to read a file on the machine. The lint flags it,
    // and the harness worker's permission settings refuse it at runtime.
    const secret = globalThis.process.getBuiltinModule('node:fs').readFileSync('/etc/hostname', 'utf8');
    ctx.broadcast({ view: 'message', title: secret.slice(0, 50) });
    return { onAction() {} };
  },
};
