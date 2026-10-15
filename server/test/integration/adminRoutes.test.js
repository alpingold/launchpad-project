import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { renamedSource } from '../helpers/frameGames.js';
import { setAdmin } from '../../src/db/users.js';
import { GameRegistry } from '../../src/games/registry.js';
import { signUp, postJson } from '../helpers/accounts.js';
import { MODELS } from '../../../generator/src/models.js';

// The admin API for AI-generated games and their versions (plan §11 A5, §12e K6), through
// the real HTTP server.
// A fake generator stands in for the OpenShell sandbox.

const GOOD_SOURCE = renamedSource('Majority Rules');
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
  assert.deepEqual(body.info.models, MODELS);
  assert.equal(body.info.defaultModel, 'qwen3.8:27b');
  assert.deepEqual(body.games, []);
});

test('the whole flow: design → new draft → edit → build → playtest (only for me) → publish → change (plan, build) → playtest v2 next to v1 → publish → delete', async () => {
  const admin = await adminCookie();
  const created = await post('/api/admin/generations', { idea: IDEA, model: 'qwen3.8:27b' }, admin);
  assert.equal(created.status, 202);
  const { game } = await created.json();
  assert.equal(game.status, 'designing');
  assert.equal(game.progress.queuePosition, 0);

  finishGeneration({ ok: true, design: '# Majority Rules\n## Rules\nVote.\n' });
  await server.generation.current;
  const detailOf = async () => (await (await get(`/api/admin/generations/${game.id}`, admin)).json()).game;
  let detail = await detailOf();
  assert.equal(detail.status, 'design');
  assert.deepEqual([detail.versions[0].status, detail.versions[0].design], ['design_ready', '# Majority Rules\n## Rules\nVote.\n']);

  // A new draft with feedback, then my own edit.
  const redesign = await post(`/api/admin/generations/${game.id}/versions/1/redesign`, { feedback: 'Three rounds' }, admin);
  assert.equal(redesign.status, 202);
  assert.equal((await redesign.json()).game.versions[0].designFeedback, 'Three rounds');
  finishGeneration({ ok: true, design: '# Majority Rules\n## Rules\nVote, 3 rounds.\n' });
  await server.generation.current;
  const edited = await post(`/api/admin/generations/${game.id}/versions/1/design`, { design: '# Majority Rules\n## Rules\nVote, 3 rounds of 20 s.' }, admin);
  assert.equal(edited.status, 200);
  assert.deepEqual((await edited.json()).game.versions[0].drafts.map((d) => d.by), ['ai', 'ai', 'admin']);

  // Build it.
  const build = await post(`/api/admin/generations/${game.id}/versions/1/build`, {}, admin);
  assert.equal(build.status, 202);
  assert.equal((await build.json()).game.status, 'generating');
  finishGeneration({ ok: true, source: GOOD_SOURCE, report: { ok: true, problems: [], game: { name: 'Majority Rules', description: 'Vote' } } });
  await server.generation.current;

  detail = await detailOf();
  assert.equal(detail.status, 'review');
  assert.equal(detail.name, 'Majority Rules');
  assert.equal(detail.testsPassed, true);
  assert.equal(detail.versions.length, 1);
  assert.equal(detail.versions[0].source, GOOD_SOURCE, 'the code is there to read');
  assert.equal(detail.versions[0].changes, null, 'version 1 has nothing to compare with');
  assert.equal(detail.model, 'qwen3.8:27b');
  const list = (await (await get('/api/admin/generations', admin)).json()).games;
  assert.equal(list[0].versions, undefined, 'the list leaves the versions and code out');

  const gameIds = async (cookie) => (await (await get('/api/games', cookie)).json()).games.map((g) => g.id);
  assert.deepEqual(await gameIds(admin), []);

  const playtest = await post(`/api/admin/generations/${game.id}/versions/1/playtest`, {}, admin);
  assert.equal(playtest.status, 200);
  assert.equal((await playtest.json()).game.status, 'playtest');
  assert.deepEqual(await gameIds(admin), [`${game.id}-v1`], 'in my game picker right away, no restart');
  assert.deepEqual(await gameIds(null), []);

  await post(`/api/admin/generations/${game.id}/publish`, {}, admin);
  assert.deepEqual(await gameIds(null), [game.id], 'published: everyone sees it');

  // Ask for changes: version 2, made from version 1's code.
  const asked = await post(`/api/admin/generations/${game.id}/versions`, { request: 'Call it Majority Rules 2' }, admin);
  assert.equal(asked.status, 202);
  assert.equal((await asked.json()).game.versions[1].status, 'designing', 'a plan first');
  finishGeneration({ ok: true, design: '# Change: the name\n## What changes\n- The name\n' });
  await server.generation.current;
  await post(`/api/admin/generations/${game.id}/versions/2/build`, {}, admin);
  const v2Source = renamedSource('Majority Rules 2');
  finishGeneration({ ok: true, source: v2Source, changelog: '- Renamed it', report: { ok: true, problems: [], game: { name: 'Majority Rules 2', description: 'Vote' } } });
  await server.generation.current;
  detail = await detailOf();
  const v2 = detail.versions[1];
  assert.deepEqual([v2.version, v2.basedOn, v2.request, v2.changelog, v2.status], [2, 1, 'Call it Majority Rules 2', '- Renamed it', 'ready']);
  assert.deepEqual([v2.changes.added, v2.changes.removed], [1, 1], 'one line changed');
  assert.deepEqual(v2.changes.hunks[0].filter((l) => l.type !== 'same').map((l) => l.type), ['del', 'add']);

  await post(`/api/admin/generations/${game.id}/versions/2/playtest`, {}, admin);
  assert.deepEqual(await gameIds(null), [game.id], 'everyone else keeps v1');
  assert.deepEqual(await gameIds(admin), [game.id, `${game.id}-v2`], 'I get both');
  const mine = (await (await get('/api/games', admin)).json()).games;
  assert.deepEqual(mine.map((g) => [g.status, g.version]), [['published', 1], ['playtest', 2]], 'the picker can say which is which');

  await post(`/api/admin/generations/${game.id}/publish`, {}, admin);
  detail = await detailOf();
  assert.deepEqual([detail.publishedVersion, detail.playtestVersion, detail.name], [2, null, 'Majority Rules 2']);

  await post(`/api/admin/generations/${game.id}/unpublish`, {}, admin);
  assert.deepEqual(await gameIds(admin), []);

  const del = await fetch(`${baseUrl}/api/admin/generations/${game.id}`, { method: 'DELETE', headers: { Cookie: admin } });
  assert.equal(del.status, 204);
  assert.equal((await get(`/api/admin/generations/${game.id}`, admin)).status, 404);
});

