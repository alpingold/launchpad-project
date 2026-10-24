import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { openClient } from '../helpers/wsClient.js';
import { signUp } from '../helpers/accounts.js';
import { tapGame } from '../helpers/frameGames.js';

// Limits that keep one person (or script) from taking the site down or finding other
// people's rooms (plan §59). Small values here, so the tests run fast.

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
