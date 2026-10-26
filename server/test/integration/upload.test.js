import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { MAX_UPLOADS_PER_HOUR } from '../../src/generation/service.js';
import { signUp, postJson } from '../helpers/accounts.js';
import { TAP_SOURCE, renamedSource } from '../helpers/frameGames.js';

// Uploading your own game file (plan §57): no GenAI Studio key, the file checked in the
// sandbox (a fake generator here) with no AI, then playtested and published like any other.

let server;
let baseUrl;
let jobs; // what the fake generator was asked: [{ job, apiKey, finish }]

beforeEach(async () => {
  jobs = [];
  const runGenerator = (job, { apiKey, ai }) => new Promise((finish) => jobs.push({ job, apiKey, ai, finish }));
  server = createGameServer({ GENERATION_ENABLED: true }, { games: new GameRegistry(), runGenerator, checkKey: async () => 'ok' });
  server.generation.log = () => {};
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});
afterEach(() => server.close());

const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
const post = (path, body, cookie) => postJson(baseUrl, path, body, { Cookie: cookie });
const passed = (source) => ({ ok: true, source, report: { ok: true, problems: [], game: { name: 'Tap Test', description: 'Tap!' } }, attempts: [] });

test('an upload needs no key: its file is checked with no AI, then it plays and publishes like any game', async () => {
  const sam = await signUp(baseUrl, 'sam');
  const res = await post('/api/generations/upload', { source: TAP_SOURCE }, sam);
  assert.equal(res.status, 202);
  const { game } = await res.json();
  assert.equal(jobs.length, 1);
  assert.deepEqual(Object.keys(jobs[0].job).sort(), ['idea', 'source', 'step']);
  assert.equal(jobs[0].job.step, 'check');
  assert.equal(jobs[0].job.source, TAP_SOURCE);
  assert.equal(jobs[0].apiKey, undefined, 'no key goes in the sandbox');

  // The sandbox's answer can't swap the file: what's kept is what was uploaded.
  jobs[0].finish(passed(`${TAP_SOURCE}<!-- changed -->`));
  await server.generation.current;
  const { game: ready } = await (await get(`/api/generations/${game.id}`, sam)).json();
  const v1 = ready.versions[0];
  assert.deepEqual([v1.status, v1.kind, v1.model, v1.source], ['ready', 'upload', null, TAP_SOURCE]);
  assert.ok(ready.prompt.startsWith('Tap Test: '), 'its idea is what the game says it is');

  assert.equal((await post(`/api/generations/${game.id}/versions/1/playtest`, {}, sam)).status, 200);
  assert.equal((await post(`/api/generations/${game.id}/publish`, {}, sam)).status, 200);
  // Labelled as an upload, not AI-made (plan §57).
  const listed = (await (await get('/api/games', sam)).json()).games.find((g) => g.pageId === game.id);
  assert.equal(listed.madeBy, 'upload');
});

test('a new version from a new file; a failing file keeps its report', async () => {
  const sam = await signUp(baseUrl, 'sam');
  const { game } = await (await post('/api/generations/upload', { source: TAP_SOURCE }, sam)).json();
  jobs[0].finish(passed(TAP_SOURCE));
  await server.generation.current;

  const next = renamedSource('Tap Test 2');
  const res = await post(`/api/generations/${game.id}/upload`, { source: next }, sam);
  assert.equal(res.status, 202);
  assert.equal(jobs[1].job.step, 'check');
  const report = { ok: false, problems: [{ line: 3, message: 'TypeError: x is undefined' }] };
  jobs[1].finish({ ok: false, error: "it didn't pass the checks", source: next, report, attempts: [] });
  await server.generation.current;
  const v2 = (await (await get(`/api/generations/${game.id}`, sam)).json()).game.versions[1];
  assert.deepEqual([v2.status, v2.kind, v2.basedOn, v2.request, v2.source], ['failed', 'upload', 1, 'Uploaded a new file', next]);
  assert.deepEqual(v2.report, report);

  // Someone else can't upload a version of sam's game.
  const kim = await signUp(baseUrl, 'kim');
  assert.equal((await post(`/api/generations/${game.id}/upload`, { source: next }, kim)).status, 404);
});

test('refused: not a game file, too big, one at a time, and a few an hour', async () => {
  const sam = await signUp(baseUrl, 'sam');
  const notGame = await post('/api/generations/upload', { source: '<p>hello</p>' }, sam);
  assert.equal(notGame.status, 422);
  const body = await notGame.json();
  assert.equal(body.error, 'INVALID_FILE');
  assert.ok(body.problems.length > 0);
  assert.equal((await post('/api/generations/upload', {}, sam)).status, 400);

  // Over the site's 1 MB limit: the upload route takes the body, the game check refuses it.
  const big = await post('/api/generations/upload', { source: `${TAP_SOURCE}<!--${'x'.repeat(1024 * 1024)}-->` }, sam);
  assert.equal(big.status, 422);
  // Other routes keep the small limit.
  assert.equal((await post('/api/generations', { idea: 'x'.repeat(50 * 1024) }, sam)).status, 413);

  assert.equal((await post('/api/generations/upload', { source: TAP_SOURCE }, sam)).status, 202);
  const second = await post('/api/generations/upload', { source: TAP_SOURCE }, sam);
  assert.deepEqual([second.status, (await second.json()).error], [409, 'ALREADY_RUNNING']);
  jobs[0].finish(passed(TAP_SOURCE));
  await server.generation.current;

  for (let i = 1; i < MAX_UPLOADS_PER_HOUR; i++) {
    assert.equal((await post('/api/generations/upload', { source: TAP_SOURCE }, sam)).status, 202);
    jobs[i].finish(passed(TAP_SOURCE));
    await server.generation.current;
  }
  const tooMany = await post('/api/generations/upload', { source: TAP_SOURCE }, sam);
  assert.deepEqual([tooMany.status, (await tooMany.json()).error], [429, 'TOO_MANY_UPLOADS']);
});

