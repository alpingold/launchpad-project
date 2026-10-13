import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateView, VIEW_KINDS, offeredActions, sameJson } from '../../src/games/views.js';

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

test('every view kind has a matching client component (server and client stay in sync)', () => {
  // The kinds are listed on the server (for checking) and drawn on the client. This catches
  // adding a kind on one side but not the other: "countdown" → client/src/game/views/CountdownView.jsx
  const viewsDir = new URL('../../../client/src/game/views/', import.meta.url);
  for (const kind of VIEW_KINDS) {
    const file = `${kind[0].toUpperCase()}${kind.slice(1)}View.jsx`;
    assert.ok(existsSync(fileURLToPath(new URL(file, viewsDir))), `missing client component ${file}`);
  }
});

test('offeredActions: a button offers its action, a choice each option, other views nothing', () => {
  assert.deepEqual(offeredActions({ view: 'button', label: 'Go', action: { go: 1 } }), [{ go: 1 }]);
  const choice = { view: 'choice', prompt: '?', options: [{ label: 'A', action: { a: 1 } }, { label: 'B', action: { b: 1 } }] };
  assert.deepEqual(offeredActions(choice), [{ a: 1 }, { b: 1 }]);
  assert.deepEqual(offeredActions({ view: 'message', title: 'Hi' }), []);
  assert.deepEqual(offeredActions(undefined), []);
});

test('sameJson compares JSON values regardless of key order', () => {
  const same = [
    [{ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 }],
    [{}, {}],
    ['x', 'x'],
  ];
  const different = [
    [{ a: 1 }, { a: '1' }],
    [{ a: 1 }, { a: 1, b: 2 }],
    [{ a: [1, 2] }, { a: [2, 1] }],
    [[1], { 0: 1 }],
    [{ a: null }, { a: {} }],
    [{ a: undefined }, { b: undefined }],
  ];
  for (const [a, b] of same) assert.ok(sameJson(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  for (const [a, b] of different) assert.ok(!sameJson(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
});
