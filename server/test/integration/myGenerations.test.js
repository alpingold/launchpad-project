import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { setAdmin } from '../../src/db/users.js';
import { GameRegistry } from '../../src/games/registry.js';
import { signUp, postJson } from '../helpers/accounts.js';
import { renamedSource } from '../helpers/frameGames.js';

// Every account making games with its own GenAI Studio key (plan §15): /api/generations,
// only your own games, one job at a time, publishing them yourself (plan §49). A fake generator and a fake key
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

test('with a key: your job runs with YOUR key; one at a time; only you see your games', async () => {
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

  // The design arrives; sam builds it with the same key.
  jobs[0].finish({ ok: true, design: '# Majority Rules\n## Rules\nVote.\n' });
  await server.generation.current;
  assert.equal((await post(`/api/generations/${game.id}/versions/1/build`, {}, sam)).status, 202);
  assert.equal(jobs[1].apiKey, KEY);
  assert.equal(jobs[1].job.step, 'build');
  assert.equal((await post(`/api/generations/${game.id}/publish`, {}, kim)).status, 404, "kim can't publish sam's game");

  // An admin sees sam's game on the admin page and could publish it.
  const boss = await signUp(baseUrl, 'boss');
  setAdmin(server.db, 'boss', true);
  const all = await (await get('/api/admin/generations', boss)).json();
  assert.deepEqual(all.games.map((g) => g.id), [game.id]);
});

test('publishing your own game (plan §49): no admin, but no blocked words in its name or description', async () => {
  const sam = await signUp(baseUrl, 'sam');
  await saveKey(sam);
  const { game } = await (await post('/api/generations', { idea: IDEA }, sam)).json();
  jobs[0].finish({ ok: true, design: '# Majority Rules\n## Rules\nVote.\n' });
  await server.generation.current;
  await post(`/api/generations/${game.id}/versions/1/build`, {}, sam);
  const name = 'Holy Shit Majority';
  jobs[1].finish({ ok: true, source: renamedSource(name), report: { ok: true, problems: [], game: { name, description: 'Vote, you bastards' } } });
  await server.generation.current;

  const kim = await signUp(baseUrl, 'kim');
  const everyoneSees = async () => (await (await get('/api/games', kim)).json()).games.map((g) => g.id).includes(game.id);
  const errorOf = async (res) => [res.status, (await res.json()).error];

  // Only the version being playtested can be published.
  assert.deepEqual(await errorOf(await post(`/api/generations/${game.id}/publish`, {}, sam)), [409, 'WRONG_STATUS']);
  await post(`/api/generations/${game.id}/versions/1/playtest`, {}, sam);

  // Its name and description have blocked words: refused, with each word and where it is.
  const refused = await post(`/api/generations/${game.id}/publish`, {}, sam);
  assert.equal(refused.status, 422);
  const body = await refused.json();
  assert.equal(body.error, 'BLOCKED_WORDS');
  assert.match(body.message, /the name: "Shit"; the description: "bastards"/);
  assert.deepEqual(body.blocked, [
    { field: 'name', text: name, words: [{ word: 'Shit', start: 5, end: 9 }] },
    { field: 'description', text: 'Vote, you bastards', words: [{ word: 'bastards', start: 10, end: 18 }] },
  ]);
  assert.equal(await everyoneSees(), false);

  // Sam renames it on its page: a page with a blocked word isn't saved either.
  const page = (fields) =>
    fetch(`${baseUrl}/api/games/${game.id}-v1/page`, { method: 'PUT', headers: { Cookie: sam, 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
  const badPage = await page({ name: 'Majority Shitshow' });
  assert.equal(badPage.status, 400);
  assert.deepEqual((await badPage.json()).blocked, [{ field: 'name', text: 'Majority Shitshow', words: [{ word: 'Shitshow', start: 9, end: 17 }] }]);
  assert.equal((await page({ name: 'Majority Rules', description: 'Vote, everyone' })).status, 200);

  // Now it publishes: everyone gets it, with no admin involved. Sam can take it down again.
  const published = await post(`/api/generations/${game.id}/publish`, {}, sam);
  assert.equal(published.status, 200);
  assert.equal((await published.json()).game.status, 'published');
  assert.equal(await everyoneSees(), true);
  assert.equal((await post(`/api/generations/${game.id}/unpublish`, {}, sam)).status, 200);
  assert.equal(await everyoneSees(), false);
});

test('an admin without a key can still generate (with the server key)', async () => {
  const boss = await signUp(baseUrl, 'boss');
  setAdmin(server.db, 'boss', true);
  const info = (await (await get('/api/generations', boss)).json()).info;
  assert.deepEqual([info.canGenerate, info.isAdmin], [true, true]);
  assert.equal((await post('/api/generations', { idea: IDEA }, boss)).status, 202);
  assert.equal(jobs[0].apiKey, undefined, "no key: the server's own provider");
});
