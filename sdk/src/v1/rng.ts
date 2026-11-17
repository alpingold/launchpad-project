/**
 * The seeded random numbers behind `ctx.rng`.
 *
 * Why seeded: the same seed gives the same numbers on every machine, so a Match can be replayed,
 * saved and resumed, and simulated in tests. `Math.random` can do none of that.
 *
 * The algorithm is sfc32 ("Small Fast Counting", from the PractRand suite): four 32-bit numbers of
 * state, well tested, and simple enough to read in full below. Its whole state is four numbers, so
 * a saved Match stores them and carries on exactly where it stopped.
 */
import type { Rng } from "./game.js";

/** Everything the generator remembers: plain data, saved with the Match. */
export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

/** An `Rng` that can also report its state, for saving. */
export interface SeededRng extends Rng {
  state(): RngState;
}

/** A generator started from `seed`, a whole number. Only its lowest 32 bits are used. */
export function createRng(seed: number): SeededRng {
  // Fixed constants (digits of well-known irrational numbers) in a, b and c, the seed in d. The
  // first outputs are thrown away so seeds that differ in one bit soon give unrelated numbers.
  const rng = new Sfc32({ a: 0x9e3779b9, b: 0x243f6a88, c: 0xb7e15162, d: seed >>> 0 });
  for (let i = 0; i < 20; i++) rng.next();
  return rng;
}

/** A generator that continues from a saved state. */
export function restoreRng(state: RngState): SeededRng {
  return new Sfc32(state);
}

/** True if `value` is a state `restoreRng` can continue from: four whole numbers from 0 to 2^32 - 1. */
export function isRngState(value: unknown): value is RngState {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 4 &&
    ["a", "b", "c", "d"].every((k) => {
      const n: unknown = (value as Record<string, unknown>)[k];
      return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;
    })
  );
}

class Sfc32 implements SeededRng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    this.a = state.a >>> 0;
    this.b = state.b >>> 0;
    this.c = state.c >>> 0;
    this.d = state.d >>> 0;
  }

  state(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  next(): number {
    // `| 0` and `>>> 0` keep every number a 32-bit whole number, as the algorithm needs.
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    return (t >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError(`rng.int(min, max) needs two whole numbers with min <= max; it was given ${String(min)} and ${String(max)}`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (!Array.isArray(items) || items.length === 0) throw new RangeError("rng.pick(items) needs a list with at least one item");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    if (!Array.isArray(items)) throw new RangeError("rng.shuffle(items) needs a list");
    // Fisher–Yates: every order equally likely. Works on a copy; the original is left alone.
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  }
}
