// Allotments, played to its end by the simulator, and its scoring.
import { simulate, startMatch } from "@boilergames/sdk/v1/engine";
import { describe, expect, test } from "vitest";
import allotments, { biggestPatches } from "./index.js";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("the simulator plays it to its end", () => {
  test.each(SEEDS)("with the fewest Players, seed %i", (seed) => {
    expect(simulate(allotments, { players: 2, seed })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with the most Players, seed %i", (seed) => {
    expect(simulate(allotments, { players: 6, seed })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with the most Players, three of them leaving, seed %i", (seed) => {
    expect(simulate(allotments, { players: 6, seed, leavers: 3 })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with joiners: each one taken in gets a turn, seed %i", (seed) => {
    expect(simulate(allotments, { players: 2, seed, joiners: 4 })).toMatchObject({ ok: true, problems: [] });
    expect(simulate(allotments, { players: 4, seed, leavers: 2, joiners: 3 })).toMatchObject({ ok: true, problems: [] });
  });
});

test("a full board always ends the Match: every turn claims a plot, even one the clock runs out", () => {
  const begun = startMatch(allotments, { players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1 });
  if (!begun.ok) throw new Error(begun.why);
  let outcome = begun.outcome;
  for (let turn = 0; turn < 36 && outcome.status === "running"; turn++) outcome = begun.match.timerFired();
  expect(outcome).toMatchObject({ status: "ended", reason: "finished" });
});

test("scores each gardener's biggest patch of plots joined side by side, not corner to corner", () => {
  const a = "a";
  const b = "b";
  const _ = null;
  // prettier-ignore
  const plots = [
    a, a, _, b, _, _,
    _, a, _, _, b, _,
    _, _, _, _, _, _,
    b, b, b, _, a, _,
    _, _, _, _, _, _,
    _, _, _, _, _, _,
  ];
  expect(biggestPatches(plots, [{ id: a, name: "A" }, { id: b, name: "B" }])).toEqual({ a: 3, b: 3 });
});
