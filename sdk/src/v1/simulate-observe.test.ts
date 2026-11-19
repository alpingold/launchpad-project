// The simulator's `observe`: it hears the Match after its start and after every event, and changes
// nothing about the run. Additive, for the Playtest's checks of a generated Game (BUILD-PLAN Step 30).
import { expect, test } from "vitest";
import { bestWord } from "./best-word.fixture.js";
import { simulate, type Observed, type SimulateOptions } from "./engine-entry.js";

const RUNS: SimulateOptions[] = [
  { players: 3, seed: 1 },
  { players: 8, seed: 2, leavers: 4 },
  { players: 3, seed: 3, joiners: 2 },
];

test.each(RUNS)("a run gives the same result with an observer as without one: %j", (options) => {
  expect(simulate(bestWord, { ...options, observe: () => undefined })).toEqual(simulate(bestWord, options));
});

test("it hears the start, then every event in order, ending with the Match's end", () => {
  const heard: Observed[] = [];
  const result = simulate(bestWord, { players: 3, seed: 1, observe: (seen) => heard.push(seen) });
  expect(result.ok).toBe(true);
  expect(heard.map((seen) => seen.events)).toEqual(Array.from({ length: result.steps + 1 }, (_, i) => i));
  expect(heard[0]?.outcome.status).toBe("running");
  expect(heard.at(-1)?.outcome).toMatchObject({ status: "ended", reason: "finished" });
  expect(heard.every((seen) => seen.match.players.length === 3)).toBe(true);
});

test("with joiners it hears both plays, each from 0 events, the second being the one returned", () => {
  const heard: Observed[] = [];
  const result = simulate(bestWord, { players: 3, seed: 3, joiners: 2, observe: (seen) => heard.push(seen) });
  const starts = heard.flatMap((seen, at) => (seen.events === 0 ? [at] : []));
  expect(starts).toHaveLength(2);
  const second = heard.slice(starts[1]);
  expect(second.at(-1)?.events).toBe(result.steps);
});
