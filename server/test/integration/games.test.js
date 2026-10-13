import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { openClient } from '../helpers/wsClient.js';
import { signUp } from '../helpers/accounts.js';
import countGame from '../fixtures/countGame.js';

// A full server that offers only the test count game, over real sockets.
let server;
let baseUrl;
let wsUrl;

beforeEach(async () => {
  const games = new GameRegistry();
  games.register(countGame);
  server = createGameServer({}, { games });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const { port } = server.httpServer.address();
  baseUrl = `http://localhost:${port}`;
  wsUrl = `ws://localhost:${port}/ws`;
});

afterEach(() => server.close());

/** Hosting needs an account (M7): signs up a fresh one and opens a socket with its cookie. */
async function openHost() {
  return openClient(wsUrl, { headers: { Cookie: await signUp(baseUrl) } });
}

async function nextOfType(client, type) {
  for (;;) {
    const msg = await client.next();
    if (msg.type === type) return msg;
  }
}

test('GET /api/games lists the games for the host picker', async () => {
  const res = await fetch(`${baseUrl}/api/games`);
  assert.deepEqual(await res.json(), {
    games: [
      {
        id: 'count-game',
        name: 'Count to Three',
        description: 'First to tap the button enough times wins.',
        minPlayers: 1,
        maxPlayers: 12,
        source: 'official',
      },
    ],
  });
});

test('a whole game over real sockets: start, tap, results, back to the lobby', async () => {
  const host = await openHost();
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();

  const alex = await openClient(wsUrl);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  const { playerId } = await nextOfType(alex, 'room:joined');

  host.send({ type: 'host:start_game', gameId: 'count-game', options: { target: 2 } });
  assert.equal((await nextOfType(alex, 'game:started')).gameId, 'count-game');
  assert.deepEqual((await nextOfType(alex, 'game:message')).payload, {
    view: 'button',
    label: 'Tap!',
    action: { tap: true },
  });

  // The phone sends back the action that came with the button.
  alex.send({ type: 'game:action', action: { tap: true } });
  alex.send({ type: 'game:action', action: { tap: true } });

  const ended = await nextOfType(host, 'game:ended');
  assert.deepEqual(ended.results, { rankings: [playerId], scores: { [playerId]: 2 } });
  // game:ended is followed by the lobby room:state.
  assert.equal((await nextOfType(host, 'room:state')).phase, 'lobby');
  host.close();
  alex.close();
});

test('only the host may start a game; players get NOT_HOST', async () => {
  const host = await openHost();
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();
  const alex = await openClient(wsUrl);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  await nextOfType(alex, 'room:joined');

  alex.send({ type: 'host:start_game', gameId: 'count-game' });
  const err = await nextOfType(alex, 'error');
  assert.equal(err.code, 'NOT_HOST');
  host.close();
  alex.close();
});
