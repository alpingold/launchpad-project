import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameServer } from '../../src/server.js';
import { setAdmin } from '../../src/db/users.js';
import { GameRegistry } from '../../src/games/registry.js';
import { signUp, postJson } from '../helpers/accounts.js';

// The admin API for AI-generated games (plan §11, A5), through the real HTTP server.
// A fake generator stands in for the OpenShell sandbox.

const GOOD_SOURCE = readFileSync(new URL('../../src/games/majority-rules/index.js', import.meta.url), 'utf8');
const IDEA = 'Everyone votes; the most popular answer wins';

let server;
let baseUrl;
let finishGeneration; // resolves the fake generator's current job

function start(overrides = { GENERATION_ENABLED: true }) {
  const runGenerator = () =>
    new Promise((resolve) => {
      finishGeneration = resolve;
    });
  server = createGameServer(overrides, { games: new GameRegistry(), runGenerator });
  server.generation.log = () => {};
  return new Promise((resolve) => server.httpServer.listen(0, resolve)).then(() => {
    baseUrl = `http://localhost:${server.httpServer.address().port}`;
  });
}

beforeEach(() => start());
afterEach(() => server.close());

/** A logged-in admin's cookie. */
async function adminCookie(name = 'boss') {
  const cookie = await signUp(baseUrl, name);
  setAdmin(server.db, name, true);
  return cookie;
}
const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const post = (path, body, cookie) => postJson(baseUrl, path, body, cookie ? { Cookie: cookie } : {});

test('only admins get in: 401 logged out, 403 for other accounts', async () => {
  assert.equal((await get('/api/admin/generations')).status, 401);
  const plain = await signUp(baseUrl, 'plainhost');
  const res = await get('/api/admin/generations', plain);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'NOT_ADMIN');
  assert.equal((await post('/api/admin/generations', { idea: IDEA }, plain)).status, 403);

  const admin = await adminCookie();
  const ok = await get('/api/admin/generations', admin);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.info.enabled, true);
  assert.deepEqual(body.info.models.map((m) => m.id), ['qwen3.8:27b']);
  assert.deepEqual(body.games, []);
});

test('the whole flow: generate → review → playtest (only for me) → publish (for everyone) → delete', async () => {
  const admin = await adminCookie();
  const created = await post('/api/admin/generations', { idea: IDEA, model: 'qwen3.8:27b' }, admin);
  assert.equal(created.status, 202);
  const { game } = await created.json();
  assert.equal(game.status, 'generating');
  assert.equal(game.progress.queuePosition, 0);

  finishGeneration({ ok: true, source: GOOD_SOURCE, report: { ok: true, problems: [], game: { name: 'Majority Rules', description: 'Vote' } } });
  await server.generation.current;

  const detail = (await (await get(`/api/admin/generations/${game.id}`, admin)).json()).game;
  assert.equal(detail.status, 'review');
  assert.equal(detail.testsPassed, true);
  assert.equal(detail.source, GOOD_SOURCE, 'the code is there to read');
  assert.equal(detail.model, 'qwen3.8:27b');
  const list = (await (await get('/api/admin/generations', admin)).json()).games;
  assert.equal(list[0].source, undefined, 'the list leaves the code out');

  const gameIds = async (cookie) => (await (await get('/api/games', cookie)).json()).games.map((g) => g.id);
  assert.deepEqual(await gameIds(admin), []);

  const playtest = await post(`/api/admin/generations/${game.id}/playtest`, {}, admin);
  assert.equal(playtest.status, 200);
  assert.equal((await playtest.json()).game.status, 'playtest');
  assert.deepEqual(await gameIds(admin), [game.id], 'in my game picker right away, no restart');
  assert.deepEqual(await gameIds(null), []);

  await post(`/api/admin/generations/${game.id}/publish`, {}, admin);
  assert.deepEqual(await gameIds(null), [game.id], 'published: everyone sees it');

  const del = await fetch(`${baseUrl}/api/admin/generations/${game.id}`, { method: 'DELETE', headers: { Cookie: admin } });
  assert.equal(del.status, 204);
  assert.deepEqual(await gameIds(null), []);
  assert.equal((await get(`/api/admin/generations/${game.id}`, admin)).status, 404);
});

test('bad requests get clear errors', async () => {
  const admin = await adminCookie();
  const errorOf = async (res) => [res.status, (await res.json()).error];

  assert.deepEqual(await errorOf(await post('/api/admin/generations', { idea: 'short' }, admin)), [400, 'INVALID_IDEA']);
  assert.deepEqual(await errorOf(await post('/api/admin/generations', { idea: IDEA, model: 'gpt-5' }, admin)), [400, 'INVALID_MODEL']);
  assert.deepEqual(await errorOf(await get('/api/admin/generations/g-nothere', admin)), [404, 'NOT_FOUND']);
  assert.deepEqual(await errorOf(await post('/api/admin/generations/g-nothere/playtest', {}, admin)), [404, 'NOT_FOUND']);
  assert.deepEqual(await errorOf(await post('/api/admin/generations/g-nothere/explode', {}, admin)), [404, 'NOT_FOUND']);

  const { game } = await (await post('/api/admin/generations', { idea: IDEA }, admin)).json();
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/publish`, {}, admin)), [409, 'WRONG_STATUS']);

  // CSRF protection: a POST that isn't JSON is refused, even from an admin.
  const form = await fetch(`${baseUrl}/api/admin/generations`, {
    method: 'POST',
    headers: { Cookie: admin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `idea=${encodeURIComponent(IDEA)}`,
  });
  assert.deepEqual(await errorOf(form), [415, 'JSON_REQUIRED']);
});

test('with generation switched off, starting is refused but managing games works', async () => {
  await server.close();
  await start({}); // GENERATION_ENABLED defaults to off
  const admin = await adminCookie();
  assert.equal((await (await get('/api/admin/generations', admin)).json()).info.enabled, false);
  const res = await post('/api/admin/generations', { idea: IDEA }, admin);
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /isn't set up on this server/);
});
