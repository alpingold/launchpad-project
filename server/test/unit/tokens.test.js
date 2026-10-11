import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newToken } from '../../src/rooms/tokens.js';
import { parseClientMessage } from '../../src/protocol/validate.js';

test('tokens are 22 URL-safe characters', () => {
  assert.match(newToken(), /^[A-Za-z0-9_-]{22}$/);
});

test('tokens are unique', () => {
  const tokens = new Set(Array.from({ length: 1000 }, newToken));
  assert.equal(tokens.size, 1000);
});

test('a generated token passes the protocol validator (so resume will accept it)', () => {
  const result = parseClientMessage(JSON.stringify({ type: 'host:resume', code: 'BCDF', hostToken: newToken() }));
  assert.equal(result.ok, true);
});
