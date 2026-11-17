// Sum It Up, played to its end by the simulator, and a few of its rules played by hand.
import { simulate, startMatch, type Match } from "@boilergames/sdk/v1/engine";
import { describe, expect, test } from "vitest";
import sumItUp, { MAX_WORD, ROUNDS } from "./index.js";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("the simulator plays it to its end", () => {
  test.each(SEEDS)("with the fewest Players, seed %i", (seed) => {
    expect(simulate(sumItUp, { players: 3, seed })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with the most Players, seed %i", (seed) => {
    expect(simulate(sumItUp, { players: 8, seed })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with the most Players, four of them leaving, seed %i", (seed) => {
    expect(simulate(sumItUp, { players: 8, seed, leavers: 4 })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with joiners, who join in at once, seed %i", (seed) => {
    expect(simulate(sumItUp, { players: 3, seed, joiners: 5 })).toMatchObject({ ok: true, problems: [] });
    expect(simulate(sumItUp, { players: 5, seed, leavers: 2, joiners: 3 })).toMatchObject({ ok: true, problems: [] });
  });
});

function begin(count: number): Match {
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
  const begun = startMatch(sumItUp, { players, seed: 7 });
  if (!begun.ok) throw new Error(begun.why);
  return begun.match;
}

test("a vote is a point, nobody can vote for their own word, and the Match ends after the last round with the totals", () => {
  const match = begin(3);
  for (let round = 0; round < ROUNDS; round++) {
    for (const id of ["p1", "p2", "p3"]) match.act(id, { type: "write", text: `word-${id}` });
    expect(match.act("p1", { type: "vote", for: "p1" })).toMatchObject({ status: "ignored" });
    match.act("p1", { type: "vote", for: "p2" });
    match.act("p2", { type: "vote", for: "p1" });
    const last = match.act("p3", { type: "vote", for: "p2" });
    if (round < ROUNDS - 1) {
      expect(last).toMatchObject({ status: "running", timer: expect.any(Number) });
      expect(match.timerFired()).toMatchObject({ status: "running" });
    } else {
      expect(last).toEqual({ status: "ended", reason: "finished", end: { scores: { p1: 3, p2: 6, p3: 0 } } });
    }
  }
});

test("the longest words and the most Players still fit: every View stays within the limits", () => {
  const match = begin(8);
  const ids = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  for (const id of ids) expect(match.act(id, { type: "write", text: "W".repeat(MAX_WORD) })).not.toMatchObject({ status: "broken" });
  for (const id of ids) {
    const outcome = match.act(id, { type: "vote", for: id === "p1" ? "p2" : "p1" });
    expect(outcome.status).not.toBe("broken");
  }
});