test('with a key, the AI can fix a failed upload or review a passing one, up to 100 KB', async () => {
  const sam = await signUp(baseUrl, 'sam');
  const putKey = { method: 'PUT', headers: { Cookie: sam, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'sk-0123456789abcdef0123456789abcdef' }) };
  assert.equal((await fetch(`${baseUrl}/api/account/genai-key`, putKey)).status, 200);
  const { game } = await (await post('/api/generations/upload', { source: TAP_SOURCE }, sam)).json();
  jobs[0].finish({ ok: false, error: "it didn't pass the checks", source: TAP_SOURCE, report: { ok: false, problems: ['stuck'] }, attempts: [] });
  await server.generation.current;

  const fix = await post(`/api/generations/${game.id}/versions`, { request: 'Fix these problems: stuck', basedOn: 1, skipDesign: true }, sam);
  assert.equal(fix.status, 202);
  assert.deepEqual([jobs[1].job.step, jobs[1].job.change.source, jobs[1].job.change.design], ['build', TAP_SOURCE, null]);
  assert.equal(jobs[1].apiKey !== undefined, true, 'the AI parts use your key');
  assert.equal(jobs[1].ai, true);
  jobs[1].finish(passed(renamedSource('Tap Fixed')));
  await server.generation.current;

  assert.equal((await post(`/api/generations/${game.id}/versions/2/review-again`, {}, sam)).status, 202);
  assert.equal(jobs[2].job.step, 'recheck');
  assert.ok(jobs[2].job.idea.startsWith('Tap Test: '), "with no design, the review reads the game's own description");
  jobs[2].finish(passed(renamedSource('Tap Fixed')));
  await server.generation.current;

  // A bigger file than the AI can change: upload it (it passes), then the AI refuses it.
  const big = `${TAP_SOURCE}<!--${'x'.repeat(100 * 1024)}-->`;
  assert.equal((await post(`/api/generations/${game.id}/upload`, { source: big }, sam)).status, 202);
  jobs[3].finish(passed(big));
  await server.generation.current;
  const refused = await post(`/api/generations/${game.id}/versions`, { request: 'Make it blue please', basedOn: 4, skipDesign: true }, sam);
  assert.deepEqual([refused.status, (await refused.json()).error], [413, 'TOO_BIG_FOR_AI']);
});

test("a remix of an upload is a copy, not an upload, and still says \"Uploaded\" (plan §60)", async () => {
  const sam = await signUp(baseUrl, 'sam');
  const { game } = await (await post('/api/generations/upload', { source: TAP_SOURCE }, sam)).json();
  jobs[0].finish(passed(TAP_SOURCE));
  await server.generation.current;
  await post(`/api/generations/${game.id}/versions/1/playtest`, {}, sam);
  await post(`/api/generations/${game.id}/publish`, {}, sam);

  const kim = await signUp(baseUrl, 'kim');
  const made = await post(`/api/games/${game.id}/remix`, {}, kim);
  assert.equal(made.status, 201);
  const remixId = (await made.json()).id;
  const copy = (await (await get(`/api/generations/${remixId}`, kim)).json()).game.versions[0];
  assert.equal(copy.kind, null, "kim didn't upload anything: it's a copy");

  await post(`/api/generations/${remixId}/versions/1/playtest`, {}, kim);
  await post(`/api/generations/${remixId}/publish`, {}, kim);
  const listed = (await (await get('/api/games', kim)).json()).games.find((g) => g.pageId === remixId);
  assert.equal(listed.madeBy, 'upload', 'the label is the original\'s');
});

test('the service tells the sandbox when a job has no AI (plan §60): an upload\'s check, never a build', async () => {
  const sam = await signUp(baseUrl, 'sam');
  await post('/api/generations/upload', { source: TAP_SOURCE }, sam);
  assert.equal(jobs[0].ai, false);
});

test('the pages get what each version is from the server (plan §60): designKind and its track', async () => {
  const sam = await signUp(baseUrl, 'sam');
  const { game } = await (await post('/api/generations/upload', { source: TAP_SOURCE }, sam)).json();
  assert.deepEqual(game.track, { kind: 'upload', at: 1, state: 'working' });
  jobs[0].finish(passed(TAP_SOURCE));
  await server.generation.current;
  const [v1] = (await (await get(`/api/generations/${game.id}`, sam)).json()).game.versions;
  assert.deepEqual([v1.designKind, v1.track], ['none', { kind: 'upload', at: 2, state: 'yours' }]);
});
