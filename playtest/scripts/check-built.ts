/**
 * Part of `npm run build`: runs the Playtest on a small Game against the SDK's built output, the way
 * a release runs it, where there is no TypeScript source (sdk/src) and no "@boilergames/source"
 * condition. The tests use the source; this proves the other way works before anything ships.
 *
 *   npm run check-built -w @boilergames/playtest
 */
import { playtest } from "@boilergames/playtest";

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

const started = performance.now();
const result = await playtest(SMALL_GAME, { sdk: "built" });
if (!result.ok) {
  console.error("The Playtest failed a good Game against the built SDK:");
  for (const problem of result.problems) console.error(`  ${problem.stage}${problem.line === undefined ? "" : ` line ${problem.line}`}: ${problem.message}`);
  process.exit(1);
}
if (!result.bundle.includes("sdk/dist/v1/") || result.bundle.includes("sdk/src/")) {
  console.error("The Playtest didn't bundle the SDK's built output");
  process.exit(1);
}
console.log(`Playtest against the built SDK: passed "${result.about.title}" in ${Math.round(performance.now() - started)} ms`);
