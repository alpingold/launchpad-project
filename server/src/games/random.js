import { randomInt } from 'node:crypto';

/**
 * A seeded random number generator ("mulberry32", a small well-known algorithm).
 *
 * Same seed → same sequence of numbers. Games get their randomness from this (ctx.random)
 * so a test can pass a fixed seed and get the exact same game every run.
 * Not for secrets (tokens use crypto); it's for dice rolls and shuffles.
 *
 * @param {number} seed  any 32-bit integer
 * @returns {() => number}  returns numbers in [0, 1), like Math.random
 */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh unpredictable seed for real games. */
export function newSeed() {
  return randomInt(0, 2 ** 32 - 1);
}
