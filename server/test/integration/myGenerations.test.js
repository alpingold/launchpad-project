import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { setAdmin } from '../../src/db/users.js';
import { GameRegistry } from '../../src/games/registry.js';
import { signUp, postJson } from '../helpers/accounts.js';

// Every account making games with its own GenAI Studio key (plan §15): /api/generations,
// only your own games, one job at a time, no publishing. A fake generator and a fake key
// check stand in for OpenShell and GenAI Studio.

const IDEA = 'Everyone votes; the most popular answer wins';
const KEY = 'sk-0123456789abcdef0123456789abcdef';
let server;
let baseUrl;
let jobs; // what the fake generator was asked: [{ job, apiKey, finish }]

beforeEach(async () => {
  jobs = [];
  const runGenerator = (job, { apiKey }) => new Promise((finish) => jobs.push({ job, apiKey, finish }));
  server = createGameServer({ GENERATION_ENABLED: true }, { games: new GameRegistry(), runGenerator, checkKey: async () => 'ok' });
  server.generation.log = () => {};
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});
afterEach(() => server.close());

const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const post = (path, body, cookie) => postJson(baseUrl, path, body, cookie ? { Cookie: cookie } : {});
const saveKey = (cookie) =>
  fetch(`${baseUrl}/api/account/genai-key`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY }) });

test('logged out: 401; logged in without a key: you can look, but starting needs a key', async () => {
  assert.equal((await get('/api/generations')).status, 401);
  assert.equal((await get('/api/no-such-thing')).status, 404, 'other /api paths are untouched');
  const sam = await signUp(baseUrl, 'sam');
  const list = await (await get('/api/generations', sam)).json();
  assert.deepEqual([list.info.canGenerate, list.info.isAdmin, list.games], [false, false, []]);
  const refused = await post('/api/generations', { idea: IDEA }, sam);
  assert.deepEqual([refused.status, (await refused.json()).error], [403, 'NO_KEY']);
});

test('with a key: your job runs with YOUR key; one at a time; only you see your games; no publishing', async () => {
  const sam = await signUp(baseUrl, 'sam');
  assert.equal((await saveKey(sam)).status, 200);
  assert.equal((await (await get('/api/generations', sam)).json()).info.canGenerate, true);

  const created = await post('/api/generations', { idea: IDEA }, sam);
  assert.equal(created.status, 202);
  const { game } = await created.json();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].apiKey, KEY, "the sandbox gets sam's own key");
  assert.ok(!JSON.stringify(jobs[0].job).includes(KEY), 'never inside the job itself');

  const second = await post('/api/generations', { idea: `${IDEA}, again` }, sam);
  assert.deepEqual([second.status, (await second.json()).error], [409, 'ALREADY_RUNNING']);

  // Someone else: their own (empty) list, and sam's game doesn't exist for them.
  const kim = await signUp(baseUrl, 'kim');
  assert.deepEqual((await (await get('/api/generations', kim)).json()).games, []);
  assert.equal((await get(`/api/generations/${game.id}`, kim)).status, 404);
  assert.equal((await post(`/api/generations/${game.id}/versions/1/build`, {}, kim)).status, 404);
  const own = await get(`/api/generations/${game.id}`, sam);
  assert.equal((await own.json()).game.id, game.id);

  // The design arrives; sam builds it; it passes; sam playtests it, but can't publish it.
  jobs[0].finish({ ok: true, design: '# Majority Rules\n## Rules\nVote.\n' });
  await server.generation.current;
  assert.equal((await post(`/api/generations/${game.id}/versions/1/build`, {}, sam)).status, 202);
  assert.equal(jobs[1].apiKey, KEY);
  assert.equal(jobs[1].job.step, 'build');
  assert.equal((await post(`/api/generations/${game.id}/publish`, {}, sam)).status, 404, 'admins decide what everyone gets');

  // An admin sees sam's game on the admin page and could publish it.
  const boss = await signUp(baseUrl, 'boss');
  setAdmin(server.db, 'boss', true);
  const all = await (await get('/api/admin/generations', boss)).json();
  assert.deepEqual(all.games.map((g) => g.id), [game.id]);
});

test('an admin without a key can still generate (with the server key)', async () => {
  const boss = await signUp(baseUrl, 'boss');
  setAdmin(server.db, 'boss', true);
  const info = (await (await get('/api/generations', boss)).json()).info;
  assert.deepEqual([info.canGenerate, info.isAdmin], [true, true]);
  assert.equal((await post('/api/generations', { idea: IDEA }, boss)).status, 202);
  assert.equal(jobs[0].apiKey, undefined, "no key: the server's own provider");
});
