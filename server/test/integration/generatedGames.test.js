import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { setAdmin } from '../../src/db/users.js';
import { openClient } from '../helpers/wsClient.js';
import { signUp } from '../helpers/accounts.js';
import countGame from '../fixtures/countGame.js';

// Generated games and the admin role, through the real server (plan §11, A3).

let server;
let baseUrl;
let wsUrl;
let registry;

beforeEach(async () => {
  registry = new GameRegistry();
  registry.register(countGame);
  server = createGameServer({}, { games: registry });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const { port } = server.httpServer.address();
  baseUrl = `http://localhost:${port}`;
  wsUrl = `ws://localhost:${port}/ws`;
});

afterEach(() => server.close());

const me = async (cookie) => (await (await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } })).json()).user;
const gameIds = async (cookie) =>
  (await (await fetch(`${baseUrl}/api/games`, { headers: cookie ? { Cookie: cookie } : {} })).json()).games.map((g) => g.id);

async function nextOfType(client, type) {
  for (;;) {
    const msg = await client.next();
    if (msg.type === type) return msg;
  }
}

/** A logged-in host with a room and one player; returns what's needed to start games. */
async function hostWithPlayer(cookie) {
  const host = await openClient(wsUrl, { headers: { Cookie: cookie } });
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();
  const alex = await openClient(wsUrl);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  await nextOfType(alex, 'room:joined');
  return { host, alex };
}

test('/api/me says who is an admin', async () => {
  const cookie = await signUp(baseUrl, 'boss');
  assert.equal((await me(cookie)).isAdmin, false);
  setAdmin(server.db, 'boss', true);
  assert.equal((await me(cookie)).isAdmin, true);
});

test('a playtest game is listed and startable only for the account that generated it', async () => {
  const ownerCookie = await signUp(baseUrl, 'owner');
  const otherCookie = await signUp(baseUrl, 'other');
  const ownerId = (await me(ownerCookie)).id;
  registry.register({ ...countGame, id: 'g-playtest1' }, { source: 'generated', status: 'playtest', ownerUserId: ownerId });

  assert.deepEqual(await gameIds(ownerCookie), ['count-game', 'g-playtest1']);
  assert.deepEqual(await gameIds(otherCookie), ['count-game']);
  assert.deepEqual(await gameIds(null), ['count-game']);

  // Another host can't start it even knowing its id.
  const other = await hostWithPlayer(otherCookie);
  other.host.send({ type: 'host:start_game', gameId: 'g-playtest1' });
  assert.equal((await nextOfType(other.host, 'error')).code, 'GAME_NOT_FOUND');

  // The owner can.
  const owner = await hostWithPlayer(ownerCookie);
  owner.host.send({ type: 'host:start_game', gameId: 'g-playtest1' });
  assert.equal((await nextOfType(owner.alex, 'game:started')).gameId, 'g-playtest1');

  for (const c of [other.host, other.alex, owner.host, owner.alex]) c.close();
});

test('a published generated game is for everyone', async () => {
  registry.register({ ...countGame, id: 'g-public1' }, { source: 'generated', status: 'published', ownerUserId: 999 });
  const cookie = await signUp(baseUrl);
  assert.deepEqual(await gameIds(cookie), ['count-game', 'g-public1']);
  const games = (await (await fetch(`${baseUrl}/api/games`)).json()).games;
  assert.deepEqual([games[1].source, games[1].status], ['generated', 'published']);
});
