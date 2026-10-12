import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin } from '../../src/transport/origin.js';

const req = (host, origin) => ({ headers: origin === undefined ? { host } : { host, origin } });

test('same-site pages may connect', () => {
  assert.equal(isAllowedOrigin(req('localhost:5173', 'http://localhost:5173')), true);
  assert.equal(isAllowedOrigin(req('boilergames.example', 'https://boilergames.example')), true);
});

test('other sites may not (cross-site WebSocket hijacking)', () => {
  assert.equal(isAllowedOrigin(req('boilergames.example', 'https://evil.example')), false);
  assert.equal(isAllowedOrigin(req('boilergames.example', 'https://boilergames.example.evil.example')), false);
  assert.equal(isAllowedOrigin(req('localhost:5173', 'http://localhost:9999')), false, 'different port = different site');
});

test('garbage or "null" origins are refused', () => {
  for (const origin of ['null', 'not a url', '']) assert.equal(isAllowedOrigin(req('localhost:5173', origin)), false, origin);
});

test('no Origin header (not a browser) is allowed: such clients cannot borrow a visitor\'s cookies', () => {
  assert.equal(isAllowedOrigin(req('localhost:5173')), true);
});
