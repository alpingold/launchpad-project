import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateView, VIEW_KINDS } from '../../src/games/views.js';

test('lists the five starting view kinds', () => {
  assert.deepEqual([...VIEW_KINDS].sort(), ['button', 'choice', 'countdown', 'message', 'scoreboard']);
});

test('accepts valid views of every kind', () => {
  const valid = [
    { view: 'message', title: 'Get ready…' },
    { view: 'message', title: 'Round 2', text: 'Tap when you see GO', asset: 'go-sign' },
    { view: 'button', label: 'TAP!', action: { tap: true } },
    { view: 'choice', prompt: 'Pick one', options: [{ label: 'A', action: { pick: 'a' } }, { label: 'B', action: { pick: 'b' }, asset: 'b-icon' }] },
    { view: 'countdown', title: 'Starting in', endsAt: 1760000000000 },
    { view: 'scoreboard', title: 'Results', rows: [{ playerId: 'p_1234abcd', score: 3 }] },
    { view: 'scoreboard', title: 'Nobody yet', rows: [] },
  ];
  for (const v of valid) assert.equal(validateView(v), null, JSON.stringify(v));
});

test('rejects non-objects and unknown kinds', () => {
  for (const v of [null, 'hi', [], 42]) assert.match(validateView(v), /must be an object/);
  assert.match(validateView({ view: 'html', html: '<b>hi</b>' }), /unknown view kind "html"/);
  assert.match(validateView({ title: 'no kind' }), /unknown view kind/);
  assert.match(validateView({ view: 'constructor' }), /unknown view kind/);
});

test('rejects unknown fields, so typos are caught in tests', () => {
  assert.equal(validateView({ view: 'button', lable: 'Go', action: {} }), 'button view: unknown field "lable"');
});

test('rejects bad field values with a message naming the field', () => {
  const cases = [
    [{ view: 'message' }, /"title" must be a non-empty string/],
    [{ view: 'message', title: '' }, /"title" must be a non-empty string/],
    [{ view: 'message', title: 'x'.repeat(101) }, /"title" must be at most 100/],
    [{ view: 'message', title: 'Hi', asset: '../etc/passwd' }, /"asset" must be an asset id/],
    [{ view: 'message', title: 'Hi', asset: 'https://evil.example/x.png' }, /"asset" must be an asset id/],
    [{ view: 'button', label: 'Go' }, /"action" must be an object/],
    [{ view: 'button', label: 'Go', action: 'tap' }, /"action" must be an object/],
    [{ view: 'choice', prompt: 'Pick', options: [] }, /1–8 options/],
    [{ view: 'choice', prompt: 'Pick', options: Array(9).fill({ label: 'x', action: {} }) }, /1–8 options/],
    [{ view: 'choice', prompt: 'Pick', options: [{ label: 'A' }] }, /option 0: "action"/],
    [{ view: 'choice', prompt: 'Pick', options: [{ label: 'A', action: {}, color: 'red' }] }, /option 0: unknown field "color"/],
    [{ view: 'countdown', title: 'Go', endsAt: 'soon' }, /"endsAt" must be a number/],
    [{ view: 'countdown', title: 'Go', endsAt: Infinity }, /"endsAt" must be a number/],
    [{ view: 'scoreboard', title: 'R', rows: [{ playerId: 'p_1', score: NaN }] }, /row 0: "score"/],
    [{ view: 'scoreboard', title: 'R', rows: Array(13).fill({ playerId: 'p', score: 1 }) }, /at most 12 rows/],
  ];
  for (const [v, pattern] of cases) assert.match(validateView(v), pattern, JSON.stringify(v));
});
