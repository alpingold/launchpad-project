// Runs one real Playtest of a small, good Game through the Playtest's socket, as the site would.
// deploy/install-release.sh runs it after switching to a new release: a release whose Playtest
// can't run (a missing program, a wall that stops tsc) is rolled back instead of going live.
//
//   sudo -u boilergames node /opt/boilergames/current/deploy/check-playtest.mjs
import { socketRunner } from "../playtest/dist/client.js";

/** One Player taps a button three times, and the Match ends. */
const SMALL_GAME = `import { defineGame } from "@boilergames/sdk/v1";

export default defineGame<{ taps: number }, { type: "tap" }>({
  about: { title: "Three Taps", players: { min: 1, max: 2 } },
  start: () => ({ state: { taps: 0 } }),
  onAction: (state) => (state.taps + 1 >= 3 ? { state: { taps: 3 }, end: {} } : { state: { taps: state.taps + 1 } }),
  onLeave: (state) => ({ state }),
  screen: (state) => ({ parts: [{ kind: "text", text: \`\${state.taps} taps\` }] }),
  controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
});
`;

const socket = process.env.PLAYTEST_SOCKET ?? "/run/boilergames-playtest.sock";
const started = performance.now();
const result = await socketRunner(socket, { timeoutMs: 30_000 }).run(SMALL_GAME);
if (!result.ok) {
  console.error("The Playtest failed a good Game:");
  for (const problem of result.problems) console.error(`  ${problem.stage}: ${problem.message}`);
  process.exit(1);
}
console.log(`Playtest through ${socket}: passed "${result.about.title}" in ${Math.round(performance.now() - started)} ms`);
