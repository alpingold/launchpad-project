import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachWebSocketServer } from '../../src/transport/wsServer.js';
import { openClient } from '../helpers/wsClient.js';

// Each test gets a fresh server on a random port, with small limits so tests run fast.
// The handler echoes valid messages, and throws for `room:leave` to simulate a bug in our code.
let server;
let transport;
let url;
let disconnected; // ids of connections whose onDisconnect fired

beforeEach(async () => {
  // A fresh array captured by THIS test's handler, so sockets from the previous test
  // that finish closing late can't add to this test's count.
  const thisTestDisconnects = [];
  disconnected = thisTestDisconnects;
  server = http.createServer();
  transport = attachWebSocketServer(
    server,
    {
      onMessage(conn, msg) {
        if (msg.type === 'room:leave') throw new Error('simulated bug');
        conn.send({ type: 'echo', received: msg });
      },
      onDisconnect(conn) {
        thisTestDisconnects.push(conn.id);
      },
    },
    {
      HEARTBEAT_INTERVAL_MS: 50,
      MAX_BAD_MESSAGES: 3,
      RATE_LIMIT_PER_SEC: 1,
      RATE_LIMIT_BURST: 5,
      MAX_RATE_LIMIT_STRIKES: 4,
    },
  );
  await new Promise((resolve) => server.listen(0, resolve));
  url = `ws://localhost:${server.address().port}/ws`;
});

afterEach(async () => {
  transport.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('valid message reaches the handler, cleaned by validation', async () => {
  const client = await openClient(url);
  client.send({ type: 'player:join', code: ' bxkt ', name: 'Alex', isHost: true });
  assert.deepEqual(await client.next(), {
    type: 'echo',
    received: { type: 'player:join', code: 'BXKT', name: 'Alex' },
  });
  client.close();
});

test('bad messages get error replies and the socket stays usable', async () => {
  const client = await openClient(url);

  client.send('{not json');
  assert.equal((await client.next()).code, 'BAD_MESSAGE');

  client.send({ type: 'nope' });
  assert.equal((await client.next()).code, 'UNKNOWN_TYPE');

  client.send({ type: 'player:join', code: 'BXKT' });
  assert.deepEqual(await client.next(), {
    type: 'error',
    code: 'INVALID_FIELDS',
    message: 'A field in the message is missing or invalid.',
    requestType: 'player:join',
    field: 'name',
  });

  client.send({ type: 'host:create_room' });
  assert.equal((await client.next()).type, 'echo');
  client.close();
});

test('binary frames are rejected', async () => {
  const client = await openClient(url);
  client.ws.send(Buffer.from(JSON.stringify({ type: 'host:create_room' })), { binary: true });
  assert.equal((await client.next()).code, 'BAD_MESSAGE');
  client.close();
});

test('too many bad messages closes the connection with 1008', async () => {
  const client = await openClient(url);
  for (let i = 0; i < 4; i++) client.send('garbage'); // limit is 3
  const { code } = await client.closed;
  assert.equal(code, 1008);
});

test('oversized message closes the connection with 1009', async () => {
  const client = await openClient(url);
  client.send({ type: 'player:join', code: 'BXKT', name: 'x'.repeat(140_000) }); // over the 128 KB limit
  const { code } = await client.closed;
  assert.equal(code, 1009);
});

test('rate limit: burst passes, then one RATE_LIMITED reply, then close', async () => {
  const client = await openClient(url);
  for (let i = 0; i < 5; i++) client.send({ type: 'host:create_room' }); // burst is 5
  for (let i = 0; i < 5; i++) assert.equal((await client.next()).type, 'echo');

  client.send({ type: 'host:create_room' });
  assert.equal((await client.next()).code, 'RATE_LIMITED');

  // Keep spamming: no more error replies (no flood back), then closed at 4 strikes.
  for (let i = 0; i < 3; i++) client.send({ type: 'host:create_room' });
  const { code } = await client.closed;
  assert.equal(code, 1008);
});

test('a throwing handler returns INTERNAL_ERROR and the server keeps working', async () => {
  const client = await openClient(url);
  client.send({ type: 'room:leave' });
  assert.deepEqual(await client.next(), {
    type: 'error',
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong on the server.',
    requestType: 'room:leave',
  });

  // Same socket still works, and so does a brand-new one.
  client.send({ type: 'host:create_room' });
  assert.equal((await client.next()).type, 'echo');
  const other = await openClient(url);
  other.send({ type: 'host:create_room' });
  assert.equal((await other.next()).type, 'echo');
  client.close();
  other.close();
});

test('heartbeat drops a client that stops answering pings', async () => {
  // autoPong: false makes this client behave like a phone that lost signal.
  const client = await openClient(url, { autoPong: false });
  const { code } = await client.closed;
  assert.equal(code, 1006); // abnormal closure: the server terminated the socket
  // Give the server's own 'close' event a moment to run.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(disconnected.length, 1);
  assert.equal(transport.connections.size, 0);
});

test('heartbeat keeps a healthy client connected', async () => {
  const client = await openClient(url);
  await new Promise((r) => setTimeout(r, 200)); // several heartbeat intervals
  assert.equal(client.ws.readyState, WebSocket.OPEN);
  client.close();
});

test('onDisconnect runs when a client closes normally', async () => {
  const client = await openClient(url);
  client.close();
  await client.closed;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(disconnected.length, 1);
});

test('upgrades on other paths are refused', async () => {
  const badUrl = url.replace('/ws', '/not-ws');
  await assert.rejects(openClient(badUrl), /404/);
});
