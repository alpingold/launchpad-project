// TEST-ONLY game for the browser tests (only the e2e test server registers it).
// Each phone goes through every input block in turn: type, slide, tick, rank. The big
// screen shows what the game received, so a test can check the whole path:
// phone → game:action { action, input } → server checks → game → big screen.

const STEPS = [
  { type: 'textInput', label: 'Say something', maxLength: 30, action: { step: 'text' } },
  { type: 'slider', label: 'How many?', min: 0, max: 10, step: 1, initial: 5, action: { step: 'slider' } },
  {
    type: 'multiChoice',
    options: [{ label: 'Cheese' }, { label: 'Pineapple' }, { label: 'Olives' }],
    min: 1,
    max: 2,
    action: { step: 'multi' },
  },
  { type: 'rank', items: [{ label: 'Breakfast' }, { label: 'Lunch' }, { label: 'Dinner' }], action: { step: 'rank' } },
];

/** @type {import('../../server/src/games/contract.js').GameModule} */
export default {
  contractVersion: 3,
  id: 'input-test',
  name: 'Input Test',
  description: 'Test-only: every input block, one after another.',
  minPlayers: 1,
  maxPlayers: 12,

  createGame(ctx) {
    const step = Object.fromEntries(ctx.players.map((p) => [p.id, 0]));
    const received = []; // lines for the big screen (it shows the last 8)

    const showHost = () =>
      ctx.sendToHost({ blocks: [{ type: 'text', text: 'Input test', size: 'big' }, ...received.slice(-8).map((text) => ({ type: 'text', text }))] });
    const showPlayer = (id) =>
      ctx.sendToPlayer(id, step[id] < STEPS.length ? { blocks: [STEPS[step[id]]] } : { blocks: [{ type: 'text', text: 'All done!', size: 'big' }] });

    showHost();
    for (const p of ctx.players) showPlayer(p.id);
    const fallback = ctx.setTimeout(() => ctx.endGame({ rankings: [] }), 120_000);

    return {
      onAction(playerId, action, input) {
        if (action.step !== STEPS[step[playerId]]?.action.step) return;
        const name = ctx.players.find((p) => p.id === playerId).name;
        received.push(`${name} ${action.step}: ${JSON.stringify(input)}`);
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
