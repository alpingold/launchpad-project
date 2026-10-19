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

// The parts of client/index.html the server fills in for each page.
const INDEX_HTML = `<!doctype html><html><head>
<title>BoilerGames · Party games</title>
<meta name="description" content="The site." />
<meta property="og:title" content="BoilerGames" />
<meta property="og:description" content="The site." />
<meta property="og:url" content="https://boilergames.party/" />
</head><body><div id="root"></div></body></html>`;

before(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'boilergames-dist-'));
  writeFileSync(path.join(dist, 'index.html'), INDEX_HTML);
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
  for (const page of ['/', '/games', '/create/g-abcd1234', '/join/']) {
    const res = await fetch(`${baseUrl}${page}`);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /id="root"/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
  }
});

test('each page has its own title, description and canonical address in the HTML (plan §33)', async () => {
  const games = await (await fetch(`${baseUrl}/games/`)).text();
  assert.match(games, /<title>Games · BoilerGames<\/title>/);
  assert.match(games, /<meta property="og:title" content="Games · BoilerGames"/);
  assert.match(games, /<meta name="description" content="Every party game on BoilerGames/);
  assert.match(games, new RegExp(`<link rel="canonical" href="${baseUrl}/games" />`));
  assert.match(games, new RegExp(`<meta property="og:url" content="${baseUrl}/games"`));

  // The home page keeps index.html's own title.
  assert.match(await (await fetch(`${baseUrl}/`)).text(), /<title>BoilerGames · Party games<\/title>/);
});

test('an address that is no page is a 404 that search engines skip, still showing the site', async () => {
  for (const page of ['/nope', '/games/no-such-game', '/u/nobody-here', '/games/a/b']) {
    const res = await fetch(`${baseUrl}${page}`);
    assert.equal(res.status, 404, page);
    const html = await res.text();
    assert.match(html, /id="root"/, page);
    assert.match(html, /<meta name="robots" content="noindex" \/>/, page);
    assert.match(html, /<title>Page not found · BoilerGames<\/title>/, page);
    assert.doesNotMatch(html, /rel="canonical"/, page);
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

test('search engines (plan §33): a real robots.txt and a sitemap of the public pages, not the website', async () => {
  const robots = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get('content-type'), /^text\/plain/);
  const text = await robots.text();
  assert.match(text, /^User-agent: \*$/m);
  assert.match(text, /^Disallow: \/admin$/m);
  assert.match(text, new RegExp(`^Sitemap: ${baseUrl}/sitemap.xml$`, 'm'));

  const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
  assert.match(sitemap.headers.get('content-type'), /^application\/xml/);
  const xml = await sitemap.text();
  assert.match(xml, /^<\?xml/);
  for (const page of ['/', '/games', '/kit']) assert.ok(xml.includes(`<loc>${baseUrl}${page}</loc>`), page);
  assert.doesNotMatch(xml, /id="root"/);
});
