import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Password hashing with scrypt, built into Node (decision D15, no extra dependency).
//
// scrypt is *deliberately slow and memory-hungry*: checking one guess takes ~50 ms and
// 32 MB, so trying millions of guesses against a leaked database is impractical. A fast
// hash like SHA-256 would let an attacker try billions per second.
//
// Each password gets its own random salt, so two people with the same password get
// different hashes, and precomputed tables of common passwords are useless.
//
// The settings (N, r, p) are saved inside each hash string, so they can be raised later
// for new passwords while old hashes still verify with the settings they were made with.

const N = 2 ** 15; // cost: doubling it doubles the time and memory per guess
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024; // scrypt needs 128 * N * r bytes = 32 MB; allow headroom

/** @returns {Promise<string>} "scrypt$N$r$p$salt$hash" (salt and hash in base64) */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

/**
 * Checks a password against a stored hash.
 * @returns {Promise<boolean>} false for a wrong password or a malformed stored hash
 */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  let actual;
  try {
    actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEMORY,
    });
  } catch {
    return false; // impossible settings in the stored string: treat as "doesn't match"
  }
  // Constant-time comparison (see tokensEqual in rooms/tokens.js for why).
  return expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A real hash of a random password, used when someone logs in with a username that
 * doesn't exist: we still run verifyPassword against it, so "no such user" takes as long
 * as "wrong password" and response times don't reveal which usernames exist.
 */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));
