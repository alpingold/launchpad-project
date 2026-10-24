import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { createDefaultRegistry, officialGameSource } from '../../src/games/index.js';
import { signUp, postJson } from '../helpers/accounts.js';
import { renamedSource } from '../helpers/frameGames.js';
import { remixedName } from '../../src/games/remix.js';

// Remixing (plan §45): your own copy of a public game (official ones too), ready to play and to
// change, with a credit line; its creator can turn new remixes off.

const KEY = 'sk-0123456789abcdef0123456789abcdef';
let server;
let baseUrl;
let jobs;

beforeEach(async () => {
  jobs = [];
  const runGenerator = (job) => new Promise((finish) => jobs.push({ job, finish }));
  server = createGameServer({ GENERATION_ENABLED: true }, { games: createDefaultRegistry(), runGenerator, checkKey: async () => 'ok' });
  server.generation.log = () => {};
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});
afterEach(() => server.close());

const get = async (path, cookie) => (await fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} })).json();
const post = (path, body, cookie) => postJson(baseUrl, path, body, cookie ? { Cookie: cookie } : {});
const errorOf = async (res) => [res.status, (await res.json()).error];
const catalogue = async (cookie) => (await get('/api/games', cookie)).games;
const SOURCE = renamedSource('Majority Rules');

/** sam makes and publishes "Majority Rules" (a fake generator stands in for the AI). */
async function samPublishes() {
  const sam = await signUp(baseUrl, 'sam');
  await fetch(`${baseUrl}/api/account/genai-key`, { method: 'PUT', headers: { Cookie: sam, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY }) });
  const { game } = await (await post('/api/generations', { idea: 'Everyone votes; the most popular answer wins' }, sam)).json();
  jobs.at(-1).finish({ ok: true, design: '# Majority Rules\n## Rules\nVote.\n' });
  await server.generation.current;
  await post(`/api/generations/${game.id}/versions/1/build`, {}, sam);
  jobs.at(-1).finish({ ok: true, source: SOURCE, report: { ok: true, problems: [], game: { name: 'Majority Rules', description: 'Vote' } } });
  await server.generation.current;
  await post(`/api/generations/${game.id}/versions/1/playtest`, {}, sam);
  assert.equal((await post(`/api/generations/${game.id}/publish`, {}, sam)).status, 200);
  return { sam, id: game.id };
}

test("a remix is your own copy, ready to play without a key, and credits the original", async () => {
  const { sam, id } = await samPublishes();
  const kim = await signUp(baseUrl, 'kim');

  assert.deepEqual(await errorOf(await post(`/api/games/${id}/remix`, {})), [401, 'NOT_AUTHENTICATED']);
  assert.deepEqual(await errorOf(await post(`/api/games/${id}/remix`, {}, sam)), [409, 'OWN_GAME']);
  assert.equal((await catalogue(kim)).find((g) => g.id === id).canRemix, true);
  assert.equal((await catalogue(sam)).find((g) => g.id === id).canRemix, false, 'not your own');

  const made = await post(`/api/games/${id}/remix`, {}, kim);
  assert.equal(made.status, 201);
  const remixId = (await made.json()).id;
  assert.match(remixId, /^g-[a-z0-9]{8}$/);

  // Kim's: version 1 is the original's code and design, ready, called "… - Remixed" (in its
  // game file too); nothing was generated.
  const { game } = await get(`/api/generations/${remixId}`, kim);
  assert.deepEqual(game.remixOf, { id, version: 1, name: 'Majority Rules' });
  assert.equal(game.versions.length, 1);
  const [v1] = game.versions;
  assert.deepEqual([v1.status, v1.design, v1.request], ['ready', '# Majority Rules\n## Rules\nVote.\n', 'Remix of Majority Rules']);
  assert.equal(v1.name, 'Majority Rules - Remixed');
  assert.equal(v1.source, renamedSource('Majority Rules - Remixed'), 'only the name changed');
  assert.equal(jobs.length, 2, 'only sam\'s two jobs');
  assert.equal((await get(`/api/generations/${remixId}`, sam)).error, 'NOT_FOUND', "sam doesn't see kim's remix");

  // Kim plays it (no key needed for that), then publishes it: its page credits sam's game.
  assert.equal((await post(`/api/generations/${remixId}/versions/1/playtest`, {}, kim)).status, 200);
  assert.equal((await post(`/api/generations/${remixId}/publish`, {}, kim)).status, 200);
  const credit = (await catalogue()).find((g) => g.id === remixId).remixOf;
  assert.deepEqual(credit, { id, name: 'Majority Rules', creator: { username: 'sam' } });

  // A remix of a remix works the same way, and doesn't say "Remixed" twice.
  const lee = await signUp(baseUrl, 'lee');
  const again = (await (await post(`/api/games/${remixId}/remix`, {}, lee)).json()).id;
  assert.equal((await get(`/api/generations/${again}`, lee)).game.versions[0].name, 'Majority Rules - Remixed');
});

