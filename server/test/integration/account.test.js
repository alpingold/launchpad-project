import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { signUp } from '../helpers/accounts.js';

// /api/account/genai-key over real HTTP (plan §15). GenAI Studio's key check is faked.

const KEY = 'sk-0123456789abcdef0123456789abcdef';
let server;
let baseUrl;
let verdict;

beforeEach(async () => {
  verdict = 'ok';
  server = createGameServer({}, { games: new GameRegistry(), checkKey: async () => verdict });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});

afterEach(() => server.close());

const call = (method, cookie, body) =>
  fetch(`${baseUrl}/api/account/genai-key`, {
    method,
    headers: { ...(cookie && { Cookie: cookie }), ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });

test('logged out: 401', async () => {
  assert.equal((await call('GET')).status, 401);
  assert.equal((await call('PUT', null, { key: KEY })).status, 401);
});

test('save, see only the last 4 characters, replace, remove; never the key itself', async () => {
  const cookie = await signUp(baseUrl);
  assert.deepEqual(await (await call('GET', cookie)).json(), { saved: false, last4: null, savedAt: null });

  const saved = await call('PUT', cookie, { key: KEY });
  assert.equal(saved.status, 200);
  const body = await saved.text();
  assert.ok(!body.includes('0123456789'), 'the key is never sent back');
  assert.equal(JSON.parse(body).last4, 'cdef');
  assert.equal((await (await call('GET', cookie)).json()).last4, 'cdef');

  // Someone else doesn't see it.
  const other = await signUp(baseUrl);
  assert.equal((await (await call('GET', other)).json()).saved, false);

  assert.equal((await call('DELETE', cookie)).status, 204);
  assert.equal((await (await call('GET', cookie)).json()).saved, false);
});

test('a bad key: refused with a reason the page can show; PUT must be JSON', async () => {
  const cookie = await signUp(baseUrl);
  const wrong = await call('PUT', cookie, { key: 'nope' });
  assert.deepEqual([wrong.status, (await wrong.json()).error], [400, 'INVALID_KEY']);
  verdict = 'rejected';
  const rejected = await call('PUT', cookie, { key: KEY });
  assert.deepEqual([rejected.status, (await rejected.json()).error], [400, 'KEY_REJECTED']);
  const form = await fetch(`${baseUrl}/api/account/genai-key`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body: KEY });
  assert.equal(form.status, 415);
});

test('at most 10 tries per account in 10 minutes (each one asks GenAI Studio)', async () => {
  const cookie = await signUp(baseUrl);
  verdict = 'rejected';
  for (let i = 0; i < 10; i++) assert.equal((await call('PUT', cookie, { key: KEY })).status, 400);
  assert.equal((await call('PUT', cookie, { key: KEY })).status, 429);
});