test('bad requests get clear errors', async () => {
  const admin = await adminCookie();
  const errorOf = async (res) => [res.status, (await res.json()).error];

  assert.deepEqual(await errorOf(await post('/api/admin/generations', { idea: 'short' }, admin)), [400, 'INVALID_IDEA']);
  assert.deepEqual(await errorOf(await post('/api/admin/generations', { idea: IDEA, model: 'gpt-5' }, admin)), [400, 'INVALID_MODEL']);
  assert.deepEqual(await errorOf(await get('/api/admin/generations/g-nothere', admin)), [404, 'NOT_FOUND']);
  assert.deepEqual(await errorOf(await post('/api/admin/generations/g-nothere/versions/1/playtest', {}, admin)), [404, 'NOT_FOUND']);
  assert.deepEqual(await errorOf(await post('/api/admin/generations/g-nothere/versions', { request: 'A fine request' }, admin)), [404, 'NOT_FOUND']);

  const { game } = await (await post('/api/admin/generations', { idea: IDEA }, admin)).json();
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/publish`, {}, admin)), [409, 'WRONG_STATUS']);
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions/1/playtest`, {}, admin)), [409, 'WRONG_STATUS']);
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions/x/playtest`, {}, admin)), [404, 'NOT_FOUND']);
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions/1/build`, {}, admin)), [409, 'BUSY'], 'its design is still being written');
  finishGeneration({ ok: true, design: '# A game\n## Rules\nVote.\n' });
  await server.generation.current;
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions/1/redesign`, { feedback: 'x' }, admin)), [400, 'INVALID_FEEDBACK']);
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions/1/design`, { design: 42 }, admin)), [400, 'INVALID_DESIGN']);
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions/1/discard`, {}, admin)), [409, 'WRONG_STATUS']);
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions/2/build`, {}, admin)), [404, 'NOT_FOUND']);
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions`, { request: 'tiny' }, admin)), [400, 'INVALID_REQUEST']);
  assert.deepEqual(await errorOf(await post(`/api/admin/generations/${game.id}/versions`, { request: 'A fine request' }, admin)), [409, 'BUSY']);

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
