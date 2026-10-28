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

test('wrong passwords for deleting the account use up the same 10 tries as saving a key', async () => {
  const cookie = await signUp(baseUrl);
  verdict = 'rejected';
  for (let i = 0; i < 10; i++) assert.equal((await call('PUT', cookie, { key: KEY })).status, 400);
  const res = await fetch(`${baseUrl}/api/account`, {
    method: 'DELETE',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'not it at all' }),
  });
  assert.deepEqual([res.status, (await res.json()).error], [429, 'TOO_MANY_ATTEMPTS']);
});

test('deleting your account (plan §54): your password again, then everything of yours is gone and you are logged out', async () => {
  const { createGameServer } = await import('../../src/server.js');
  const { GameRegistry } = await import('../../src/games/registry.js');
  const { renamedSource } = await import('../helpers/frameGames.js');
  const { signUp, postJson } = await import('../helpers/accounts.js');
  const jobs = [];
  const runGenerator = () => new Promise((finish) => jobs.push(finish));
  const server = createGameServer({ GENERATION_ENABLED: true }, { games: new GameRegistry(), runGenerator, checkKey: async () => 'ok' });
  server.generation.log = () => {};
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const base = `http://localhost:${server.httpServer.address().port}`;
  const send = (method, path, body, cookie) => fetch(`${base}${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const sam = await signUp(base, 'sam'); // password: test-password-123
    await send('PUT', '/api/account/genai-key', { key: 'sk-0123456789abcdef0123456789abcdef' }, sam);
    const { game } = await (await postJson(base, '/api/generations', { idea: 'Everyone votes; the most popular answer wins' }, { Cookie: sam })).json();

    // Not while a game is being made.
    assert.equal((await send('DELETE', '/api/account', { password: 'test-password-123' }, sam)).status, 409);
    jobs.shift()({ ok: true, design: '# Vote\n## Rules\nVote.\n' });
    await server.generation.current;
    await postJson(base, `/api/generations/${game.id}/versions/1/build`, {}, { Cookie: sam });
    jobs.shift()({ ok: true, source: renamedSource('Vote Off'), report: { ok: true, problems: [], game: { name: 'Vote Off', description: 'Vote' } } });
    await server.generation.current;
    await postJson(base, `/api/generations/${game.id}/versions/1/playtest`, {}, { Cookie: sam });
    await postJson(base, `/api/generations/${game.id}/publish`, {}, { Cookie: sam });
    assert.ok((await (await fetch(`${base}/api/games`)).json()).games.some((g) => g.id === game.id));
    const { recordPlay } = await import('../../src/db/plays.js');
    recordPlay(server.db, { gameId: game.id, version: 1, stopped: null, endedAt: 1 }); // someone played it
    // And an upload, counted for the uploads-an-hour limit.
    assert.equal((await postJson(base, `/api/generations/${game.id}/upload`, { source: renamedSource('Vote Off 2') }, { Cookie: sam })).status, 202);
    jobs.shift()({ ok: true, source: renamedSource('Vote Off 2'), report: { ok: true, problems: [], game: { name: 'Vote Off 2', description: 'Vote' } } });
    await server.generation.current;
    assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM uploads').get().n, 1);

    // The wrong password: nothing happens.
    const wrong = await send('DELETE', '/api/account', { password: 'not it at all' }, sam);
    assert.deepEqual([wrong.status, (await wrong.json()).error], [403, 'WRONG_PASSWORD']);

    const gone = await send('DELETE', '/api/account', { password: 'test-password-123' }, sam);
    assert.equal(gone.status, 204);
    assert.match(gone.headers.get('set-cookie'), /Max-Age=0/);
    // Its published game left the site, its login works no more, its name is free.
    assert.equal((await (await fetch(`${base}/api/games`)).json()).games.some((g) => g.id === game.id), false);
    assert.equal((await (await fetch(`${base}/api/me`, { headers: { Cookie: sam } })).json()).user, null);
    assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM generated_games').get().n, 0);
    assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM genai_keys').get().n, 0);
    assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM game_plays').get().n, 0);
    assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM uploads').get().n, 0);
    assert.equal((await postJson(base, '/api/signup', { username: 'sam', password: 'another good password' })).status, 201);
  } finally {
    await server.close();
  }
});
