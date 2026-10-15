import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/database.js';
import { createUser } from '../../src/db/users.js';
import {
  createGeneratedGame,
  addVersion,
  saveVersionSource,
  markVersionFailed,
  setLiveVersions,
  getGeneratedGame,
  listGeneratedGames,
  listLiveVersions,
  listGeneratingVersions,
  deleteGeneratedGame,
  gameStatus,
  mainVersion,
  sha256,
} from '../../src/db/generatedGames.js';
import { GameRegistry } from '../../src/games/registry.js';
import { loadGeneratedGames } from '../../src/games/generated.js';
import { tapGame, TAP_SOURCE } from '../helpers/frameGames.js';

// AI-generated games and their versions, stored in the database (plan §11 A3, §12e K6).


function setup() {
  const db = openDatabase(':memory:');
  const admin = createUser(db, 'admin', 'scrypt$x');
  const other = createUser(db, 'other', 'scrypt$x');
  /** Stores a game whose version 1 passed, live as `live` ('published', 'playtest' or null). */
  const store = (live = null, source = TAP_SOURCE, ownerUserId = admin.id) => {
    const game = createGeneratedGame(db, { ownerUserId, prompt: 'a tapping game', model: 'qwen3.8:27b' });
    saveVersionSource(db, game.id, 1, { source, report: { ok: true }, name: 'Count to Three', description: 'Tap!' });
    if (live) setLiveVersions(db, game.id, live === 'published' ? { publishedVersion: 1 } : { playtestVersion: 1 });
    return game.id;
  };
  return { db, admin, other, store };
}

test('a new game starts with version 1 generating, then ready with code, fingerprint and report', () => {
  const { db, admin } = setup();
  const game = createGeneratedGame(db, { ownerUserId: admin.id, prompt: 'a tapping game', model: 'qwen3.8:27b', now: 5 });
  assert.match(game.id, /^g-[a-z2-9]{8}$/);
  assert.deepEqual([game.publishedVersion, game.playtestVersion], [null, null]);
  assert.deepEqual(game.versions.map((v) => [v.version, v.status, v.request, v.model]), [[1, 'generating', 'a tapping game', 'qwen3.8:27b']]);
  assert.equal(gameStatus(game), 'generating');
  assert.deepEqual(listGeneratingVersions(db).map((v) => [v.gameId, v.version]), [[game.id, 1]]);

  saveVersionSource(db, game.id, 1, { source: 'code', report: { ok: true }, name: 'Tap', description: 'Tap it', now: 6 });
  const saved = getGeneratedGame(db, game.id);
  const [v1] = saved.versions;
  assert.equal(v1.status, 'ready');
  assert.equal(v1.sourceSha256, sha256('code'));
  assert.deepEqual(v1.report, { ok: true });
  assert.equal(saved.updatedAt, 6);
  assert.equal(gameStatus(saved), 'review');
  assert.equal(mainVersion(saved).name, 'Tap');
});

test('change requests add numbered versions; each remembers its base and changelog', () => {
  const { db, store } = setup();
  const id = store('published');
  assert.equal(addVersion(db, id, { request: 'shorter rounds', basedOn: 1, model: 'qwen3.8:27b' }), 2);
  saveVersionSource(db, id, 2, { source: 'v2 code', report: { ok: true }, name: 'Count to Two', description: 'Tap', changelog: '- Shorter' });
  assert.equal(addVersion(db, id, { request: 'even shorter', basedOn: 2 }), 3);
  markVersionFailed(db, id, 3, 'no passing game after 4 attempts', { source: 'v3 code', changelog: '- Shortest' });

  const game = getGeneratedGame(db, id);
  assert.deepEqual(
    game.versions.map((v) => [v.version, v.status, v.basedOn, v.changelog]),
    [
      [1, 'ready', null, null],
      [2, 'ready', 1, '- Shorter'],
      [3, 'failed', 2, '- Shortest'],
    ],
  );
  assert.equal(game.versions[2].error, 'no passing game after 4 attempts');
  assert.equal(game.versions[2].sourceSha256, sha256('v3 code'), 'the failed attempt is kept to look at');
  assert.equal(gameStatus(game), 'published', 'what is live matters more than a failed attempt');
  assert.equal(mainVersion(game).name, 'Count to Three', 'named after the published version');
});

test('live versions: published and playtest, chosen separately; null takes one down', () => {
  const { db, store } = setup();
  const id = store();
  addVersion(db, id, { request: 'a change', basedOn: 1 });
  saveVersionSource(db, id, 2, { source: TAP_SOURCE, report: { ok: true }, name: 'Count v2' });

  assert.equal(setLiveVersions(db, id, { publishedVersion: 1 }), true);
  assert.equal(setLiveVersions(db, id, { playtestVersion: 2 }), true);
  let game = getGeneratedGame(db, id);
  assert.deepEqual([game.publishedVersion, game.playtestVersion], [1, 2], 'setting one keeps the other');
  assert.deepEqual(listLiveVersions(db).map((l) => [l.as, l.version.version]), [['published', 1], ['playtest', 2]]);

  setLiveVersions(db, id, { publishedVersion: null });
  game = getGeneratedGame(db, id);
  assert.deepEqual([game.publishedVersion, game.playtestVersion], [null, 2]);
  assert.equal(gameStatus(game), 'playtest');
  assert.equal(setLiveVersions(db, 'g-nothere', { publishedVersion: 1 }), false);
});

