import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { setAdmin } from '../../src/db/users.js';
import { signUp, postJson, uniqueUsername } from '../helpers/accounts.js';

// Bug reports (plan §31): the site-wide form, and the admin's list of what it sent.

let server;
let baseUrl;

beforeEach(async () => {
  server = createGameServer({ REPORTS_PER_WINDOW: 3 });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});

afterEach(() => server.close());

const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const post = (path, body, cookie) => postJson(baseUrl, path, body, cookie ? { Cookie: cookie } : {});
const send = (path, method, cookie) => fetch(`${baseUrl}${path}`, { method, headers: { Cookie: cookie } });

async function adminCookie() {
  const name = uniqueUsername('boss');
  const cookie = await signUp(baseUrl, name);
  setAdmin(server.db, name, true);
  return cookie;
}

const REPORT = { kind: 'bug', body: 'The join button does nothing on my phone.', page: '/join', device: 'iPhone · Safari' };

test('anyone can send a report; logged in it carries the username; admins read them newest first', async () => {
  assert.equal((await post('/api/reports', REPORT)).status, 201);
  const name = uniqueUsername('tester');
  const cookie = await signUp(baseUrl, name);
  assert.equal((await post('/api/reports', { kind: 'idea', body: '  More games with drawing please!  ' }, cookie)).status, 201);

  const admin = await adminCookie();
  const { reports } = await (await get('/api/admin/reports', admin)).json();
  assert.equal(reports.length, 2);
  assert.equal(reports[0].username, name);
  assert.equal(reports[0].body, 'More games with drawing please!', 'trimmed');
  assert.deepEqual(
    { ...reports[1], id: undefined, createdAt: undefined },
    { ...REPORT, username: null, doneAt: null, id: undefined, createdAt: undefined },
  );
});

test('a report is checked: its kind, 10-2000 characters, and a page on this site only', async () => {
  assert.equal((await post('/api/reports', { ...REPORT, kind: 'rant' })).status, 400);
  assert.equal((await post('/api/reports', { ...REPORT, body: 'broken' })).status, 400);
  assert.equal((await post('/api/reports', { ...REPORT, body: 'x'.repeat(2001) })).status, 400);
  assert.equal((await post('/api/reports', { ...REPORT, page: '//evil.example/x' })).status, 201);
  assert.equal((await post('/api/reports', { ...REPORT, page: 'https://evil.example' })).status, 201);
  const { reports } = await (await get('/api/admin/reports', await adminCookie())).json();
  assert.deepEqual(reports.map((r) => r.page), [null, null], 'saved, without the outside address');
});

test('a few per address per window, then "try again later"; a bot filling the hidden field is told ok but nothing is saved', async () => {
  assert.equal((await post('/api/reports', { ...REPORT, website: 'http://spam.example' })).status, 201);
  assert.equal((await post('/api/reports', REPORT)).status, 201);
  assert.equal((await post('/api/reports', REPORT)).status, 201);
  const res = await post('/api/reports', REPORT);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'TOO_MANY_REPORTS');
  const { reports } = await (await get('/api/admin/reports', await adminCookie())).json();
  assert.equal(reports.length, 2);
});

test('only admins read, mark done or delete reports', async () => {
  await post('/api/reports', REPORT);
  const someone = await signUp(baseUrl);
  assert.equal((await get('/api/admin/reports')).status, 401);
  assert.equal((await get('/api/admin/reports', someone)).status, 403);
  assert.equal((await send('/api/admin/reports/1', 'DELETE', someone)).status, 403);

  const admin = await adminCookie();
  const [{ id }] = (await (await get('/api/admin/reports', admin)).json()).reports;
  assert.equal((await post(`/api/admin/reports/${id}/done`, { done: true }, admin)).status, 204);
  assert.ok((await (await get('/api/admin/reports', admin)).json()).reports[0].doneAt > 0);
  assert.equal((await post(`/api/admin/reports/${id}/done`, { done: false }, admin)).status, 204);
  assert.equal((await (await get('/api/admin/reports', admin)).json()).reports[0].doneAt, null);
  assert.equal((await send(`/api/admin/reports/${id}`, 'DELETE', admin)).status, 204);
  assert.equal((await send(`/api/admin/reports/${id}`, 'DELETE', admin)).status, 404);
  assert.deepEqual((await (await get('/api/admin/reports', admin)).json()).reports, []);
});
