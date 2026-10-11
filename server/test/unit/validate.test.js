import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage, isPlainObject } from '../../src/protocol/validate.js';

const TOKEN = 'abcdefghijklmnopqrstuv'; // 22 chars, valid base64url shape

/** Helper: parse a JS value as if a client sent it as JSON text. */
const parse = (value) => parseClientMessage(JSON.stringify(value));

// --- Frames that aren't valid JSON objects ---------------------------------

test('rejects frames that are not JSON objects', () => {
  const cases = [
    ['not json', 'not json'],
    ['empty string', ''],
    ['null', 'null'],
    ['array', '[1,2]'],
    ['number', '42'],
    ['string', '"hello"'],
    ['truncated', '{"type": "room:leave"'],
  ];
  for (const [label, text] of cases) {
    const result = parseClientMessage(text);
    assert.deepEqual(result, { ok: false, code: 'BAD_MESSAGE' }, label);
  }
});

test('rejects binary frames even if they contain valid JSON', () => {
  const data = Buffer.from(JSON.stringify({ type: 'room:leave' }));
  assert.deepEqual(parseClientMessage(data, { isBinary: true }), { ok: false, code: 'BAD_MESSAGE' });
});

test('accepts a Buffer text frame (what `ws` actually delivers)', () => {
  const data = Buffer.from(JSON.stringify({ type: 'room:leave' }));
  assert.deepEqual(parseClientMessage(data), { ok: true, msg: { type: 'room:leave' } });
});

// --- The `type` field --------------------------------------------------------

test('rejects missing, non-string, and unknown types', () => {
  for (const value of [{}, { type: 5 }, { type: null }, { type: 'room:explode' }, { type: 'ROOM:LEAVE' }]) {
    assert.deepEqual(parse(value), { ok: false, code: 'UNKNOWN_TYPE' }, JSON.stringify(value));
  }
});

test('rejects types that match built-in object properties', () => {
  // `in` or SCHEMAS[type] lookups would find these on Object.prototype.
  for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.deepEqual(parse({ type }), { ok: false, code: 'UNKNOWN_TYPE' }, type);
  }
});

// --- Fields -------------------------------------------------------------------

test('player:join: cleans the room code and keeps the name', () => {
  const result = parse({ type: 'player:join', code: '  bxkt ', name: 'Alex' });
  assert.deepEqual(result, { ok: true, msg: { type: 'player:join', code: 'BXKT', name: 'Alex' } });
});

test('drops fields that are not in the schema', () => {
  const result = parse({ type: 'player:join', code: 'BXKT', name: 'Alex', isHost: true, score: 9999 });
  assert.deepEqual(result.msg, { type: 'player:join', code: 'BXKT', name: 'Alex' });
});

test('invalid fields report the type and field name', () => {
  const cases = [
    [{ type: 'player:join', name: 'Alex' }, 'code'], // missing
    [{ type: 'player:join', code: 'BXK', name: 'Alex' }, 'code'], // too short
    [{ type: 'player:join', code: 'BXKT1', name: 'Alex' }, 'code'], // too long
    [{ type: 'player:join', code: 'BX1T', name: 'Alex' }, 'code'], // digit
    [{ type: 'player:join', code: 1234, name: 'Alex' }, 'code'], // number
    [{ type: 'player:join', code: 'BXKT' }, 'name'], // missing
    [{ type: 'player:join', code: 'BXKT', name: 42 }, 'name'], // not a string
    [{ type: 'player:join', code: 'BXKT', name: 'x'.repeat(65) }, 'name'], // absurdly long
    [{ type: 'player:resume', code: 'BXKT', token: 'short' }, 'token'],
    [{ type: 'player:resume', code: 'BXKT', token: 'abcdefghijklmnopqrstu!' }, 'token'], // bad char
    [{ type: 'host:resume', code: 'BXKT' }, 'hostToken'],
    [{ type: 'host:kick', playerId: 'alex' }, 'playerId'],
    [{ type: 'host:start_game', gameId: 'Mario Board!' }, 'gameId'],
    [{ type: 'host:start_game', gameId: 'board', options: [1] }, 'options'],
    [{ type: 'game:action' }, 'action'],
    [{ type: 'game:action', action: 'jump' }, 'action'],
    [{ type: 'game:action', action: null }, 'action'],
  ];
  for (const [value, field] of cases) {
    assert.deepEqual(
      parse(value),
      { ok: false, code: 'INVALID_FIELDS', requestType: value.type, field },
      JSON.stringify(value),
    );
  }
});

test('accepts every message type with valid fields', () => {
  const valid = [
    { type: 'host:create_room' },
    { type: 'host:resume', code: 'BXKT', hostToken: TOKEN },
    { type: 'player:join', code: 'BXKT', name: 'Alex' },
    { type: 'player:resume', code: 'BXKT', token: TOKEN },
    { type: 'room:leave' },
    { type: 'host:kick', playerId: 'p_3f9a' },
    { type: 'host:start_game', gameId: 'reaction-race' },
    { type: 'host:start_game', gameId: 'reaction-race', options: { rounds: 3 } },
    { type: 'game:action', action: { tap: true } },
  ];
  for (const value of valid) {
    assert.deepEqual(parse(value), { ok: true, msg: value }, JSON.stringify(value));
  }
});

test('a name with control characters still passes here (M3 names.js rejects it)', () => {
  // Documents the split of responsibilities: validate.js checks shape, names.js checks content.
  assert.equal(parse({ type: 'player:join', code: 'BXKT', name: 'A\u0000B' }).ok, true);
});

test('isPlainObject', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject(JSON.parse('{"__proto__": {"x": 1}}')), true);
  const notPlain = [null, [], 'x', 1, true, undefined, new Date(), Object.create(null)];
  notPlain.forEach((value, i) => assert.equal(isPlainObject(value), false, `case ${i}`));
});
