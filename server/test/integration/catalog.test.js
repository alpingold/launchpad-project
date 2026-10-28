import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { setAdmin } from '../../src/db/users.js';
import { createGeneratedGame, deleteGeneratedGame } from '../../src/db/generatedGames.js';
import { recordPlay } from '../../src/db/plays.js';
import { signUp } from '../helpers/accounts.js';
import { tapGame } from '../helpers/frameGames.js';

// The catalogue's game pages, votes, creators and profiles (plan §16), over real HTTP.

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);
let server;
let baseUrl;
let registry;

beforeEach(async () => {
  registry = new GameRegistry();
  registry.register(tapGame('official-one'));
  server = createGameServer({}, { games: registry });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${server.httpServer.address().port}`;
});
afterEach(() => server.close());

const me = async (cookie) => (await (await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } })).json()).user;
const get = async (path, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
};
const put = async (path, body, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

/** sam's published AI game (as g-sam00001, with v2 in playtest next to it). */
async function samsGame() {
  const sam = await signUp(baseUrl, 'sam');
  const samId = (await me(sam)).id;
  createGeneratedGame(server.db, { ownerUserId: samId, prompt: 'A voting game for everyone' });
  const meta = { source: 'generated', ownerUserId: samId, baseId: 'g-sam00001', shots: { host: JPEG, phone: JPEG } };
  registry.register(tapGame('g-sam00001'), { ...meta, status: 'published', version: 1 });
  registry.register(tapGame('g-sam00001-v2'), { ...meta, status: 'playtest', version: 2 });
  return { sam, samId };
}

test('every game says who made it; official games have no creator', async () => {
  await samsGame();
  const { body } = await get('/api/games');
  assert.deepEqual(body.games.map((g) => [g.id, g.creator]), [['official-one', null], ['g-sam00001', { username: 'sam' }]]);
});

test("votes: logged in, once per account, changeable; not on your own game; a game's versions share them", async () => {
  const { sam } = await samsGame();
  assert.equal((await put('/api/games/g-sam00001/vote', { value: 1 })).status, 401);
  assert.deepEqual((await put('/api/games/g-sam00001/vote', { value: 1 }, sam)).body.error, 'OWN_GAME');

  const kim = await signUp(baseUrl, 'kim');
  const lee = await signUp(baseUrl, 'lee');
  assert.equal((await put('/api/games/g-sam00001/vote', { value: 2 }, kim)).body.error, 'INVALID_VOTE');
  let game = (await put('/api/games/g-sam00001/vote', { value: 1 }, kim)).body.game;
  assert.deepEqual([game.votes, game.myVote], [{ up: 1, down: 0 }, 1]);
  await put('/api/games/g-sam00001/vote', { value: -1 }, lee);
  game = (await put('/api/games/g-sam00001/vote', { value: -1 }, kim)).body.game; // changed their mind
  assert.deepEqual(game.votes, { up: 0, down: 2 });
  game = (await put('/api/games/g-sam00001/vote', { value: 0 }, kim)).body.game; // took it back
  assert.deepEqual([game.votes, game.myVote], [{ up: 0, down: 1 }, 0]);

  // sam's playtest v2 shows the same votes (it's the same game).
  const v2 = (await get('/api/games/g-sam00001-v2', sam)).body.game;
  assert.deepEqual([v2.pageId, v2.votes], ['g-sam00001', { up: 0, down: 1 }]);
  assert.equal((await get('/api/games/g-sam00001-v2', kim)).status, 404, 'a playtest version: only its creator');
});

test("the list carries each game's finished plays (for the \"most played\" sort); a game's versions share them", async () => {
  const { sam } = await samsGame();
  recordPlay(server.db, { gameId: 'g-sam00001', version: 1, stopped: null });
  recordPlay(server.db, { gameId: 'g-sam00001', version: 2, stopped: null });
  recordPlay(server.db, { gameId: 'g-sam00001', version: 1, stopped: 'host' }); // stopped: not counted
  recordPlay(server.db, { gameId: 'official-one', version: null, stopped: null });
  const { body } = await get('/api/games', sam);
  assert.deepEqual(body.games.map((g) => [g.id, g.plays]), [['official-one', 1], ['g-sam00001', 2], ['g-sam00001-v2', 2]]);
});

test("deleting a generated game deletes its page, votes and games played", async () => {
  const kim = await signUp(baseUrl, 'kim');
  const kimId = (await me(kim)).id;
  const game = createGeneratedGame(server.db, { ownerUserId: kimId, prompt: 'A voting game for everyone' });
  setVoteAndPage(game.id, kimId);
  recordPlay(server.db, { gameId: game.id, version: 1, stopped: null });
  assert.equal(count('game_votes', game.id) + count('game_pages', game.id) + count('game_plays', game.id), 3);
  deleteGeneratedGame(server.db, game.id);
  assert.equal(count('game_votes', game.id) + count('game_pages', game.id) + count('game_plays', game.id), 0);
});

const count = (table, id) => server.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE game_id = ?`).get(id).n;
function setVoteAndPage(gameId, userId) {
  server.db.prepare('INSERT INTO game_votes (game_id, user_id, value, created_at) VALUES (?, ?, 1, 0)').run(gameId, userId);
  server.db.prepare("INSERT INTO game_pages (game_id, about, updated_at) VALUES (?, 'x', 0)").run(gameId);
}

test("editing a game's page: its creator or an admin; checked; empty means the file's own value", async () => {
  const { sam } = await samsGame();
  const kim = await signUp(baseUrl, 'kim');
  const edit = { name: 'Vote Party', description: 'Vote fast.', about: 'Long story.\nTwo lines.', tags: ['voting', 'co-op'], minutes: [5, 10], mainShot: 'phone' };
  assert.equal((await put('/api/games/g-sam00001/page', edit)).status, 401);
  assert.equal((await put('/api/games/g-sam00001/page', edit, kim)).body.error, 'NOT_CREATOR');

  const before = (await get('/api/games/g-sam00001', sam)).body.game;
  assert.deepEqual([before.canEdit, before.fromFile.name, before.about], [true, 'Tap Test', '']);
  assert.equal((await get('/api/games/g-sam00001', kim)).body.game.fromFile, undefined, "only editors see the file's values");

  const { status, body } = await put('/api/games/g-sam00001/page', edit, sam);
  assert.equal(status, 200);
  assert.deepEqual(
    [body.game.name, body.game.description, body.game.about, body.game.tags, body.game.minutes, body.game.shots],
    ['Vote Party', 'Vote fast.', 'Long story.\nTwo lines.', ['voting', 'co-op'], [5, 10], ['phone', 'host']],
  );
  // Everyone sees it, for every version; the thumbnail is now the phone picture.
  assert.equal((await get('/api/games')).body.games[1].name, 'Vote Party');
  assert.equal((await get('/api/games/g-sam00001-v2', sam)).body.game.name, 'Vote Party');
  assert.equal((await fetch(`${baseUrl}/api/games/g-sam00001/thumb`)).status, 200);

  for (const [bad, pattern] of [
    [{ name: 'x'.repeat(41) }, /name must be 1–40/],
    [{ about: 'x'.repeat(1501) }, /at most 1500/],
    [{ tags: ['platforming'] }, /unknown tag/],
    [{ minutes: [10, 5] }, /minutes must be/],
    [{ mainShot: 'video' }, /main screenshot/],
    [{ name: 42 }, /must be text/],
  ]) {
    const res = await put('/api/games/g-sam00001/page', bad, sam);
    assert.equal(res.status, 400);
    assert.match(res.body.message, pattern);
  }

  // Empty fields: back to what the game file says.
  const reset = (await put('/api/games/g-sam00001/page', { name: '', description: '', about: '', tags: [], minutes: null, mainShot: null }, sam)).body.game;
  assert.deepEqual([reset.name, reset.about, reset.tags, reset.shots], ['Tap Test', '', [], ['host', 'phone']]);

  // An admin can edit any game, official ones too; nobody else can edit an official game.
  assert.equal((await put('/api/games/official-one/page', { about: 'Hi' }, sam)).body.error, 'NOT_CREATOR');
  const boss = await signUp(baseUrl, 'boss');
  setAdmin(server.db, 'boss', true);
  assert.equal((await put('/api/games/official-one/page', { about: 'By the team.' }, boss)).body.game.about, 'By the team.');
  assert.equal((await put('/api/games/g-sam00001/page', { about: 'Tidied.' }, boss)).status, 200);
});

test('profiles: a bio and the games of theirs you may see', async () => {
  const { sam } = await samsGame();
  assert.equal((await put('/api/account/profile', { bio: 'Hi' })).status, 401);
  assert.equal((await put('/api/account/profile', { bio: 'x'.repeat(501) }, sam)).body.error, 'INVALID_BIO');
  assert.deepEqual((await put('/api/account/profile', { bio: '  I make voting games.  ' }, sam)).body, { bio: 'I make voting games.' });

  const visitor = (await get('/api/users/SAM')).body; // any capitalization
  assert.deepEqual([visitor.profile.username, visitor.profile.bio], ['sam', 'I make voting games.']);
  assert.equal(typeof visitor.profile.joinedAt, 'number');
  assert.deepEqual(visitor.games.map((g) => g.id), ['g-sam00001'], 'not the playtest version');
  assert.deepEqual((await get('/api/users/sam', sam)).body.games.map((g) => g.id), ['g-sam00001', 'g-sam00001-v2'], 'sam sees their own playtest too');
  assert.equal((await get('/api/users/nobody')).status, 404);
});
