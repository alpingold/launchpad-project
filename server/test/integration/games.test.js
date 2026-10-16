import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { openClient } from '../helpers/wsClient.js';
import { signUp } from '../helpers/accounts.js';
import { tapGame } from '../helpers/frameGames.js';

// A full server that offers only the tap test game, over real sockets.
let server;
let baseUrl;
let wsUrl;

beforeEach(async () => {
  const games = new GameRegistry();
  games.register(tapGame());
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
        id: 'tap-test',
        name: 'Tap Test',
        description: 'First to 3 taps wins. Test-only.',
        minPlayers: 1,
        maxPlayers: 12,
        tags: [],
        minutes: null,
        addedAt: null,
        hasThumb: false,
        source: 'official',
      },
    ],
  });
});

test('a whole game over real sockets: start, events both ways, results, back to the lobby', async () => {
  const host = await openHost();
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();

  const alex = await openClient(wsUrl);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  const { playerId } = await nextOfType(alex, 'room:joined');

  host.send({ type: 'host:start_game', gameId: 'tap-test' });
  const started = await nextOfType(alex, 'game:started');
  assert.equal(started.gameId, 'tap-test');
  assert.match(started.source, /id="game-info"/, 'the phone gets the game file');

  // The phone's game sends an event; the server passes it to the big screen's game.
  alex.send({ type: 'game:event', data: 'tap' });
  const event = await nextOfType(host, 'game:event');
  assert.equal(event.from, playerId);
  assert.equal(event.data, 'tap');

  // The big screen's game answers that phone, then ends the game.
  host.send({ type: 'game:batch', items: [{ to: playerId, state: { taps: 1 } }] });
  assert.deepEqual((await nextOfType(alex, 'game:state')).state, { taps: 1 });
  host.send({ type: 'game:end', rankings: [playerId], scores: { [playerId]: 1 } });

  const ended = await nextOfType(alex, 'game:ended');
  assert.deepEqual(ended.results, { rankings: [playerId], scores: { [playerId]: 1 } });
  // game:ended is followed by the lobby room:state.
  assert.equal((await nextOfType(alex, 'room:state')).phase, 'lobby');
  host.close();
  alex.close();
});

test('a phone cannot send to other phones or end the game', async () => {
  const host = await openHost();
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();
  const alex = await openClient(wsUrl);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  await nextOfType(alex, 'room:joined');
  host.send({ type: 'host:start_game', gameId: 'tap-test' });
  await nextOfType(alex, 'game:started');

  alex.send({ type: 'game:batch', items: [{ to: 'all', data: 'spam' }] });
  assert.equal((await nextOfType(alex, 'error')).code, 'NOT_HOST');
  alex.send({ type: 'game:end', rankings: [] });
  assert.equal((await nextOfType(alex, 'error')).code, 'NOT_HOST');
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

  alex.send({ type: 'host:start_game', gameId: 'tap-test' });
  const err = await nextOfType(alex, 'error');
  assert.equal(err.code, 'NOT_HOST');
  host.close();
  alex.close();
});
