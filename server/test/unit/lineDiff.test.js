import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, changedLines } from '../../src/generation/lineDiff.js';

// The "changed lines" view for game versions (plan §12e, K6).

/** A diff as short strings: "  same", "- removed", "+ added". */
const show = (lines) => lines.map((l) => `${{ same: ' ', del: '-', add: '+' }[l.type]} ${l.text}`);

test('identical files: every line the same, no hunks', () => {
  const text = 'a\nb\nc\n';
  assert.deepEqual(show(diffLines(text, text)), ['  a', '  b', '  c']);
  assert.deepEqual(changedLines(text, text), { added: 0, removed: 0, hunks: [] });
});

test('a changed line shows as removed, then added, with line numbers on each side', () => {
  const lines = diffLines('one\ntwo\nthree\n', 'one\nTWO\nthree\n');
  assert.deepEqual(show(lines), ['  one', '- two', '+ TWO', '  three']);
  assert.deepEqual(
    lines.map((l) => [l.oldLine, l.newLine]),
    [
      [1, 1],
      [2, null],
      [null, 2],
      [3, 3],
    ],
  );
});

test('added and removed blocks, and empty files', () => {
  assert.deepEqual(show(diffLines('a\nd\n', 'a\nb\nc\nd\n')), ['  a', '+ b', '+ c', '  d']);
  assert.deepEqual(show(diffLines('a\nb\nc\n', 'c\n')), ['- a', '- b', '  c']);
  assert.deepEqual(show(diffLines('', 'x\n')), ['+ x']);
  assert.deepEqual(show(diffLines('x\n', '')), ['- x']);
  assert.deepEqual(show(diffLines('x', 'x\n')), ['  x'], 'a missing final newline is not a change');
});

test('hunks keep 3 lines of context, and nearby changes share a hunk', () => {
  const old = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const changed = old.replace('line 5\n', 'line five\n').replace('line 8\n', 'line eight\n').replace('line 25\n', '');
  const { added, removed, hunks } = changedLines(old, changed);
  assert.equal(added, 2);
  assert.equal(removed, 3);
  assert.equal(hunks.length, 2, 'lines 5 and 8 are close: one hunk; line 25 is far: another');
  assert.deepEqual(
    hunks[0].map((l) => l.oldLine ?? `+${l.newLine}`),
    [2, 3, 4, 5, '+5', 6, 7, 8, '+8', 9, 10, 11],
  );
  assert.deepEqual(show(hunks[1]), ['  line 22', '  line 23', '  line 24', '- line 25', '  line 26', '  line 27', '  line 28']);
});

test('files too big to compare give null instead of using lots of memory', () => {
  const huge = 'x\n'.repeat(2500);
  assert.equal(diffLines(huge, `${huge}y\n`), null);
  assert.equal(changedLines(huge, `${huge}y\n`), null);
});
