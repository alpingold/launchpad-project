// A Game the site's AI made, checked against its Concept (BUILD-PLAN Step 30): each new problem on a
// small Game written for it, in this process and through the runner. Without `expect` none of these
// checks happen (unchanged.test.ts proves an Upload's result didn't move).
import { describe, expect, test } from "vitest";
import { childProcessRunner, type RunOptions, type RunResult } from "./client.js";
import { MAX_EXPECTED_PHASES, readExpect, type Expect } from "./expect.js";
import { playtest } from "./playtest.js";

const runner = childProcessRunner();
const WAYS: [string, (source: string, options?: RunOptions) => Promise<RunResult>][] = [
  ["in this process", (source, options = {}) => playtest(source, options)],
  ["through the runner", (source, options) => runner.run(source, options)],
];

/**
 * A small Game with two phases, write then vote: any Player taps, the third tap moves to vote and
 * the sixth ends the Match, each Player scoring their own taps. Changed one way at a time.
 */
function game(change: { about?: string; start?: string; second?: string; end?: string } = {}): string {
  return `import { defineGame } from "@boilergames/sdk/v1";
export default defineGame<{ phase?: string | number; taps: number; by: Record<string, number> }, { type: "tap" }>({
  about: ${change.about ?? `{ title: "Tap Vote", players: { min: 2, max: 4 } }`},
  start: () => ({ state: ${change.start ?? `{ phase: "write", taps: 0, by: {} }`} }),
  onAction: (state, player, _action, ctx) => {
    const by = { ...state.by, [player.id]: (state.by[player.id] ?? 0) + 1 };
    const taps = state.taps + 1;
    if (taps >= 6) return { state: { ...state, taps, by }, end: ${change.end ?? `{ scores: Object.fromEntries(ctx.players.map((p) => [p.id, by[p.id] ?? 0])) }`} };
    return { state: { phase: taps >= 3 ? ${change.second ?? `"vote"`} : "write", taps, by } };
  },
  onLeave: (state) => ({ state }),
  screen: (state) => ({ parts: [{ kind: "text", text: \`\${state.taps} taps\` }] }),
  controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
});
`;
}

const CONCEPT: Expect = { phases: ["write", "vote"], scoring: true, players: { min: 2, max: 4 } };

function problems(result: RunResult): string[] {
  if (result.ok) throw new Error("expected the Playtest to fail");
  if ("checkFailed" in result) throw new Error("the check itself failed");
  return result.problems.map((problem) => `${problem.stage}: ${problem.message}`);
}

const passed = (result: RunResult) => (result.ok ? "passed" : result.problems.map((problem) => problem.message));

