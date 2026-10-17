import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/http/app.js';
import { config } from '../../src/config.js';

// M8: with a built website (client/dist), the server serves it: its files, and index.html
// for any page address, while /api stays the API. Uses a tiny stand-in build in a temp folder.
let server;
let baseUrl;
let dist;

before(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'boilergames-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');
  server = http.createServer(createApp({ cfg: { ...config, CLIENT_DIST_PATH: dist } }));
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dist, { recursive: true, force: true });
});

test('a page address gets index.html, checked again on every visit', async () => {
  for (const page of ['/', '/games', '/create/g-abcd1234', '/u/someone']) {
    const res = await fetch(`${baseUrl}${page}`);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /id="root"/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
  }
});

test('built files are served; the hashed ones may be cached for a year', async () => {
  const asset = await fetch(`${baseUrl}/assets/index-abc123.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /max-age=31536000, immutable/);
  assert.equal((await fetch(`${baseUrl}/favicon.svg`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/assets/missing.js`)).status, 404);
});

test('/api is still the API, not the website', async () => {
  const res = await fetch(`${baseUrl}/api/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'NOT_FOUND' });
});

test('without a build (development), page addresses are not served', async () => {
  const dev = http.createServer(createApp({ cfg: { ...config, CLIENT_DIST_PATH: path.join(dist, 'nope') } }));
  await new Promise((resolve) => dev.listen(0, resolve));
  const res = await fetch(`http://localhost:${dev.address().port}/games`);
  assert.equal(res.status, 404);
  await new Promise((resolve) => dev.close(resolve));
});