test('only ready live versions with code are loadable; deleting a game deletes its versions', () => {
  const { db, store } = setup();
  const ids = { review: store(), playtest: store('playtest'), published: store('published') };
  assert.deepEqual(listLiveVersions(db).map((l) => l.game.id).sort(), [ids.playtest, ids.published].sort());
  assert.equal(listGeneratedGames(db).length, 3);
  assert.equal(deleteGeneratedGame(db, ids.published), true);
  assert.equal(listGeneratedGames(db).length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_versions WHERE game_id = ?').get(ids.published).n, 0);
});

test('deleting an account deletes its generated games', () => {
  const { db, other, store } = setup();
  store('published', TAP_SOURCE, other.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(other.id);
  assert.deepEqual(listGeneratedGames(db), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_versions').get().n, 0);
});

// --- Who can see which game --------------------------------------------------------------

test('registry: official and published games are for everyone, playtest only for its owner', () => {
  const registry = new GameRegistry();
  registry.register(tapGame());
  registry.register(tapGame('g-playtest'), { source: 'generated', status: 'playtest', ownerUserId: 1 });
  registry.register(tapGame('g-published'), { source: 'generated', status: 'published', ownerUserId: 1 });

  const ids = (viewer) => registry.list(viewer).map((g) => g.id);
  assert.deepEqual(ids({ userId: 1 }), ['tap-test', 'g-playtest', 'g-published']);
  assert.deepEqual(ids({ userId: 2 }), ['tap-test', 'g-published']);
  assert.deepEqual(ids({}), ['tap-test', 'g-published']);

  assert.ok(registry.get('g-playtest', { userId: 1 }));
  assert.equal(registry.get('g-playtest', { userId: 2 }), undefined);
  assert.equal(registry.get('g-playtest'), undefined);

  const listed = registry.list({ userId: 1 });
  assert.equal(listed[0].source, 'official');
  assert.equal('status' in listed[0], false);
  assert.deepEqual([listed[1].source, listed[1].status], ['generated', 'playtest']);

  assert.throws(() => registry.register(tapGame('g-published')), /already registered/);
  registry.register(tapGame('g-published', { name: 'Newer' }), { source: 'generated', status: 'published', ownerUserId: 1 }, { replace: true });
  assert.equal(registry.get('g-published').name, 'Newer', 'a newly published version replaces the old one');
  assert.throws(() => registry.register({ id: 'g-published' }, {}, { replace: true }), /can't be registered/);
  assert.equal(registry.get('g-published').name, 'Newer', 'an invalid replacement changes nothing');
  assert.equal(registry.unregister('g-playtest'), true);
  assert.equal(registry.get('g-playtest', { userId: 1 }), undefined);
});

// --- Loading at startup -------------------------------------------------------------------

test('loadGeneratedGames: live versions load under their ids (published: g-…, playtest: g-…-vN)', async () => {
  const { db, admin, store } = setup();
  const playtestId = store('playtest');
  const publishedId = store('published');
  store(); // not live: never loaded
  addVersion(db, publishedId, { request: 'a change', basedOn: 1 });
  saveVersionSource(db, publishedId, 2, { source: TAP_SOURCE, report: { ok: true }, name: 'Count v2' });
  setLiveVersions(db, publishedId, { playtestVersion: 2 });

  const registry = new GameRegistry();
  const result = await loadGeneratedGames(db, registry, { warn: () => {} });
  assert.deepEqual(result.loaded.sort(), [`${playtestId}-v1`, publishedId, `${publishedId}-v2`].sort());
  assert.deepEqual(result.skipped, []);

  const game = registry.get(`${playtestId}-v1`, { userId: admin.id });
  assert.equal(game.id, `${playtestId}-v1`, 'runs under its database id');
  assert.equal(game.name, 'Tap Test', 'from the game info in its file');
  assert.equal(game.source, TAP_SOURCE, 'the file, to send to browsers (never run on the server)');
  assert.equal(registry.get(`${publishedId}-v2`, { userId: 99 }), undefined, 'playtest: only its owner');
  assert.ok(registry.get(publishedId, { userId: 99 }), 'published: everyone');
  const byId = (a, b) => a[0].localeCompare(b[0]);
  assert.deepEqual(
    registry.list({ userId: admin.id }).map((g) => [g.id, g.status, g.version]).sort(byId),
    [
      [`${playtestId}-v1`, 'playtest', 1],
      [publishedId, 'published', 1],
      [`${publishedId}-v2`, 'playtest', 2],
    ].sort(byId),
  );
});

test('loadGeneratedGames: tampered or broken versions are skipped with a warning, never stopping startup', async () => {
  const { db, store } = setup();
  const tampered = store('published');
  db.prepare("UPDATE game_versions SET source = source || '\n// sneaky edit' WHERE game_id = ?").run(tampered);
  const blockGame = store('published', 'export default { contractVersion: 3, id: 1 };'); // from before frame games
  const badInfo = store('published', '<script type="application/json" id="game-info">{ "name": </script>');
  const good = store('published');

  const warnings = [];
  const registry = new GameRegistry();
  const result = await loadGeneratedGames(db, registry, { warn: (m) => warnings.push(m) });

  assert.deepEqual(result.loaded, [good]);
  const reasons = Object.fromEntries(result.skipped.map((s) => [s.id, s.reason]));
  assert.match(reasons[tampered], /doesn't match the code that was reviewed/);
  assert.match(reasons[blockGame], /no game info/);
  assert.match(reasons[badInfo], /isn't valid JSON/);
  assert.equal(warnings.length, 3);
});