describe.each(WAYS)("%s", (_way, run) => {
  test("a Game that matches its Concept passes", async () => {
    expect(passed(await run(game(), { expect: CONCEPT }))).toBe("passed");
  });

  test("a phase never reached", async () => {
    const found = problems(await run(game({ second: `"write"` }), { expect: CONCEPT }));
    expect(found).toEqual([`play: No simulated Match ever reached the phase "vote": state.phase was never "vote". Every phase of the Concept must happen in a Match.`]);
  });

  test("a phase that isn't one of the Concept's, with the runs it happened in", async () => {
    const found = problems(await run(game({ second: `"voting"` }), { expect: CONCEPT }));
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^play: With 2 Players \(seeds 1, 2 and 3\); .*: state\.phase was "voting", which isn't one of the Concept's phases: "write", "vote"$/);
    expect(found[1]).toContain(`No simulated Match ever reached the phase "vote"`);
  });

  test("a phase that isn't text", async () => {
    const found = problems(await run(game({ second: `3` }), { expect: CONCEPT }));
    expect(found[0]).toMatch(/state\.phase was a number, not text\. It must always be one of the Concept's phases: "write", "vote"$/);
  });

  test("a state with no phase", async () => {
    const found = problems(await run(game({ start: `{ taps: 0, by: {} }` }), { expect: CONCEPT }));
    expect(found[0]).toMatch(/a state had no phase\. Keep phase in the state at all times/);
  });

  test("a Game with scoring whose Matches all end level: no scores, or every score the same", async () => {
    const level = `{ scores: Object.fromEntries(ctx.players.map((p) => [p.id, 0])) }`;
    for (const end of [`{}`, level]) {
      const found = problems(await run(game({ end }), { expect: CONCEPT }));
      expect(found).toEqual([expect.stringMatching(/^play: The Concept has scoring, but every Match ended with its Players level/)]);
    }
  });

  test("a Game that names a winner and gives no scores has scoring", async () => {
    const result = await run(game({ end: `{ winners: [ctx.players[0]!.id] }` }), { expect: CONCEPT });
    expect(passed(result)).toBe("passed");
  });

  test("a Game that scores only some of its Players tells them apart", async () => {
    const result = await run(game({ end: `{ scores: { [ctx.players[0]!.id]: 1 } }` }), { expect: CONCEPT });
    expect(passed(result)).toBe("passed");
  });

  test("a Game with more phase values than are noted isn't told a phase it may have reached was never reached", async () => {
    // "write", then 30 wrong phases ("w1", "w2"...), then "vote": past the 20 values noted per Match.
    const source = `import { defineGame } from "@boilergames/sdk/v1";
export default defineGame<{ phase: string; taps: number }, { type: "tap" }>({
  about: { title: "Many Phases", players: { min: 2, max: 4 } },
  start: () => ({ state: { phase: "write", taps: 0 } }),
  onAction: (state, player, _action, ctx) => {
    const taps = state.taps + 1;
    if (taps >= 40) return { state: { ...state, taps }, end: { scores: { [player.id]: 1 } } };
    return { state: { phase: taps <= 30 ? \`w\${taps}\` : "vote", taps } };
  },
  onLeave: (state) => ({ state }),
  screen: (state) => ({ parts: [{ kind: "text", text: \`\${state.taps} taps\` }] }),
  controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
});
`;
    const found = problems(await run(source, { expect: CONCEPT }));
    expect(found.some((problem) => problem.includes(`state.phase was "w1", which isn't one of the Concept's phases`))).toBe(true);
    expect(found.some((problem) => problem.includes("never reached"))).toBe(false);
  });

  test("a Game for 1 to 4 that always ends level fails, though its one-Player Matches can't be level", async () => {
    const about = `{ title: "Tap Vote", players: { min: 1, max: 4 } }`;
    const found = problems(await run(game({ about, end: `{}` }), { expect: { ...CONCEPT, players: { min: 1, max: 4 } } }));
    expect(found).toEqual([expect.stringContaining("every Match ended with its Players level")]);
  });

  test("a Game for one Player has scoring when it gives a score", async () => {
    const about = `{ title: "Tap Vote", players: { min: 1, max: 1 } }`;
    const result = await run(game({ about }), { expect: { ...CONCEPT, players: { min: 1, max: 1 } } });
    expect(passed(result)).toBe("passed");
  });

  test("a Concept without scoring doesn't ask for it", async () => {
    expect(passed(await run(game({ end: `{}` }), { expect: { ...CONCEPT, scoring: false } }))).toBe("passed");
  });

  test("a Player count that differs from the Concept's, at the bundle stage", async () => {
    const found = problems(await run(game(), { expect: { ...CONCEPT, players: { min: 3, max: 6 } } }));
    expect(found).toEqual(["bundle: about.players is { min: 2, max: 4 }, but the Concept's is { min: 3, max: 6 }. Use the Concept's."]);
  });

  test("a Game that breaks is told only that: not also that it never reached its phases", async () => {
    const found = problems(await run(game({ second: `(() => { throw new Error("boom"); })()` }), { expect: CONCEPT }));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((problem) => problem.startsWith("play: ") && problem.includes("boom"))).toBe(true);
  });

  test("without expect, the same Game with a wrong phase and no scores passes, as an Upload", async () => {
    expect(passed(await run(game({ second: `"voting"`, end: `{}` })))).toBe("passed");
  });
});

describe("the runner's request", () => {
  test("an expect that isn't valid is a failure of the check, not of the Game", async () => {
    const logged: string[] = [];
    const strict = childProcessRunner({ log: (line) => logged.push(line) });
    const result = await strict.run(game(), { expect: { ...CONCEPT, phases: ["Vote"] } });
    expect(result).toMatchObject({ ok: false, checkFailed: true });
    expect(logged.join("\n")).toContain("expect.phases must each be 1 to 40 lower-case letters");
  });
});

describe("readExpect", () => {
  test("takes the largest Concept: 8 phases of 30 letters, 1 to 16 Players", () => {
    const phases = Array.from({ length: MAX_EXPECTED_PHASES }, (_, i) => "abcdefgh"[i]!.repeat(30));
    expect(readExpect({ phases, scoring: true, players: { min: 1, max: 16 } })).toEqual({ ok: true, expect: { phases, scoring: true, players: { min: 1, max: 16 } } });
  });

  test.each([
    [null, "expect must be { phases, scoring, players }"],
    [{ ...CONCEPT, extra: 1 }, "expect must be { phases, scoring, players }"],
    [{ ...CONCEPT, phases: [] }, "expect.phases must be a list of 1 to 8 ids"],
    [{ ...CONCEPT, phases: Array(9).fill("a") }, "expect.phases must be a list of 1 to 8 ids"],
    [{ ...CONCEPT, phases: ["vote", "vote"] }, "expect.phases must all be different"],
    [{ ...CONCEPT, phases: ["a".repeat(41)] }, "expect.phases must each be 1 to 40 lower-case letters"],
    [{ ...CONCEPT, scoring: "yes" }, "expect.scoring must be true or false"],
    [{ ...CONCEPT, players: { min: 3, max: 2 } }, "expect.players must be { min, max }, whole numbers from 1 to 16, min not above max"],
    [{ ...CONCEPT, players: { min: 1, max: 17 } }, "expect.players must be { min, max }, whole numbers from 1 to 16, min not above max"],
  ])("refuses %j", (value, why) => {
    expect(readExpect(value)).toEqual({ ok: false, why });
  });
});
