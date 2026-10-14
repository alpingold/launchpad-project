import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLOCKS, BLOCK_TYPES } from '../../src/games/kit/blocks.js';
import { validateScreen, offeredActions, readAction, assetIdsIn, sameJson, MAX_BLOCKS, MAX_DEPTH } from '../../src/games/kit/screen.js';
import { seededRandom } from '../../src/games/random.js';
import { checkStrokes } from '../../src/games/kit/drawing.js';
import { config } from '../../src/config.js';

// The game kit (plan §12): blocks, screens, and the checks on them.

const screen = (...blocks) => ({ blocks });
const text = (t = 'Hi') => ({ type: 'text', text: t });

test('every block example is a valid screen', () => {
  for (const type of BLOCK_TYPES) {
    assert.equal(BLOCKS[type].example.type, type, `${type}'s example has the right type`);
    assert.equal(validateScreen(screen(BLOCKS[type].example)), null, type);
  }
});

test('every block has a purpose, a group, and a component on the client (server and client stay in sync)', () => {
  // Blocks are defined on the server (for checking) and drawn on the client. This catches
  // adding a block on one side but not the other.
  const index = readFileSync(new URL('../../../client/src/game/blocks/index.jsx', import.meta.url), 'utf8');
  const map = index.slice(index.indexOf('BLOCK_COMPONENTS'));
  for (const type of BLOCK_TYPES) {
    assert.ok(BLOCKS[type].purpose.length > 10, `${type} purpose`);
    assert.ok(['layout', 'display', 'input', 'widget'].includes(BLOCKS[type].group), `${type} group`);
    assert.match(map, new RegExp(`\\b${type}:`), `client/src/game/blocks/index.jsx has no component for "${type}"`);
  }
});

