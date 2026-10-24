import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from '../../src/transport/clientIp.js';

// The visitor's address for a WebSocket upgrade (plan §59): behind Caddy, from X-Forwarded-For,
// but only when the connection really came from this machine and TRUST_PROXY says to.

const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } });

test('without a trusted proxy, the address the socket came from', () => {
  assert.equal(clientIp(req('203.0.113.7'), false), '203.0.113.7');
  assert.equal(clientIp(req('127.0.0.1', '198.51.100.1'), false), '127.0.0.1', 'the header means nothing without TRUST_PROXY');
});

test("behind Caddy (on this machine), the address Caddy saw: the header's last entry", () => {
  assert.equal(clientIp(req('127.0.0.1', '198.51.100.1'), 'loopback'), '198.51.100.1');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '10.0.0.9, 198.51.100.1'), 'loopback'), '198.51.100.1');
  assert.equal(clientIp(req('127.0.0.1'), 'loopback'), '127.0.0.1', 'no header: the proxy itself');
});

test('a visitor reaching Node directly cannot pick their address with the header', () => {
  assert.equal(clientIp(req('203.0.113.7', '127.0.0.1'), 'loopback'), '203.0.113.7');
});
