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
    body: JSON.stringify({ junk: 'x'.repeat(30_000) }),
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

test('security headers on every response (M8); no "X-Powered-By"', async () => {
  for (const path of ['/api/health', '/api/nope']) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    // No script rules: game frames (srcdoc) inherit the page's policy and use inline scripts.
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /script-src|default-src/);
    assert.equal(res.headers.get('strict-transport-security'), null, 'HSTS only in production');
  }
});

test('GET /api/genai-status says whether GenAI Studio is up (plan §53), and whether this server makes games', async () => {
  const { createGameServer } = await import('../../src/server.js');
  const fake = { status: () => ({ up: false, checkedAt: 5, since: 4 }), stop() {} };
  const server = createGameServer({ GENERATION_ENABLED: true }, { genaiStatus: fake });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const res = await fetch(`http://localhost:${server.httpServer.address().port}/api/genai-status`);
  assert.deepEqual(await res.json(), { enabled: true, up: false, checkedAt: 5, since: 4 });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  await server.close();
});

test('GET /api/kit/prompt is the prompt kit as plain text, or a file to save (plan §57)', async () => {
  const { createGameServer } = await import('../../src/server.js');
  const server = createGameServer({});
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const base = `http://localhost:${server.httpServer.address().port}`;
  try {
    const res = await fetch(`${base}/api/kit/prompt`);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    assert.match(await res.text(), /^I want you to make a party game for BoilerGames/);
    const file = await fetch(`${base}/api/kit/prompt?download=1`);
    assert.match(file.headers.get('content-disposition'), /^attachment; filename="?boilergames-prompt\.txt"?$/);
  } finally {
    await server.close();
  }
});
