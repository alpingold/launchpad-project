// Scribble Pick, played to its end by the simulator; its secret words; and its biggest drawings.
import type { Drawing } from "@boilergames/sdk/v1";
import { MAX_DRAWING_POINTS, MAX_STROKES } from "@boilergames/sdk/v1/check";
import { simulate, startMatch, type Match } from "@boilergames/sdk/v1/engine";
import { describe, expect, test } from "vitest";
import scribblePick, { WORDS } from "./index.js";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("the simulator plays it to its end", () => {
  test.each(SEEDS)("with the fewest Players, seed %i", (seed) => {
    expect(simulate(scribblePick, { players: 3, seed })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with the most Players, seed %i", (seed) => {
    expect(simulate(scribblePick, { players: 8, seed })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with the most Players, four of them leaving, seed %i", (seed) => {
    expect(simulate(scribblePick, { players: 8, seed, leavers: 4 })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("with joiners, who wait for the next Match, seed %i", (seed) => {
    expect(simulate(scribblePick, { players: 3, seed, joiners: 5 })).toMatchObject({ ok: true, problems: [] });
  });
});

const players = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

function begin(count: number, seed = 3): Match {
  const begun = startMatch(scribblePick, { players: players(count), seed });
  if (!begun.ok) throw new Error(begun.why);
  return begun.match;
}

/** Each Player's secret word, read from the only place it is shown: their own phone. */
function secrets(match: Match): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [id, view] of Object.entries(match.views().controllers)) {
    const text = JSON.stringify(view);
    const word = WORDS.find((w) => text.includes(`Draw: ${w}"`));
    if (word !== undefined) found[id] = word;
  }
  return found;
}

const line: Drawing = { strokes: [{ color: "#ffffff", width: 6, points: [100, 100, 900, 900] }] };

test("every phone gets a different secret word, and the Screen shows none until its drawing is revealed", () => {
  const match = begin(5);
  const words = secrets(match);
  expect(Object.keys(words)).toHaveLength(5);
  expect(new Set(Object.values(words)).size).toBe(5);

  const unrevealed = new Set(Object.values(words));
  const screenLeaks = () => [...unrevealed].filter((word) => JSON.stringify(match.views().screen).includes(word));
  expect(screenLeaks()).toEqual([]);
  for (const id of Object.keys(words)) match.act(id, { type: "draw", drawing: line });

  // Picking, then a reveal, for each of the five drawings.
  for (let shown = 0; shown < 5; shown++) {
    expect(screenLeaks()).toEqual([]);
    const outcome = match.timerFired();
    const revealed = [...unrevealed].filter((word) => JSON.stringify(match.views().screen).includes(word));
    expect(revealed).toHaveLength(1);
    unrevealed.delete(revealed[0]!);
    expect(outcome.status).toBe("running");
    match.timerFired();
  }
  expect(match.snapshot().status).toBe("ended");
});

test("a right pick is a point for the picker and one for the artist", () => {
  const match = begin(3);
  const words = secrets(match);
  for (const id of Object.keys(words)) match.act(id, { type: "draw", drawing: line });
  const scores: Record<string, number> = { p1: 0, p2: 0, p3: 0 };
  for (let shown = 0; shown < 3; shown++) {
    const screen = JSON.stringify(match.views().screen);
    expect(screen).toContain("What is it?");
    // Whoever's phone says "This one is yours" is the artist; the other two pick: one right, one wrong.
    const views = match.views().controllers;
    const artist = Object.keys(views).find((id) => JSON.stringify(views[id]).includes("This one is yours"))!;
    const [right, wrong] = ["p1", "p2", "p3"].filter((id) => id !== artist);
    const options = JSON.stringify(views[right!]);
    const other = WORDS.find((w) => w !== words[artist] && options.includes(`"word":"${w}"`))!;
    match.act(right!, { type: "pick", word: words[artist]! });
    match.act(wrong!, { type: "pick", word: other });
    scores[right!] = (scores[right!] ?? 0) + 1;
    scores[artist] = (scores[artist] ?? 0) + 1;
    const after = match.timerFired();
    if (shown === 2) expect(after).toEqual({ status: "ended", reason: "finished", end: { scores } });
  }
});

test("the most Players, each sending the biggest drawing a pad allows, still fit every limit", () => {
  // 200 strokes and 2,000 points in all, at the far corner, where the numbers are longest.
  const perStroke = MAX_DRAWING_POINTS / MAX_STROKES;
  const biggest: Drawing = {
    strokes: Array.from({ length: MAX_STROKES }, () => ({ color: "#ffffff", width: 40, points: Array.from({ length: perStroke }, () => 1000) })),
  };
  const match = begin(8);
  for (const p of players(8)) expect(match.act(p.id, { type: "draw", drawing: biggest }).status).toBe("running");
  for (let step = 0; step < 16 && match.snapshot().status === "running"; step++) expect(match.timerFired().status).not.toBe("broken");
  expect(match.snapshot().status).toBe("ended");
});
