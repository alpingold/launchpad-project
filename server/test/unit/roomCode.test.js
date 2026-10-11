import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomCode, ROOM_CODE_ALPHABET } from '../../src/rooms/roomCode.js';

/** A fake randomInt that returns the given numbers in order (then repeats the last one). */
function sequence(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('codes are 4 letters from the safe alphabet', () => {
  for (let i = 0; i < 500; i++) {
    const code = generateRoomCode(() => false);
    assert.match(code, /^[A-Z]{4}$/);
    for (const letter of code) assert.ok(ROOM_CODE_ALPHABET.includes(letter), `${letter} in ${code}`);
  }
});

test('alphabet has no vowels, Y, I, or O', () => {
  assert.doesNotMatch(ROOM_CODE_ALPHABET, /[AEIOUY]/);
  assert.equal(new Set(ROOM_CODE_ALPHABET).size, ROOM_CODE_ALPHABET.length, 'no duplicate letters');
});

test('uses the injected random numbers', () => {
  // indexes 0,1,2,3 → B C D F
  assert.equal(generateRoomCode(() => false, sequence(0, 1, 2, 3)), 'BCDF');
});

test('retries when a code is taken', () => {
  const taken = new Set(['BBBB']);
  // first attempt: 0,0,0,0 → BBBB (taken); second attempt: 1,1,1,1 → CCCC
  const code = generateRoomCode((c) => taken.has(c), sequence(0, 0, 0, 0, 1));
  assert.equal(code, 'CCCC');
});

test('gives up after too many attempts instead of looping forever', () => {
  assert.throws(() => generateRoomCode(() => true, undefined, 5), /after 5 attempts/);
});
