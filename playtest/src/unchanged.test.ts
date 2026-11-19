// An Upload's Playtest gives byte for byte the result it gave before the Playtest learned to check a
// generated Game against its Concept (BUILD-PLAN Step 30). Each hash below is of the whole result,
// bundle and problems included, recorded before that change. A request without `expect` is every
// Upload, so these must not move.
//
// If an Upload's result is ever meant to change, run with RECORD=1 to print the new hashes, and say
// in the commit why the result changed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { childProcessRunner, type RunResult } from "./client.js";
import { playtest } from "./playtest.js";

const runner = childProcessRunner();
const WAYS: [string, (source: string) => Promise<RunResult>][] = [
  ["in this process", (source) => playtest(source)],
  ["through the runner", (source) => runner.run(source)],
];

const file = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const BEST_WORD = `${file("../../sdk/src/v1/best-word.fixture.ts").replace(`from "./index.js"`, `from "@boilergames/sdk/v1"`)}\nexport default bestWord;\n`;

/** A small Game, changed one way at a time. Its state has a `phase`, as a generated Game's does: an Upload may have one too. */
function game(change: { top?: string; about?: string; onAction?: string } = {}): string {
  return `import { defineGame } from "@boilergames/sdk/v1";
${change.top ?? ""}
export default defineGame<{ phase: string; taps: number }, { type: "tap" }>({
  about: ${change.about ?? `{ title: "Three Taps", players: { min: 1, max: 4 } }`},
  start: () => ({ state: { phase: "tapping", taps: 0 } }),
  onAction: ${change.onAction ?? `(state) => (state.taps + 1 >= 3 ? { state: { phase: "done", taps: 3 }, end: { scores: {} } } : { state: { phase: "tapping", taps: state.taps + 1 } })`},
  onLeave: (state) => ({ state }),
  screen: (state) => ({ parts: [{ kind: "text", text: \`\${state.taps} taps\` }] }),
  controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
});
`;
}

const CASES: [string, string, string][] = [
  ["Best Word", BEST_WORD, "0dac7959ee1a83d0cb3bb310585f63c27e76e219c2a2bd02be3bd726ad7429ff"],
  ["the Official game allotments", file("../../games/src/allotments/index.ts"), "7bccbb1952a378c43e283850075256147cdd71add8698be0f555113b8da6e929"],
  ["the Official game scribble-pick", file("../../games/src/scribble-pick/index.ts"), "557abf3a01df5cd0bd57205821697777f63f6c45644419f5c3cc7fef7d610ee9"],
  ["the Official game sum-it-up", file("../../games/src/sum-it-up/index.ts"), "7d68ddcde738e24dfcf38e13c103c1224b92556824ab002991b91478facaf753"],
  ["a Game with a phase in its state", game(), "429563277b220bbc2cdc3c4d800f93706890faec0fe914431562fcc0e3764504"],
  ["a type error", game({ top: `const count: number = "three";` }), "1069dea5cec1af1268727802fd3656f3982387c4596e1a6995da3233af01ebbe"],
  ["a bundle problem: a global of its own", game({ top: `(globalThis as Record<string, unknown>)["extra"] = 1;` }), "720f6729e9c1b3d46aa0f8d08598a5ad851ed7962da7baa2deb95b6be6e5c575"],
  ["an about problem", game({ about: `{ title: "", players: { min: 1, max: 4 } }` }), "8b015466762428ac285335134a9b9f426453efe46f76cee44553a80c5f91ed55"],
  ["a play problem: a Match that never ends", game({ onAction: `(state) => ({ state: { phase: "tapping", taps: state.taps + 1 } })` }), "5545408df3d62cc1bec30689f373932170443ac8f32e068365ca2d8a97363050"],
  ["a play problem: a broken Step", game({ onAction: `(state) => ({ state, extra: 1 }) as never` }), "595e436bd7218676305be0db684b705282987108d79fab27c6a76aac523fbaa8"],
];

const hash = (result: RunResult) => createHash("sha256").update(JSON.stringify(result)).digest("hex");

describe.each(WAYS)("%s", (_way, run) => {
  test.each(CASES)("%s gives the result it gave before", async (name, source, before) => {
    const now = hash(await run(source));
    if (process.env["RECORD"] === "1") console.log(`RECORD ${name}: ${now}`);
    else expect(now).toBe(before);
  });
});
