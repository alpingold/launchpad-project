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

// --- Joining (M3) ---------------------------------------------------------------

/** Opens a host, creates a room, and returns { host, code } with the create messages consumed. */
async function hostRoom() {
  const host = await openClient(url);
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();
  await host.next(); // initial room:state
  return { host, code };
}

/** Reads messages until one of the given type arrives (skipping others). */
async function nextOfType(client, type) {
  for (;;) {
    const msg = await client.next();
    if (msg.type === type) return msg;
  }
}

test('two players join; host and both players see the same live list', async () => {
  const { host, code } = await hostRoom();

  const alex = await openClient(url);
  alex.send({ type: 'player:join', code: code.toLowerCase(), name: 'Alex' }); // lowercase code is fine
  const joined = await alex.next();
  assert.equal(joined.type, 'room:joined');
  assert.equal(joined.name, 'Alex');

  const blake = await openClient(url);
  blake.send({ type: 'player:join', code, name: 'Blake' });
  await nextOfType(blake, 'room:joined');

  // Host sees one update per join; the second one has both names.
  await nextOfType(host, 'room:state');
  const hostState = await nextOfType(host, 'room:state');
  assert.deepEqual(hostState.players.map((p) => p.name), ['Alex', 'Blake']);

  const alexState = await nextOfType(alex, 'room:state'); // after own join
  assert.deepEqual(alexState.players.map((p) => p.name), ['Alex']);
  assert.deepEqual((await nextOfType(alex, 'room:state')).players.map((p) => p.name), ['Alex', 'Blake']);

  for (const c of [host, alex, blake]) c.close();
});

test('duplicate name gets NAME_TAKEN and the socket can retry with another name', async () => {
  const { host, code } = await hostRoom();
  const alex = await openClient(url);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  await nextOfType(alex, 'room:joined');

  const copycat = await openClient(url);
  copycat.send({ type: 'player:join', code, name: 'ALEX' });
  const err = await copycat.next();
  assert.equal(err.code, 'NAME_TAKEN');
  assert.equal(err.requestType, 'player:join');

  copycat.send({ type: 'player:join', code, name: 'Alex 2' });
  assert.equal((await copycat.next()).type, 'room:joined');
  for (const c of [host, alex, copycat]) c.close();
});

test('wrong code gets ROOM_NOT_FOUND', async () => {
  const player = await openClient(url);
  player.send({ type: 'player:join', code: 'ZZZZ', name: 'Alex' });
  assert.equal((await player.next()).code, 'ROOM_NOT_FOUND');
  player.close();
});

test('a player closing their tab disappears from the host list', async () => {
  const { host, code } = await hostRoom();
  const alex = await openClient(url);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  await nextOfType(alex, 'room:joined');
  assert.equal((await nextOfType(host, 'room:state')).players.length, 1);

  alex.close();
  assert.deepEqual((await nextOfType(host, 'room:state')).players, []);
  host.close();
});

test('host leaving sends room:closed to players', async () => {
  const { host, code } = await hostRoom();
  const alex = await openClient(url);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  await nextOfType(alex, 'room:joined');

  host.close();
  assert.deepEqual(await nextOfType(alex, 'room:closed'), { type: 'room:closed', reason: 'host_left' });
  alex.close();
});
