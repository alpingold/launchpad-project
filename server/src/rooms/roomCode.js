import { randomInt as cryptoRandomInt } from 'node:crypto';

// Letters used in room codes. No vowels (A E I O U) and no Y, so codes can't
// accidentally spell words, and no I/O to confuse with 1/0 on a TV screen.
// 20 letters, so there are 20^4 = 160,000 possible codes.
export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;

/**
 * Makes a random room code that isn't already in use.
 *
 * @param {(code: string) => boolean} isTaken  returns true if a room already uses this code
 * @param {(max: number) => number} [randomInt]  returns an integer in [0, max). Injectable so
 *   tests can pick the letters. Defaults to crypto.randomInt, which is unpredictable
 *   (Math.random would also work; codes aren't secrets, but this costs nothing).
 * @param {number} [maxAttempts]
 */
export function generateRoomCode(isTaken, randomInt = cryptoRandomInt, maxAttempts = 50) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    if (!isTaken(code)) return code;
  }
  // Only reachable if almost every code is taken. MAX_ROOMS keeps us far from that.
  throw new Error(`could not find a free room code after ${maxAttempts} attempts`);
}
