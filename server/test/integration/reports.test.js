import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { setAdmin } from '../../src/db/users.js';
import { signUp, postJson, uniqueUsername } from '../helpers/accounts.js';

// Bug reports (plan §31): the site-wide form, and the admin's list of what it sent.

let server;
let baseUrl;

beforeEach(async () => {
  server = createGameServer({ REPORTS_PER_WINDOW: 3, GAME_REPORTS_PER_WINDOW: 3 });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});

afterEach(() => server.close());

const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const post = (path, body, cookie) => postJson(baseUrl, path, body, cookie ? { Cookie: cookie } : {});
const send = (path, method, cookie) => fetch(`${baseUrl}${path}`, { method, headers: { Cookie: cookie } });
const put = (path, body, cookie) =>
  fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });

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
  assert.equal((await post('/api/reports', { kind: 'content', body: 'This game shows slurs on the big screen.', page: '/games/g-abc12345' })).status, 201); // plan §57
  assert.equal((await post('/api/reports', { kind: 'idea', body: '  More games with drawing please!  ' }, cookie)).status, 201);

  const admin = await adminCookie();
  const { reports } = await (await get('/api/admin/reports', admin)).json();
  assert.equal(reports.length, 3);
  assert.equal(reports[1].kind, 'content');
  assert.equal(reports[0].username, name);
  assert.equal(reports[0].body, 'More games with drawing please!', 'trimmed');
  assert.deepEqual(
    { ...reports[2], id: undefined, createdAt: undefined },
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

// --- On a game's page (plan §31b) ---

const list = async (cookie) => (await get('/api/games/punchline/reports', cookie)).json();
async function postReport(cookie, body) {
  const res = await post('/api/games/punchline/reports', { body, device: 'Android phone · Chrome' }, cookie);
  assert.equal(res.status, 201);
  return (await res.json()).report;
}

test('game reports: anyone reads them; posting needs an account; a game nobody can see has none', async () => {
  assert.deepEqual(await list(), { reports: [], canPost: false, canMarkFixed: false });
  assert.equal((await post('/api/games/punchline/reports', { body: 'The timer never ends.' })).status, 401);
  assert.equal((await get('/api/games/no-such-game/reports')).status, 404);

  const cookie = await signUp(baseUrl);
  assert.equal((await post('/api/games/punchline/reports', { body: 'short' }, cookie)).status, 400);
  assert.equal((await post('/api/games/no-such-game/reports', { body: 'The timer never ends.' }, cookie)).status, 404);
  const report = await postReport(cookie, '  The timer never ends on my phone.  ');
  assert.equal(report.body, 'The timer never ends on my phone.');
  assert.equal(report.device, 'Android phone · Chrome');
  assert.deepEqual({ score: report.score, myVote: report.myVote, mine: report.mine, canVote: report.canVote, canDelete: report.canDelete, fixed: report.fixed }, { score: 0, myVote: 0, mine: true, canVote: false, canDelete: true, fixed: false });

  const seen = await list();
  assert.equal(seen.reports.length, 1);
  assert.equal(seen.reports[0].mine, false, 'logged out, nothing is yours');
});

test('votes add up to one total, which can go negative; the most agreed-with come first', async () => {
  const [ana, ben, cal] = [await signUp(baseUrl), await signUp(baseUrl), await signUp(baseUrl)];
  const useless = await postReport(ana, 'This game is bad lol lol lol');
  const real = await postReport(ben, 'Votes for the second matchup are lost.');
  const later = await postReport(cal, 'The intro music is very loud.');
  // Newest first while nobody has voted.
  assert.deepEqual((await list()).reports.map((r) => r.id), [later.id, real.id, useless.id]);

  const vote = (rid, value, cookie) => put(`/api/game-reports/${rid}/vote`, { value }, cookie);
  assert.equal((await vote(real.id, 1, ana)).status, 200);
  assert.equal((await vote(real.id, 1, cal)).status, 200);
  assert.equal((await vote(useless.id, -1, ben)).status, 200);
  const res = await vote(useless.id, -1, cal);
  assert.deepEqual(((await res.json()).report).score, -2);

  const seen = await list(cal);
  assert.deepEqual(seen.reports.map((r) => [r.id, r.score, r.myVote]), [[real.id, 2, 1], [later.id, 0, 0], [useless.id, -2, -1]]);

  // Change your mind, or take it back.
  assert.equal((await (await vote(real.id, -1, cal)).json()).report.score, 0);
  assert.equal((await (await vote(real.id, 0, cal)).json()).report.score, 1);

  assert.equal((await vote(real.id, 1, ben)).status, 403, 'not your own');
  assert.equal((await vote(real.id, 2, ana)).status, 400);
  assert.equal((await vote(real.id, 1)).status, 401);
  assert.equal((await vote(99999, 1, ana)).status, 404);
});

test("the game's creator (here: an admin, for an official game) marks reports fixed; the author or an admin deletes", async () => {
  const [ana, ben] = [await signUp(baseUrl), await signUp(baseUrl)];
  const admin = await adminCookie();
  const report = await postReport(ana, 'The last round never starts.');
  assert.equal((await list(admin)).canMarkFixed, true);
  assert.equal((await list(ana)).canMarkFixed, false);

  assert.equal((await post(`/api/game-reports/${report.id}/fixed`, { fixed: true }, ana)).status, 403);
  const fixed = await post(`/api/game-reports/${report.id}/fixed`, { fixed: true }, admin);
  assert.equal((await fixed.json()).report.fixed, true);
  assert.equal((await list()).reports[0].fixed, true);

  assert.equal((await send(`/api/game-reports/${report.id}`, 'DELETE', ben)).status, 403);
  assert.equal((await send(`/api/game-reports/${report.id}`, 'DELETE', ana)).status, 204);
  const other = await postReport(ben, 'Prompts repeat in the second round.');
  assert.equal((await send(`/api/game-reports/${other.id}`, 'DELETE', admin)).status, 204);
  assert.deepEqual((await list()).reports, []);
});

test('a few game reports per account per hour; the admin sees the newest across games', async () => {
  const ana = await signUp(baseUrl);
  for (let i = 1; i <= 3; i++) await postReport(ana, `Problem number ${i} in this game.`);
  const res = await post('/api/games/punchline/reports', { body: 'Problem number 4 in this game.' }, ana);
  assert.equal(res.status, 429);
  assert.equal((await post('/api/games/punchline/reports', { body: 'Problem number 1 from Ben.' }, await signUp(baseUrl))).status, 201, 'per account');

  const { gameReports } = await (await get('/api/admin/reports', await adminCookie())).json();
  assert.equal(gameReports.length, 4);
  assert.deepEqual(
    { ...gameReports[0], id: undefined, createdAt: undefined, author: undefined },
    { gameId: 'punchline', gameName: 'Punchline', body: 'Problem number 1 from Ben.', device: null, score: 0, fixed: false, id: undefined, createdAt: undefined, author: undefined },
  );
});