test('turning remixing off stops new remixes only; a gone original keeps its name in the credit', async () => {
  const { sam, id } = await samPublishes();
  const kim = await signUp(baseUrl, 'kim');
  const remixId = (await (await post(`/api/games/${id}/remix`, {}, kim)).json()).id;
  await post(`/api/generations/${remixId}/versions/1/playtest`, {}, kim);
  await post(`/api/generations/${remixId}/publish`, {}, kim);

  const page = await fetch(`${baseUrl}/api/games/${id}/page`, {
    method: 'PUT',
    headers: { Cookie: sam, 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowRemix: false }),
  });
  assert.equal((await page.json()).game.allowRemix, false);
  const lee = await signUp(baseUrl, 'lee');
  assert.equal((await catalogue(lee)).find((g) => g.id === id).canRemix, false);
  assert.deepEqual(await errorOf(await post(`/api/games/${id}/remix`, {}, lee)), [403, 'REMIX_OFF']);
  assert.ok((await catalogue()).some((g) => g.id === remixId), "kim's remix stays published");

  // Sam unpublishes: the credit keeps the name, without a link or creator.
  await post(`/api/generations/${id}/unpublish`, {}, sam);
  assert.deepEqual((await catalogue()).find((g) => g.id === remixId).remixOf, { id: null, name: 'Majority Rules', creator: null });
});

