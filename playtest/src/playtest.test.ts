// The Playtest on real Games: the test Game and the Official games pass, and each way a Game can be
// broken gives a problem a Creator can fix it from.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MAX_SOURCE_BYTES, RUN_MS } from "./limits.js";
import { playtest, type PlaytestResult } from "./playtest.js";

const file = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Best Word, the SDK's test Game, written as a Creator would: importing the SDK by its name. */
const BEST_WORD = `${file("../../sdk/src/v1/best-word.fixture.ts").replace(`from "./index.js"`, `from "@boilergames/sdk/v1"`)}\nexport default bestWord;\n`;
const OFFICIAL = ["allotments", "scribble-pick", "sum-it-up"];

/** A small good Game, to break one way at a time. One button; three taps by anyone ends it. */
function game(change: { imports?: string; top?: string; onAction?: string; onLeave?: string; screen?: string; controller?: string; about?: string } = {}): string {
  return `import { defineGame } from "@boilergames/sdk/v1";
${change.imports ?? ""}
${change.top ?? ""}
export default defineGame<{ taps: number }, { type: "tap" }>({
  about: ${change.about ?? `{ title: "Three Taps", players: { min: 1, max: 4 } }`},
  start: () => ({ state: { taps: 0 } }),
  onAction: ${change.onAction ?? `(state) => (state.taps + 1 >= 3 ? { state: { taps: 3 }, end: {} } : { state: { taps: state.taps + 1 } })`},
  onLeave: ${change.onLeave ?? `(state) => ({ state })`},
  screen: ${change.screen ?? `(state) => ({ parts: [{ kind: "text", text: \`\${state.taps} taps\` }] })`},
  controller: ${change.controller ?? `() => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] })`},
});
`;
}

function problems(result: PlaytestResult): { stage: string; message: string; line?: number }[] {
  if (result.ok) throw new Error("expected the Playtest to fail");
  return result.problems;
}

describe("good Games pass", () => {
  test("Best Word, the SDK's test Game", async () => {
    const result = await playtest(BEST_WORD);
    expect(result.ok ? result.about.title : result.problems).toBe("Best Word");
  });

  test.each(OFFICIAL)("the Official game %s, with its bundle, about and SDK version", async (id) => {
    const result = await playtest(file(`../../games/src/${id}/index.ts`));
    if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
    const listing = (JSON.parse(file("../../games/dist/games.json")) as { id: string }[]).find((entry) => entry.id === id);
    expect({ id, ...result.about }).toEqual(listing);
    expect(result.sdkVersion).toBe("v1");
    expect(result.bundle).toMatch(/^var BoilerGamesGame = \(function\(\) \{/);
  });

  test("a good Game's Playtest takes well under a few seconds", async () => {
    const started = performance.now();
    expect((await playtest(game())).ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe("the type check", () => {
  test("a type error, with its line", async () => {
    const found = problems(await playtest(game({ top: `const count: number = "three";` })));
    expect(found).toEqual([{ stage: "types", line: 3, message: "Type 'string' is not assignable to type 'number'." }]);
  });

  test("two type errors: both, each with its line", async () => {
    const found = problems(await playtest(game({ top: `const count: number = "three";\nconst word: string = 3;` })));
    expect(found.map((problem) => problem.line)).toEqual([3, 4]);
  });

  test("an error the SDK's types catch, in the SDK's words", async () => {
    const found = problems(await playtest(game({ controller: `() => ({ parts: [{ kind: "button", label: "Tap" }] })` })));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ stage: "types", line: 10 });
    expect(found[0]?.message).toMatch(/action/);
  });

  test.each([
    ["node:fs", `import { readFileSync } from "node:fs";`],
    ["lodash", `import _ from "lodash";`],
    ["./helpers", `import { help } from "./helpers";`],
    ["@boilergames/sdk/v1/engine", `import { simulate } from "@boilergames/sdk/v1/engine";`],
  ])("importing %s: refused, with its line", async (name, line) => {
    const found = problems(await playtest(game({ imports: line })));
    expect(found).toContainEqual({ stage: "types", line: 2, message: `"${name}" can't be imported: a Game may import only @boilergames/sdk/v1.` });
  });

  test.each([
    ["fetch", `fetch("https://example.com");`, "a Game has no network"],
    ["document", `document.title = "x";`, "a Game has no page"],
    ["process", `process.exit(1);`, "a Game doesn't run in Node"],
  ])("using %s: a type error, since nothing declares it", async (name, line, why) => {
    const found = problems(await playtest(game({ top: line })));
    expect(found).toEqual([{ stage: "types", line: 3, message: `Cannot find name '${name}': ${why}.` }]);
  });

  test("a /// <reference> line, which could declare the DOM, is refused", async () => {
    const found = problems(await playtest(`/// <reference lib="dom" />\n${game({ top: `fetch("x");` })}`));
    expect(found).toEqual([{ stage: "types", line: 1, message: "A Game can't use a /// <reference> line: it gets the SDK's types and nothing else." }]);
  });
});