test('a screen is { blocks: [...] }', () => {
  for (const bad of [null, 'hi', [], 42]) assert.match(validateScreen(bad), /must be an object like \{ blocks/);
  assert.match(validateScreen({}), /"blocks" must be a list of 1–30 blocks/);
  assert.match(validateScreen({ blocks: [] }), /"blocks" must be a list/);
  assert.match(validateScreen({ view: 'message', title: 'old style' }), /unknown screen field "view"/);
  assert.match(validateScreen({ blocks: [text()], title: 'x' }), /unknown screen field "title"/);
});

test('problems say exactly where they are, so the AI can fix them', () => {
  const cases = [
    [screen({ type: 'html', html: '<b>hi</b>' }), /^blocks\[0\] has unknown block type "html" \(known: column, row/],
    [screen({ type: 'constructor' }), /unknown block type "constructor"/],
    [screen('hi'), /^blocks\[0\] must be a block object/],
    [screen({ type: 'button', lable: 'Go', action: {} }), /^blocks\[0\] \(button\): unknown field "lable" \(allowed: label, action, asset, size, tone\)/],
    [screen({ type: 'button', label: 'Go' }), /^blocks\[0\] \(button\): "action" is missing/],
    [screen({ type: 'text', text: '' }), /"text" must be a non-empty string/],
    [screen({ type: 'text', text: 'x'.repeat(501) }), /at most 500 characters \(got 501\)/],
    [screen({ type: 'text', text: 'Hi', size: 'giant' }), /"size" must be one of "small" \| "normal" \| "big" \| "huge"/],
    [screen({ type: 'image', asset: 'https://evil.example/x.png' }), /"asset" must be an asset id/],
    [screen({ type: 'grid', columns: 7, children: [text()] }), /"columns" must be ≥ 2, ≤ 6/],
    [screen({ type: 'row', children: [text(), { type: 'text', txt: 'x' }] }), /^blocks\[0\]\.children\[1\] \(text\): unknown field "txt"/],
    [screen({ type: 'choice', options: [] }), /"options" must have 1–12 items/],
    [screen({ type: 'choice', options: [{ label: 'A', action: 5 }] }), /"options" item 0: "action" must be an object/],
    [screen({ type: 'timer', endsAt: 5000, style: 'bar' }), /a "bar" timer needs "startedAt"/],
    [screen({ type: 'timer', endsAt: 5000, startedAt: 6000 }), /"startedAt" must be before "endsAt"/],
    [screen({ type: 'progress', value: 6, max: 5 }), /"value" must not be more than "max"/],
    [screen({ type: 'scoreboard', rows: [{ playerId: 'p1', score: 'lots' }] }), /item 0: "score" must be a number/],
  ];
  for (const [s, pattern] of cases) assert.match(validateScreen(s) ?? 'valid', pattern, JSON.stringify(s));
});

test('limits: nesting depth and total blocks', () => {
  let deep = text();
  for (let i = 1; i < MAX_DEPTH; i++) deep = { type: 'column', children: [deep] };
  assert.equal(validateScreen(screen(deep)), null, `${MAX_DEPTH} levels are fine`);
  assert.match(validateScreen(screen({ type: 'card', children: [deep] })), /nested too deeply \(at most 5 levels\)/);

  const many = Array.from({ length: 30 }, () => text());
  assert.equal(validateScreen(screen({ type: 'column', children: many }, { type: 'column', children: many.slice(0, MAX_BLOCKS - 32) })), null);
  assert.match(validateScreen(screen({ type: 'column', children: many }, { type: 'column', children: many })), /too many blocks: a screen can have at most 60/);
});

test('player ids must be players in the game, when the runner says who they are', () => {
  const s = screen({ type: 'playerName', playerId: 'p_ghost' });
  assert.equal(validateScreen(s), null, 'without a player list, any id is fine');
  assert.match(validateScreen(s, { playerIds: new Set(['p_alex']) }), /"p_ghost" isn't a player in this game/);
  const board = screen({ type: 'scoreboard', rows: [{ playerId: 'p_alex', score: 1 }] });
  assert.equal(validateScreen(board, { playerIds: new Set(['p_alex']) }), null);
});

test('offeredActions finds every button and choice option, however deeply nested', () => {
  const s = screen(
    text(),
    { type: 'button', label: 'Go', action: { go: 1 } },
    { type: 'card', children: [{ type: 'row', children: [{ type: 'choice', options: [{ label: 'A', action: { a: 1 } }, { label: 'B', action: { b: 1 } }] }] }] },
  );
  assert.deepEqual(offeredActions(s), [{ go: 1 }, { a: 1 }, { b: 1 }]);
  assert.deepEqual(offeredActions(screen(text())), []);
  assert.deepEqual(offeredActions(undefined), []);
});

test('input blocks: rules between fields', () => {
  const cases = [
    [{ type: 'multiChoice', options: [{ label: 'A' }, { label: 'B' }], max: 3, action: {} }, /"max" must not be more than the number of options/],
    [{ type: 'multiChoice', options: [{ label: 'A' }, { label: 'B' }], min: 2, max: 1, action: {} }, /"min" must not be more than "max"/],
    [{ type: 'slider', min: 5, max: 5, action: {} }, /"min" must be less than "max"/],
    [{ type: 'slider', min: 0, max: 100000, action: {} }, /too many steps/],
    [{ type: 'slider', min: 0, max: 10, initial: 11, action: {} }, /"initial" must be between/],
    [{ type: 'textInput', maxLength: 500, action: {} }, /"maxLength" must be ≥ 1, ≤ 200/],
    [{ type: 'rank', items: [{ label: 'Only one' }], action: {} }, /"items" must have 2–8 items/],
  ];
  for (const [block, pattern] of cases) assert.match(validateScreen(screen(block)) ?? 'valid', pattern, JSON.stringify(block));
});

test('readAction: only actions on the screen, and only valid input, get through (cleaned up)', () => {
  const s = screen(
    { type: 'button', label: 'Go', action: { go: 1 } },
    { type: 'textInput', maxLength: 10, action: { say: 1 } },
    { type: 'multiChoice', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], max: 2, action: { tick: 1 } },
    { type: 'slider', min: 0, max: 1, step: 0.1, action: { slide: 1 } },
    { type: 'rank', items: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], action: { order: 1 } },
  );
  const ok = (action, input, expected) => assert.deepEqual(readAction(s, action, input), { ok: true, input: expected }, JSON.stringify([action, input]));
  const no = (action, input, pattern) => {
    const result = readAction(s, action, input);
    assert.equal(result.ok, false, JSON.stringify([action, input]));
    assert.match(result.problem, pattern);
  };

  ok({ go: 1 }, undefined, undefined);
  no({ go: 1 }, 'extra', /a button sends no input/);
  no({ go: 2 }, undefined, /isn't on the player's screen/);

  ok({ say: 1 }, '  Hello  ', 'Hello');
  ok({ say: 1 }, 'e\u0301', '\u00e9'); // normalized, so "é" typed two ways is the same text
  no({ say: 1 }, '   ', /must be 1–10 characters/);
  no({ say: 1 }, 'x'.repeat(11), /must be 1–10 characters/);
  no({ say: 1 }, 'a\nb', /control characters/);
  no({ say: 1 }, 'hi\u202e', /control characters/); // invisible right-to-left override
  no({ say: 1 }, 42, /must be text/);
  no({ say: 1 }, undefined, /must be text/);

  ok({ tick: 1 }, [2, 0], [0, 2]);
  no({ tick: 1 }, [], /must pick 1–2 options/);
  no({ tick: 1 }, [0, 1, 2], /must pick 1–2 options/);
  no({ tick: 1 }, [0, 0], /the same option twice/);
  no({ tick: 1 }, [3], /option indexes/);
  no({ tick: 1 }, '0', /option indexes/);

  ok({ slide: 1 }, 0.30000000000000004, 0.3);
  ok({ slide: 1 }, 1, 1);
  no({ slide: 1 }, 0.35, /on a step of 0.1/);
  no({ slide: 1 }, 2, /from 0 to 1/);
  no({ slide: 1 }, '0.5', /from 0 to 1/);

  ok({ order: 1 }, [2, 0, 1], [2, 0, 1]);
  no({ order: 1 }, [0, 1], /every item index/);
  no({ order: 1 }, [0, 0, 1], /every item index/);
});

test('widgets: results are checked, and impossible ones dropped', () => {
  const GO = 1_000_000;
  const s = screen(
    { type: 'reaction', goAt: GO, action: { tap: 1 } },
    { type: 'mash', startsAt: GO, durationMs: 5000, action: { mash: 1 } },
    { type: 'timingBar', target: { from: 400, to: 600 }, action: { stop: 1 } },
    { type: 'tapTargets', startsAt: GO, durationMs: 10_000, count: 5, seed: 7, action: { hit: 1 } },
  );
  const read = (action, input, now = GO + 1000) => readAction(s, action, input, { now });

  assert.deepEqual(read({ tap: 1 }, { ms: 250 }), { ok: true, input: { ms: 250 } });
  assert.deepEqual(read({ tap: 1 }, { early: true }, GO - 2000), { ok: true, input: { early: true } }, 'too early is a real result');
  assert.match(read({ tap: 1 }, { ms: 250 }, GO - 2000).problem, /arrived before GO/);
  assert.match(read({ tap: 1 }, { ms: 20 }).problem, /\{ ms \} \(80–10000\)/, 'faster than a human');
  assert.match(read({ tap: 1 }, { ms: 250, early: true }).problem, /\{ ms \}/);

  assert.deepEqual(read({ mash: 1 }, { taps: 60 }), { ok: true, input: { taps: 60 } });
  assert.match(read({ mash: 1 }, { taps: 101 }).problem, /"taps" must be a whole number from 0 to 100/, '20 taps a second at most');
  assert.match(read({ mash: 1 }, { taps: 3.5 }).problem, /whole number/);

  assert.deepEqual(read({ stop: 1 }, { position: 512 }), { ok: true, input: { position: 512 } });
  assert.match(read({ stop: 1 }, { position: 1001 }).problem, /0 to 1000/);

  assert.deepEqual(read({ hit: 1 }, { hits: 5, ms: 4200 }), { ok: true, input: { hits: 5, ms: 4200 } });
  assert.match(read({ hit: 1 }, { hits: 6, ms: 4200 }).problem, /"hits" must be a whole number from 0 to 5/);
  assert.match(read({ hit: 1 }, { hits: 5 }).problem, /must be \{ hits, ms \}/);
});

test('drawings: the format, its limits, and the pen colors', () => {
  const pad = screen({ type: 'drawPad', colors: ['black', 'red'], action: { draw: 1 } });
  const line = (color = 'black') => ({ color, points: [0, 0, 1000, 750] });
  const read = (strokes) => readAction(pad, { draw: 1 }, { strokes });
  assert.deepEqual(read([line(), line('red')]), { ok: true, input: { strokes: [line(), line('red')] } });
  assert.match(read([line('blue')]).problem, /a color that isn't on this drawPad/);
  assert.match(read([{ color: 'chartreuse', points: [0, 0] }]).problem, /color must be one of black, white/);
  assert.match(read([{ color: 'black', points: [0, 0, 1001, 0] }]).problem, /x 0–1000 and y 0–750/);
  assert.match(read([{ color: 'black', points: [0, 0, 5] }]).problem, /points must be \[x1, y1/);
  assert.match(read([{ color: 'black', points: [1.5, 2] }]).problem, /whole numbers/);
  assert.match(read([{ color: 'black', points: [0, 0], width: 99 }]).problem, /must be \{ color, points \}/);
  assert.match(read([]).problem, /empty drawing/);
  const huge = [{ color: 'black', points: Array.from({ length: 1501 * 2 }, () => 1) }];
  assert.match(read(huge).problem, /too many points \(at most 1500\)/);

  // The same format shows on screens, and a full-size drawing fits easily.
  assert.equal(validateScreen(screen({ type: 'drawing', strokes: [line()] })), null);
  assert.match(validateScreen(screen({ type: 'drawing', strokes: 'a cat' })), /"strokes" must be a list of strokes/);
  // The biggest drawing a phone can send: every stroke and point used, longest numbers.
  const biggest = Array.from({ length: 150 }, () => ({ color: 'purple', points: Array.from({ length: 20 }, (_, i) => (i % 2 ? 750 : 1000)) }));
  assert.equal(checkStrokes(biggest), null);
  assert.ok(JSON.stringify(biggest).length < 20_000, 'a maximum drawing is under 20 KB');
  // ...and a gallery of 12 of them (one per player) still fits in one screen.
  const gallery = {
    blocks: [
      { type: 'text', text: 'Vote for your favorite!', size: 'big' },
      { type: 'grid', columns: 3, children: Array.from({ length: 12 }, (_, i) => ({ type: 'drawing', strokes: biggest, size: 'small', caption: `${i + 1}` })) },
    ],
  };
  assert.equal(validateScreen(gallery), null);
  assert.ok(JSON.stringify(gallery).length < config.GAME_MAX_PAYLOAD_BYTES, 'a 12-drawing gallery fits in one screen');
});

test('multiline text inputs allow line breaks', () => {
  const s = screen({ type: 'textInput', multiline: true, action: { say: 1 } });
  assert.deepEqual(readAction(s, { say: 1 }, 'line one\nline two'), { ok: true, input: 'line one\nline two' });
});

test("the bots' inputs are always valid (every input block, many seeds)", () => {
  for (const type of BLOCK_TYPES.filter((t) => BLOCKS[t].input)) {
    const block = BLOCKS[type].example;
    for (let seed = 1; seed <= 50; seed++) {
      const input = BLOCKS[type].input.bot(block, seededRandom(seed));
      assert.equal(readAction(screen(block), block.action, input).ok, true, `${type} seed ${seed}: ${JSON.stringify(input)}`);
    }
  }
});

test('assetIdsIn finds images, buttons and choice options', () => {
  const s = screen(
    { type: 'image', asset: 'trophy' },
    { type: 'row', children: [{ type: 'button', label: 'Go', action: {}, asset: 'go-sign' }] },
    { type: 'choice', options: [{ label: 'A', action: {}, asset: 'dragon' }, { label: 'B', action: {} }] },
  );
  assert.deepEqual(assetIdsIn(s), ['trophy', 'go-sign', 'dragon']);
});

test('sameJson compares JSON values regardless of key order', () => {
  const same = [
    [{ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }],
    [null, null],
    ['x', 'x'],
    [{ nested: { deep: true } }, { nested: { deep: true } }],
  ];
  const different = [
    [{ a: 1 }, { a: 2 }],
    [{ a: 1 }, { a: 1, b: 2 }],
    [[1, 2], [2, 1]],
    [{ a: [1] }, { a: { 0: 1 } }],
    [{ a: undefined }, { b: undefined }],
    [null, {}],
  ];
  for (const [a, b] of same) assert.ok(sameJson(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  for (const [a, b] of different) assert.ok(!sameJson(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
});