test('official games can be remixed: their file, their design, their pictures', async () => {
  const kim = await signUp(baseUrl, 'kim');
  const made = await post('/api/games/bumper-blobs/remix', {}, kim);
  assert.equal(made.status, 201);
  const remixId = (await made.json()).id;
  const { game } = await get(`/api/generations/${remixId}`, kim);
  const [v1] = game.versions;
  assert.equal(v1.source, officialGameSource('bumper-blobs').replace('"name": "Bumper Blobs"', '"name": "Bumper Blobs - Remixed"'));
  assert.match(v1.design, /^# Bumper Blobs/);
  assert.equal(v1.name, 'Bumper Blobs - Remixed');
  assert.match(game.prompt, /^Bumper Blobs: /);

  // Playtesting it shows the official pictures, and credits BoilerGames (no creator).
  await post(`/api/generations/${remixId}/versions/1/playtest`, {}, kim);
  const mine = (await catalogue(kim)).find((g) => g.id === `${remixId}-v1`);
  assert.deepEqual(mine.shots, ['host', 'phone']);
  assert.deepEqual(mine.remixOf, { id: 'bumper-blobs', name: 'Bumper Blobs', creator: null });
});

test("a game that isn't public can't be remixed (someone else's playtest doesn't exist for you)", async () => {
  const { sam, id } = await samPublishes();
  await post(`/api/generations/${id}/unpublish`, {}, sam);
  const kim = await signUp(baseUrl, 'kim');
  assert.deepEqual(await errorOf(await post(`/api/games/${id}/remix`, {}, kim)), [404, 'NOT_FOUND']);
});

test('a remix\'s name fits in 40 characters', () => {
  assert.equal(remixedName('Stowaways'), 'Stowaways - Remixed');
  assert.equal(remixedName('Stowaways - Remixed'), 'Stowaways - Remixed');
  const long = remixedName('An Extremely Long Party Game Name Here');
  assert.equal(long, 'An Extremely Long Party Game - Remixed');
  assert.ok(long.length <= 40);
});

test('"Make it your own" (plan §45b): the remix gets its own whole design, then its code is rewritten for it; later changes use that design', async () => {
  const { sam, id } = await samPublishes();
  const kim = await signUp(baseUrl, 'kim');
  await fetch(`${baseUrl}/api/account/genai-key`, { method: 'PUT', headers: { Cookie: kim, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY }) });
  const remixId = (await (await post(`/api/games/${id}/remix`, {}, kim)).json()).id;
  const copy = (await get(`/api/generations/${remixId}`, kim)).game.versions[0];

  // Only on a remix: sam's own game isn't one.
  assert.deepEqual(await errorOf(await post(`/api/generations/${id}/remix-design`, { request: 'Make it a team game' }, sam)), [409, 'NOT_A_REMIX']);

  // The design step: the copy's design and code, and what should be different.
  const asked = await post(`/api/generations/${remixId}/remix-design`, { request: 'Make it a team game: two teams vote' }, kim);
  assert.equal(asked.status, 202);
  let job = jobs.at(-1).job;
  assert.deepEqual([job.step, job.remix.request, job.remix.design, job.remix.source], ['design', 'Make it a team game: two teams vote', copy.design, copy.source]);
  assert.equal(job.change, undefined, 'not a change plan');
  const NEW_DESIGN = '# Majority Teams\n## Rules\nTwo teams vote.\n';
  jobs.at(-1).finish({ ok: true, design: NEW_DESIGN });
  await server.generation.current;
  let game = (await get(`/api/generations/${remixId}`, kim)).game;
  assert.deepEqual([game.versions[1].kind, game.versions[1].status, game.versions[1].design], ['remix', 'design_ready', NEW_DESIGN]);

  // "Build it": the copy's code rewritten for the new design, reviewed.
  await post(`/api/generations/${remixId}/versions/2/build`, {}, kim);
  job = jobs.at(-1).job;
  assert.deepEqual([job.step, job.design, job.remix.design, job.remix.source, job.review], ['build', NEW_DESIGN, copy.design, copy.source, true]);
  const teams = renamedSource('Majority Rules - Remixed').replace('</script>', '// teams\n</script>');
  jobs.at(-1).finish({ ok: true, source: teams, report: { ok: true, problems: [], game: { name: 'Majority Rules - Remixed', description: 'Teams vote' } }, changelog: '- Two teams' });
  await server.generation.current;
  game = (await get(`/api/generations/${remixId}`, kim)).game;
  assert.equal(game.versions[1].status, 'ready');

  // Only once: after that, ordinary changes, planned against the remix's own design.
  assert.deepEqual(await errorOf(await post(`/api/generations/${remixId}/remix-design`, { request: 'Something else again' }, kim)), [409, 'ALREADY_CHANGED']);
  await post(`/api/generations/${remixId}/versions`, { request: 'Make the vote 20 seconds' }, kim);
  job = jobs.at(-1).job;
  assert.deepEqual([job.step, job.change.design, job.change.earlierRequests, job.change.source], ['design', NEW_DESIGN, [], teams]);
});

test('an account can make only so many remixes an hour (plan §59): each is a whole copy of a game', async () => {
  const kim = await signUp(baseUrl, 'kim');
  for (let i = 0; i < 10; i++) assert.equal((await post('/api/games/punchline/remix', {}, kim)).status, 201, `remix ${i + 1}`);
  assert.deepEqual(await errorOf(await post('/api/games/punchline/remix', {}, kim)), [429, 'TOO_MANY_REMIXES']);
});
