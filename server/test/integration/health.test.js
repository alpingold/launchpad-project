import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/http/app.js';

// Start the real app on port 0 (the OS picks a free port) so tests never clash
// with a dev server that's already running on 3000.
let server;
let baseUrl;

before(async () => {
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('GET /api/health returns ok', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('unknown /api route returns JSON 404', async () => {
  const res = await fetch(`${baseUrl}/api/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'NOT_FOUND' });
});

test('malformed JSON body returns 400 without a stack trace', async () => {
  const res = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'BAD_REQUEST' });
});

test('oversized JSON body is rejected', async () => {
  const res = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ junk: 'x'.repeat(20_000) }),
  });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'BAD_REQUEST' });
});

test('GET /api/kit returns the game kit guide: the same text the AI reads', async () => {
  const res = await fetch(`${baseUrl}/api/kit`);
  assert.equal(res.status, 200);
  const { sections } = await res.json();
  assert.deepEqual(sections.map((s) => [s.id, s.title]), [['games', 'How games work'], ['designs', 'Writing a design']]);
  assert.match(sections[0].markdown, /^# How a BoilerGames game works/);
  assert.match(sections[1].markdown, /^# Writing a game design/);
});
