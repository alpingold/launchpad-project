import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../../src/server.js';
import { GameRegistry } from '../../src/games/registry.js';
import { setAdmin } from '../../src/db/users.js';
import { openClient } from '../helpers/wsClient.js';
import { signUp } from '../helpers/accounts.js';
import countGame from '../fixtures/countGame.js';

// Generated games and the admin role, through the real server (plan §11, A3).

let server;
let baseUrl;
let wsUrl;
let registry;

beforeEach(async () => {
  registry = new GameRegistry();
  registry.register(countGame);
  server = createGameServer({}, { games: registry });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const { port } = server.httpServer.address();
  baseUrl = `http://localhost:${port}`;
  wsUrl = `ws://localhost:${port}/ws`;
});

afterEach(() => server.close());

const me = async (cookie) => (await (await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } })).json()).user;
const gameIds = async (cookie) =>
  (await (await fetch(`${baseUrl}/api/games`, { headers: cookie ? { Cookie: cookie } : {} })).json()).games.map((g) => g.id);

async function nextOfType(client, type) {
  for (;;) {
    const msg = await client.next();
    if (msg.type === type) return msg;
  }
}

/** A logged-in host with a room and one player; returns what's needed to start games. */
async function hostWithPlayer(cookie) {
  const host = await openClient(wsUrl, { headers: { Cookie: cookie } });
  host.send({ type: 'host:create_room' });
  const { code } = await host.next();
  const alex = await openClient(wsUrl);
  alex.send({ type: 'player:join', code, name: 'Alex' });
  await nextOfType(alex, 'room:joined');
  return { host, alex };
}

test('/api/me says who is an admin', async () => {
  const cookie = await signUp(baseUrl, 'boss');
  assert.equal((await me(cookie)).isAdmin, false);
  setAdmin(server.db, 'boss', true);
  assert.equal((await me(cookie)).isAdmin, true);
});

test('a playtest game is listed and startable only for the account that generated it', async () => {
  const ownerCookie = await signUp(baseUrl, 'owner');
  const otherCookie = await signUp(baseUrl, 'other');
  const ownerId = (await me(ownerCookie)).id;
  registry.register({ ...countGame, id: 'g-playtest1' }, { source: 'generated', status: 'playtest', ownerUserId: ownerId });

  assert.deepEqual(await gameIds(ownerCookie), ['count-game', 'g-playtest1']);
  assert.deepEqual(await gameIds(otherCookie), ['count-game']);
  assert.deepEqual(await gameIds(null), ['count-game']);

  // Another host can't start it even knowing its id.
  const other = await hostWithPlayer(otherCookie);
  other.host.send({ type: 'host:start_game', gameId: 'g-playtest1' });
  assert.equal((await nextOfType(other.host, 'error')).code, 'GAME_NOT_FOUND');

  // The owner can.
  const owner = await hostWithPlayer(ownerCookie);
  owner.host.send({ type: 'host:start_game', gameId: 'g-playtest1' });
  assert.equal((await nextOfType(owner.alex, 'game:started')).gameId, 'g-playtest1');

  for (const c of [other.host, other.alex, owner.host, owner.alex]) c.close();
});

test('a published generated game is for everyone', async () => {
  registry.register({ ...countGame, id: 'g-public1' }, { source: 'generated', status: 'published', ownerUserId: 999 });
  const cookie = await signUp(baseUrl);
  assert.deepEqual(await gameIds(cookie), ['count-game', 'g-public1']);
  const games = (await (await fetch(`${baseUrl}/api/games`)).json()).games;
  assert.deepEqual([games[1].source, games[1].status], ['generated', 'published']);
});

// --- The admin script, run as a real command against a throwaway database -----------

test('npm run admin: grant, import a game (only if it passes the harness), list, set status', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'boilergames-admin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../../scripts/admin.js', import.meta.url));
  const env = { ...process.env, DB_PATH: path.join(dir, 'test.db') };
  const admin = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });

  // An account to work with (normally made by signing up on the site).
  const setupDb = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { openDatabase } from '${new URL('../../src/db/database.js', import.meta.url)}';
       import { createUser } from '${new URL('../../src/db/users.js', import.meta.url)}';
       createUser(openDatabase(process.env.DB_PATH), 'alpingold', 'scrypt$x');`,
    ],
    { encoding: 'utf8', env },
  );
  assert.equal(setupDb.status, 0, setupDb.stderr);

  assert.match(admin('grant', 'alpingold').stdout, /alpingold is now an admin/);
  assert.match(admin('users').stdout, /alpingold\t\(admin\)/);
  assert.equal(admin('grant', 'nobody').status, 1);

  const broken = admin('import-game', fileURLToPath(new URL('../fixtures/harness/bad-screen.js', import.meta.url)), '--owner', 'alpingold');
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /Not imported/);

  const good = admin('import-game', fileURLToPath(new URL('../../src/games/reaction-race/index.js', import.meta.url)), '--owner', 'alpingold');
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const id = /Imported as (g-[a-z2-9]+) \(playtest/.exec(good.stdout)?.[1];
  assert.ok(id, good.stdout);

  assert.match(admin('games').stdout, new RegExp(`${id}\\tplaytest\\s+\\tReaction Race\\tby alpingold`));
  assert.match(admin('set-status', id, 'published').stdout, /is now published/);
  assert.equal(admin('set-status', id, 'banana').status, 1);
  assert.match(admin('delete-game', id).stdout, /Deleted/);
  assert.match(admin('games').stdout, /No generated games yet/);
});
