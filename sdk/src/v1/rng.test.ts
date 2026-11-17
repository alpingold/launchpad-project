// The seeded generator behind ctx.rng. A saved Match depends on it giving the same numbers forever.
import { describe, expect, test } from "vitest";
import { createRng, isRngState, restoreRng } from "./rng.js";

const take = <T>(n: number, next: () => T): T[] => Array.from({ length: n }, next);

test("gives these exact numbers for seed 1, on every machine and in every future version", () => {
  // If this test fails, the algorithm changed and every saved Match would resume differently.
  const rng = createRng(1);
  expect(take(3, () => rng.next())).toEqual([0.5257062590681016, 0.4188396716490388, 0.12875984888523817]);
  expect(rng.state()).toEqual({ a: 1581085256, b: 871199504, c: 4077913083, d: 24 });
  const dice = createRng(0);
  expect(take(3, () => dice.int(1, 6))).toEqual([3, 6, 5]);
});

test("the same seed gives the same numbers; a different seed, different ones", () => {
  expect(take(100, () => createRng(9).next())).toEqual(take(100, () => createRng(9).next()));
  const a = createRng(9);
  const b = createRng(10);
  expect(take(10, () => a.next())).not.toEqual(take(10, () => b.next()));
});

test("a restored state continues exactly where the saved one stopped, even through JSON", () => {
  const original = createRng(5);
  take(37, () => original.next());
  const saved: unknown = JSON.parse(JSON.stringify(original.state()));
  expect(isRngState(saved)).toBe(true);
  const restored = restoreRng(saved as never);
  expect(take(50, () => restored.next())).toEqual(take(50, () => original.next()));
});

test("isRngState refuses anything that isn't four whole numbers from 0 to 2^32 - 1", () => {
  for (const bad of [null, "x", {}, { a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 3, d: -1 }, { a: 1, b: 2, c: 3, d: 2 ** 32 }, { a: 1, b: 2, c: 3, d: 0.5 }, { a: 1, b: 2, c: 3, d: 4, e: 5 }]) {
    expect(isRngState(bad)).toBe(false);
  }
});

describe("the Rng a Game uses", () => {
  test("next is in [0, 1)", () => {
    const rng = createRng(3);
    for (const n of take(10_000, () => rng.next())) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  test("int covers min to max, both included, and nothing else", () => {
    const rng = createRng(3);
    const seen = new Set(take(2_000, () => rng.int(-2, 3)));
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2, 3]);
    expect(rng.int(7, 7)).toBe(7);
  });

  test("int refuses a backwards or fractional range, with a message a Game author can act on", () => {
    const rng = createRng(3);
    expect(() => rng.int(6, 1)).toThrow("rng.int(min, max) needs two whole numbers with min <= max; it was given 6 and 1");
    expect(() => rng.int(0, 1.5)).toThrow(RangeError);
  });

  test("pick returns an item of the list, and refuses an empty one", () => {
    const rng = createRng(3);
    const items = ["a", "b", "c"];
    expect(new Set(take(200, () => rng.pick(items)))).toEqual(new Set(items));
    expect(() => rng.pick([])).toThrow("rng.pick(items) needs a list with at least one item");
  });

  test("shuffle returns a reordered copy and leaves the original alone", () => {
    const rng = createRng(3);
    const items = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const shuffled = rng.shuffle(items);
    expect([...shuffled].sort((x, y) => x - y)).toEqual([...items]);
    expect(shuffled).not.toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
