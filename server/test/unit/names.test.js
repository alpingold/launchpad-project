import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, validateName } from '../../src/rooms/names.js';

test('normalizeName trims and collapses whitespace', () => {
  assert.equal(normalizeName('  Alex  '), 'Alex');
  assert.equal(normalizeName('Mary   Jane'), 'Mary Jane');
  assert.equal(normalizeName('Tab\there'), 'Tab here');
});

test('normalizeName makes look-alike accents identical (NFC)', () => {
  const composed = 'José'; // é as one character
  const decomposed = 'José'; // e + combining accent
  assert.notEqual(composed, decomposed);
  assert.equal(normalizeName(decomposed), composed);
});

test('accepts ordinary names and returns a lowercase key', () => {
  assert.deepEqual(validateName('  Alex '), { ok: true, name: 'Alex', nameKey: 'alex' });
  assert.deepEqual(validateName('Mary Jane'), { ok: true, name: 'Mary Jane', nameKey: 'mary jane' });
  assert.equal(validateName('A').ok, true); // 1 char minimum
  assert.equal(validateName('x'.repeat(16)).ok, true); // 16 char maximum
});

test('accepts non-English names and emoji, counting an emoji as one character', () => {
  assert.equal(validateName('Zoë').ok, true);
  assert.equal(validateName('李小龙').ok, true);
  assert.equal(validateName('🦄'.repeat(16)).ok, true); // 16 emoji = 16 chars (32 UTF-16 units)
  assert.equal(validateName('🦄'.repeat(17)).ok, false);
});

test('rejects empty, whitespace-only, and too-long names', () => {
  for (const raw of ['', '   ', '\t\n', 'x'.repeat(17)]) {
    assert.deepEqual(validateName(raw), { ok: false }, JSON.stringify(raw));
  }
});

test('rejects control and invisible characters', () => {
  const cases = [
    'A\u0000B', // null byte
    'A\u0007B', // bell
    'Al\u200Bex', // zero-width space (would look like "Alex" but not equal it)
    '\u200B', // only a zero-width space
    'Alex\u202E', // right-to-left override (can flip how the rest of the screen reads)
  ];
  for (const raw of cases) assert.deepEqual(validateName(raw), { ok: false }, JSON.stringify(raw));
});

test('the byte order mark counts as whitespace in JS, so it is cleaned away rather than rejected', () => {
  // Either way, no invisible character ends up in a stored name.
  assert.deepEqual(validateName('A\uFEFF'), { ok: true, name: 'A', nameKey: 'a' });
  assert.deepEqual(validateName('A\uFEFFB'), { ok: true, name: 'A B', nameKey: 'a b' });
});

test('rejects non-strings', () => {
  for (const raw of [undefined, null, 42, {}]) assert.deepEqual(validateName(raw), { ok: false });
});
