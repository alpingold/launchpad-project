import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { openClient } from '../helpers/wsClient.js';
import { signUp, postJson } from '../helpers/accounts.js';

// Logins over real WebSockets: who may host, one room per account, and the Origin check.
let server;
let url;
let baseUrl;

beforeEach(async () => {
  server = createGameServer();
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const { port } = server.httpServer.address();
  url = `ws://localhost:${port}/ws`;
  baseUrl = `http://localhost:${port}`;
});

afterEach(() => server.close());

test('creating a room without logging in is refused', async () => {
  const guest = await openClient(url);
  guest.send({ type: 'host:create_room' });
  const err = await guest.next();
  assert.equal(err.code, 'NOT_AUTHENTICATED');
  assert.equal(server.rooms.rooms.size, 0);
  guest.close();
});

test('guests can still join as players (only hosting needs an account)', async () => {
  const host = await openClient(url, { headers: { Cookie: await signUp(baseUrl) } });
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();
  const guest = await openClient(url);
  guest.send({ type: 'player:join', code, name: 'Alex' });
  assert.equal((await guest.next()).type, 'room:joined');
  host.close();
  guest.close();
});

test('the same account in a second tab gets the same room; the first tab is told "replaced"', async () => {
  const cookie = await signUp(baseUrl);
  const tab1 = await openClient(url, { headers: { Cookie: cookie } });
  tab1.send({ type: 'host:create_room' });
  const first = await tab1.next();
  await tab1.next(); // room:state

  const tab2 = await openClient(url, { headers: { Cookie: cookie } });
  tab2.send({ type: 'host:create_room' });
  const second = await tab2.next();
  assert.equal(second.code, first.code);
  assert.deepEqual(await tab1.next(), { type: 'room:closed', reason: 'replaced' });
  tab1.close();
  tab2.close();
});

test('after logging out, a new connection can no longer host', async () => {
  const cookie = await signUp(baseUrl);
  await postJson(baseUrl, '/api/logout', {}, { Cookie: cookie });
  const client = await openClient(url, { headers: { Cookie: cookie } });
  client.send({ type: 'host:create_room' });
  assert.equal((await client.next()).code, 'NOT_AUTHENTICATED');
  client.close();
});

test('connections from another website are refused (Origin check)', async () => {
  const cookie = await signUp(baseUrl);
  await assert.rejects(openClient(url, { headers: { Cookie: cookie, Origin: 'https://evil.example' } }), /403/);
});

test('connections from our own site are allowed', async () => {
  const host = new URL(baseUrl).host;
  const client = await openClient(url, { headers: { Origin: `http://${host}` } });
  client.close();
});