describe("the bundle", () => {
  test("a file with no default export", async () => {
    const found = problems(await playtest(game().replace("export default defineGame", "export const threeTaps = defineGame")));
    expect(found).toEqual([{ stage: "bundle", message: "The file has no default export: end it with export default defineGame({ ... })." }]);
  });

  test("a Game whose code sets a global of its own", async () => {
    const found = problems(await playtest(game({ top: `(globalThis as unknown as Record<string, number>)["score"] = 1;` })));
    expect(found).toEqual([{ stage: "bundle", message: expect.stringContaining("sets globals of its own (score)") }]);
  });

  test("an unreadable Look", async () => {
    const found = problems(await playtest(game({ about: `{ title: "Three Taps", players: { min: 1, max: 4 }, look: { colors: { background: "#ffffff", text: "#fefefe" } } }` })));
    expect(found.length).toBeGreaterThan(0);
    for (const problem of found) expect(problem).toMatchObject({ stage: "bundle", message: expect.stringMatching(/^about\.look: /) });
  });

  test("a title too long for the Room", async () => {
    const found = problems(await playtest(game({ about: `{ title: "${"x".repeat(61)}", players: { min: 1, max: 4 } }` })));
    expect(found).toEqual([{ stage: "bundle", message: "about.title must be text of 1 to 60 characters." }]);
  });

  test("top-level code that throws", async () => {
    const found = problems(await playtest(game({ top: `if ("x".length > 0) throw new Error("not today");` })));
    expect(found).toEqual([{ stage: "bundle", message: "The Game threw while loading: not today" }]);
  });
});

describe("playing it", () => {
  test("a Match that never ends", async () => {
    const found = problems(await playtest(game({ onAction: `(state) => ({ state })` })));
    expect(found.some((problem) => problem.stage === "play" && /didn't end within 5,000 events/.test(problem.message))).toBe(true);
  });

  test("a View that breaks a limit: said once, with the runs it came from", async () => {
    const found = problems(await playtest(game({ screen: `() => ({ parts: [{ kind: "text", text: "x".repeat(5000) }] })` })));
    expect(found).toHaveLength(1);
    expect(found[0]?.stage).toBe("play");
    expect(found[0]?.message).toMatch(/^With 1 Player \(seeds 1, 2 and 3\); with 4 Players \(seeds 1, 2 and 3\);/);
    expect(found[0]?.message).toMatch(/2,000|2000/);
  });

  test("a Player offered nothing to do", async () => {
    const found = problems(await playtest(game({ controller: `() => ({ parts: [{ kind: "text", text: "Wait" }] })` })));
    expect(found.some((problem) => problem.stage === "play" && /Player 1 was never offered an Action in the whole Match/.test(problem.message))).toBe(true);
  });

  test("throwing when a Player leaves: found by the runs with leavers", async () => {
    const found = problems(await playtest(game({ onLeave: `() => { throw new Error("nobody leaves") }` })));
    expect(found.length).toBeGreaterThan(0);
    for (const problem of found) {
      expect(problem.message).toMatch(/^With 4 Players, 2 of them leaving/);
      expect(problem.message).toMatch(/nobody leaves/);
    }
  });

  test(`a Game that loops forever is stopped after ${RUN_MS / 1000} seconds and reported`, async () => {
    const found = problems(await playtest(game({ onAction: `(state) => { while (state.taps >= 0) { state = { taps: state.taps + 1 } } return { state } }` })));
    expect(found).toEqual([{ stage: "play", message: `With 1 Player (seed 1): A Match didn't finish within ${RUN_MS / 1000} seconds: one of the Game's functions loops forever, or takes far too long.` }]);
  }, 20_000);
});

test("a source over the size is refused before anything runs", async () => {
  const found = problems(await playtest(game({ top: `// ${"x".repeat(MAX_SOURCE_BYTES)}` })));
  expect(found).toEqual([{ stage: "source", message: `The Game's source is 257 KB; the most it may be is ${MAX_SOURCE_BYTES / 1024} KB.` }]);
});
