import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { config } from '../../src/config.js';
import { openClient } from '../helpers/wsClient.js';
import { signUp, postJson } from '../helpers/accounts.js';
import { tapGame } from '../helpers/frameGames.js';

// Limits that keep one person (or script) from taking the site down or finding other
// people's rooms (plan §59). Small values here, so the tests run fast.

const KEY = 'sk-0123456789abcdef0123456789abcdef';
let server;
let baseUrl;
let wsUrl;

async function start(overrides = {}, deps = {}) {
  const games = new GameRegistry();
  games.register(tapGame('tap-test'));
  server = createGameServer(overrides, { games, ...deps });
  server.generation.log = () => {};
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = server.httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
}
afterEach(() => server?.close());

const until = async (client, type) => {
  for (;;) {
    const msg = await client.next();
    if (msg.type === type) return msg;
  }
};
const wrongJoin = (client, i) => client.send({ type: 'player:join', code: `ZZZ${'BCDFGHJKLM'[i % 10]}`, name: `g${i}` });

test('a socket that keeps trying wrong room codes is closed', async () => {
  await start();
  const guesser = await openClient(wsUrl);
  for (let i = 0; i < config.MAX_JOIN_FAILURES_PER_CONNECTION; i++) {
    wrongJoin(guesser, i);
    assert.equal((await guesser.next()).code, 'ROOM_NOT_FOUND');
  }
  assert.equal((await guesser.closed).code, 1008);
});

test('an address that keeps getting room codes wrong is told to wait, even with a right code', async () => {
  await start({ JOIN_FAILURES_PER_WINDOW: 3 });
  const host = await openClient(wsUrl, { headers: { Cookie: await signUp(baseUrl) } });
  host.send({ type: 'host:create_room' });
  const { code } = await until(host, 'room:created');

  const guesser = await openClient(wsUrl);
  for (let i = 0; i < 3; i++) {
    wrongJoin(guesser, i);
    assert.equal((await guesser.next()).code, 'ROOM_NOT_FOUND');
  }
  const phone = await openClient(wsUrl); // a new socket from the same address
  phone.send({ type: 'player:join', code, name: 'Alex' });
  assert.equal((await phone.next()).code, 'TOO_MANY_ATTEMPTS');
});

test('only so many sockets from one address', async () => {
  await start({ MAX_CONNECTIONS_PER_IP: 2 });
  const first = await openClient(wsUrl);
  await openClient(wsUrl);
  await assert.rejects(openClient(wsUrl), /429/);
  first.close();
  await first.closed;
  await new Promise((r) => setTimeout(r, 50)); // the server sees the close too
  await openClient(wsUrl); // a place is free again
});

test("a phone that stops reading is dropped, instead of the server keeping everything for it", { timeout: 20_000 }, async () => {
  await start({ WS_MAX_BUFFERED_BYTES: 512 * 1024 });
  const host = await openClient(wsUrl, { headers: { Cookie: await signUp(baseUrl) } });
  host.send({ type: 'host:create_room' });
  const { code } = await until(host, 'room:created');
  const phone = await openClient(wsUrl);
  phone.send({ type: 'player:join', code, name: 'Stall' });
  await until(phone, 'room:joined');
  host.send({ type: 'host:start_game', gameId: 'tap-test' });
  await until(host, 'game:started');

  phone.ws._socket.pause(); // never reads again
  const items = Array.from({ length: 100 }, () => ({ to: 'all', data: 'x'.repeat(1200) })); // ~120 KB a batch
  let left = null;
  for (let i = 0; i < 60 && !left; i++) {
    host.send({ type: 'game:batch', items });
    await new Promise((r) => setTimeout(r, 50));
    const state = server.rooms.getRoom(code).toPublicState();
    if (!state.players[0].connected) left = state;
  }
  assert.ok(left, 'the stalled phone was never dropped');
  for (const conn of server.transport.connections.values()) assert.ok(conn.ws.bufferedAmount <= 512 * 1024);
});

test('games made from one address at once are limited, whoever is logged in (accounts are cheap)', async () => {
  const jobs = [];
  await start({ GENERATION_ENABLED: true }, { runGenerator: () => new Promise((finish) => jobs.push(finish)), checkKey: async () => 'ok' });
  const start1 = async () => {
    const cookie = await signUp(baseUrl);
    await fetch(`${baseUrl}/api/account/genai-key`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY }) });
    return postJson(baseUrl, '/api/generations', { idea: 'Everyone votes; the most popular answer wins' }, { Cookie: cookie });
  };
  for (let i = 0; i < config.GENERATION_JOBS_PER_IP; i++) assert.equal((await start1()).status, 202);
  const refused = await start1();
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).error, 'TOO_MANY_FROM_HERE');
  for (const finish of jobs) finish({ ok: false, error: 'stopped by the test' });
  await server.generation.current;
});
