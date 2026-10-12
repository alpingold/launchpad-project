import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { openClient } from '../helpers/wsClient.js';
import { signUp } from '../helpers/accounts.js';

// The full server (transport + router + rooms) over real sockets.
let server;
let url;
let baseUrl;

beforeEach(async () => {
  // Short grace periods so timeout tests finish quickly (real value: 30 s).
  server = createGameServer({ HOST_GRACE_MS: 200, PLAYER_GRACE_MS: 200 });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const { port } = server.httpServer.address();
  url = `ws://localhost:${port}/ws`;
  baseUrl = `http://localhost:${port}`;
});

/** Hosting needs an account (M7): signs up a fresh one and opens a socket with its cookie. */
async function openHost() {
  return openClient(url, { headers: { Cookie: await signUp(baseUrl) } });
}

afterEach(() => server.close());

test('host creates a room and receives its code and state', async () => {
  const host = await openHost();
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
  const host = await openHost();
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
  const a = await openHost();
  const b = await openHost();
  a.send({ type: 'host:create_room' });
  b.send({ type: 'host:create_room' });
  const [ca, cb] = [await a.next(), await b.next()];
  assert.notEqual(ca.code, cb.code);
  a.close();
  b.close();
});

// --- Joining (M3) ---------------------------------------------------------------

/** Opens a host, creates a room, and returns { host, code } with the create messages consumed. */
async function hostRoom() {
  const host = await openHost();
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


// --- Disconnect, resume, leave, kick (M4) -------------------------------------------

/** Joins `name` to `code` and returns { client, joined } with room:joined consumed. */
async function joinAs(code, name) {
  const client = await openClient(url);
  client.send({ type: 'player:join', code, name });
  return { client, joined: await nextOfType(client, 'room:joined') };
}

test('host socket closing: players see the host as disconnected, then room:closed after the grace period', async () => {
  const { host, code } = await hostRoom();
  const { client: alex } = await joinAs(code, 'Alex');

  host.close();
  for (;;) {
    const state = await nextOfType(alex, 'room:state');
    if (state.hostConnected === false) break;
  }
  assert.deepEqual(await nextOfType(alex, 'room:closed'), { type: 'room:closed', reason: 'host_timeout' });
  assert.equal(server.rooms.getRoom(code), undefined);
  alex.close();
});

test('host refresh: a new socket resumes the same room with the host token', async () => {
  const host = await openHost();
  host.send({ type: 'host:create_room' });
  const { code, hostToken } = await host.next();
  const { client: alex } = await joinAs(code, 'Alex');

  host.close();
  const host2 = await openClient(url);
  host2.send({ type: 'host:resume', code, hostToken });
  assert.deepEqual(await host2.next(), { type: 'room:created', code, hostToken });
  const state = await nextOfType(host2, 'room:state');
  assert.equal(state.hostConnected, true);
  assert.deepEqual(state.players.map((p) => p.name), ['Alex']);

  await new Promise((r) => setTimeout(r, 400)); // past the 200 ms grace period
  assert.ok(server.rooms.getRoom(code), 'room survived because the host came back');
  host2.close();
  alex.close();
});

test('player refresh: resume keeps the same id and name', async () => {
  const { host, code } = await hostRoom();
  const { client: alex, joined } = await joinAs(code, 'Alex');

  alex.close();
  for (;;) {
    const state = await nextOfType(host, 'room:state');
    if (state.players[0]?.connected === false) break;
  }

  const alex2 = await openClient(url);
  alex2.send({ type: 'player:resume', code, token: joined.token });
  const rejoined = await alex2.next();
  assert.equal(rejoined.type, 'room:joined');
  assert.equal(rejoined.playerId, joined.playerId);
  assert.equal(rejoined.name, 'Alex');
  host.close();
  alex2.close();
});

test('player gone longer than the grace period: removed, and resume says SESSION_EXPIRED', async () => {
  const { host, code } = await hostRoom();
  const { client: alex, joined } = await joinAs(code, 'Alex');
  alex.close();
  for (;;) {
    const state = await nextOfType(host, 'room:state');
    if (state.players.length === 0) break;
  }
  const alex2 = await openClient(url);
  alex2.send({ type: 'player:resume', code, token: joined.token });
  assert.equal((await alex2.next()).code, 'SESSION_EXPIRED');
  host.close();
  alex2.close();
});

test('room:leave from a player and host:kick both remove the player right away', async () => {
  const { host, code } = await hostRoom();
  const { client: alex } = await joinAs(code, 'Alex');
  const { client: blake, joined: blakeJoined } = await joinAs(code, 'Blake');

  alex.send({ type: 'room:leave' });
  assert.deepEqual(await nextOfType(alex, 'room:closed'), { type: 'room:closed', reason: 'left' });

  host.send({ type: 'host:kick', playerId: blakeJoined.playerId });
  assert.deepEqual(await nextOfType(blake, 'room:closed'), { type: 'room:closed', reason: 'kicked' });

  for (;;) {
    const state = await nextOfType(host, 'room:state');
    if (state.players.length === 0) break;
  }
  for (const c of [host, alex, blake]) c.close();
});

test('host "End room" closes it for everyone immediately', async () => {
  const { host, code } = await hostRoom();
  const { client: alex } = await joinAs(code, 'Alex');
  host.send({ type: 'room:leave' });
  assert.deepEqual(await nextOfType(alex, 'room:closed'), { type: 'room:closed', reason: 'host_left' });
  assert.equal(server.rooms.getRoom(code), undefined);
  host.close();
  alex.close();
});
