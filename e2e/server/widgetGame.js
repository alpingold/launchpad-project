// TEST-ONLY game for the browser tests (only the e2e test server registers it).
// Each phone plays every widget in turn: reaction, mash, timing bar, tap targets, drawing.
// The big screen lists what the game received, and shows each drawing.

const STEPS = ['reaction', 'mash', 'timing', 'targets', 'draw'];

/** Each step's screen, built when it's shown (widgets that start later need ctx.now()). */
function stepScreen(step, ctx) {
  const soon = ctx.now() + 1000;
  switch (step) {
    case 'reaction':
      return { type: 'reaction', goAt: soon, action: { step } };
    case 'mash':
      return { type: 'mash', startsAt: soon, durationMs: 2000, action: { step } };
    case 'timing':
      return { type: 'timingBar', target: { from: 400, to: 600 }, periodMs: 1000, label: 'Stop in the green', action: { step } };
    case 'targets':
      return { type: 'tapTargets', startsAt: soon, durationMs: 8000, count: 3, seed: 42, action: { step } };
    case 'draw':
      return { type: 'drawPad', label: 'Draw anything', colors: ['black', 'red'], action: { step } };
  }
}

/** @type {import('../../server/src/games/contract.js').GameModule} */
export default {
  contractVersion: 3,
  id: 'widget-test',
  name: 'Widget Test',
  description: 'Test-only: every widget, one after another.',
  minPlayers: 1,
  maxPlayers: 12,

  createGame(ctx) {
    const step = Object.fromEntries(ctx.players.map((p) => [p.id, 0]));
    const received = []; // lines for the big screen (it shows the last 8)
    const drawings = []; // { name, strokes }

    const showHost = () =>
      ctx.sendToHost({
        blocks: [
          { type: 'text', text: 'Widget test', size: 'big' },
          ...received.slice(-8).map((text) => ({ type: 'text', text })),
          ...drawings.slice(-4).map((d) => ({ type: 'drawing', strokes: d.strokes, caption: `${d.name}'s drawing`, size: 'small' })),
        ],
      });
    const showPlayer = (id) =>
      ctx.sendToPlayer(
        id,
        step[id] < STEPS.length ? { blocks: [stepScreen(STEPS[step[id]], ctx)] } : { blocks: [{ type: 'text', text: 'All done!', size: 'big' }] },
      );

    showHost();
    for (const p of ctx.players) showPlayer(p.id);
    const fallback = ctx.setTimeout(() => ctx.endGame({ rankings: [] }), 300_000);

    return {
      onAction(playerId, action, input) {
        if (action.step !== STEPS[step[playerId]]) return;
        const name = ctx.players.find((p) => p.id === playerId).name;
        if (action.step === 'draw') {
          drawings.push({ name, strokes: input.strokes });
          received.push(`${name} draw: ${input.strokes.length} strokes`);
        } else {
          received.push(`${name} ${action.step}: ${JSON.stringify(input)}`);
        }
        step[playerId]++;
        showHost();
        showPlayer(playerId);
        if (Object.values(step).every((s) => s === STEPS.length)) {
          ctx.clearTimeout(fallback);
          ctx.setTimeout(() => ctx.endGame({ rankings: ctx.players.map((p) => p.id) }), 3000);
        }
      },
    };
  },
};
