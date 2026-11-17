// The drawing pad's ink: whole numbers in the 1000-square, whatever the pad's size, within the Drawing limits.
import { checkDrawing, MAX_DRAWING_POINTS, MAX_STROKES } from "@boilergames/sdk/v1/check";
import { expect, test } from "vitest";
import { Ink } from "./ink.js";

test("scales a pad of any size to the 1000-square, rounding to whole numbers", () => {
  const ink = new Ink();
  ink.start(0, 0, 300, "#000000", 10);
  ink.move(150, 75.4, 300);
  ink.move(300, 300, 300);
  expect(ink.drawing()).toEqual({ strokes: [{ color: "#000000", width: 10, points: [0, 0, 500, 251, 1000, 1000] }] });
});

test("skips a point that rounds to the same place as the one before", () => {
  const ink = new Ink();
  ink.start(10, 10, 1000, "#000000", 10);
  ink.move(10.2, 10.3, 1000);
  ink.move(10.4, 9.8, 1000);
  expect(ink.drawing().strokes[0]!.points).toEqual([10, 10]);
});

test("thins the strokes as the Drawing nears 2,000 points, so drawing can go on, and always stays valid", () => {
  const ink = new Ink();
  for (let stroke = 0; stroke < 30; stroke++) {
    ink.start(0, stroke, 1000, "#000000", 4);
    for (let i = 1; i < 300; i++) ink.move(i, stroke + (i % 7), 1000);
    ink.end();
    expect(ink.pointCount()).toBeLessThanOrEqual(MAX_DRAWING_POINTS);
  }
  expect(ink.drawing().strokes).toHaveLength(30);
  expect(checkDrawing(ink.drawing()).ok).toBe(true);
});

test(`holds at most ${MAX_STROKES} strokes: more are ignored`, () => {
  const ink = new Ink();
  for (let stroke = 0; stroke < MAX_STROKES + 5; stroke++) {
    ink.start(stroke, 0, 1000, "#000000", 4);
    ink.end();
  }
  expect(ink.drawing().strokes).toHaveLength(MAX_STROKES);
  expect(checkDrawing(ink.drawing()).ok).toBe(true);
});
