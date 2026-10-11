import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { openClient } from '../helpers/wsClient.js';

// The full server (transport + router + rooms) over real sockets.
let server;
let url;

beforeEach(async () => {
  server = createGameServer();
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  url = `ws://localhost:${server.httpServer.address().port}/ws`;
});

afterEach(() => server.close());

/** Waits until `check()` is true (server-side cleanup runs a moment after a client closes). */
async function eventually(check, timeoutMs = 1000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition never became true');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('host creates a room and receives its code and state', async () => {
  const host = await openClient(url);
  host.send({ type: 'host:create_room' });

  const created = await host.next();
  assert.equal(created.type, 'room:created');
  assert.match(created.code, /^[A-Z]{4}$/);

  const state = await host.next();
  assert.equal(state.type, 'room:state');
  assert.equal(state.code, created.code);
  assert.deepEqual(state.players, []);
  host.close();
});

test('creating a second room on the same socket is refused', async () => {
  const host = await openClient(url);
  host.send({ type: 'host:create_room' });
  await host.next();
  await host.next();

  host.send({ type: 'host:create_room' });
  const err = await host.next();
  assert.equal(err.code, 'ALREADY_IN_ROOM');
  assert.equal(server.rooms.rooms.size, 1);
  host.close();
});

test('two hosts get two different rooms', async () => {
  const a = await openClient(url);
  const b = await openClient(url);
  a.send({ type: 'host:create_room' });
  b.send({ type: 'host:create_room' });
  const [ca, cb] = [await a.next(), await b.next()];
  assert.notEqual(ca.code, cb.code);
  a.close();
  b.close();
});

test('closing the host socket removes the room', async () => {
  const host = await openClient(url);
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();
  assert.ok(server.rooms.getRoom(code));

  host.close();
  await eventually(() => server.rooms.getRoom(code) === undefined);
  assert.equal(server.rooms.members.size, 0);
});
