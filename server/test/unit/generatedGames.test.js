import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../../src/db/database.js';
import { createUser } from '../../src/db/users.js';
import {
  createGeneratedGame,
  saveGeneratedSource,
  setGeneratedGameStatus,
  markGenerationFailed,
  getGeneratedGame,
  listGeneratedGames,
  listLoadableGames,
  deleteGeneratedGame,
  sha256,
} from '../../src/db/generatedGames.js';
import { GameRegistry } from '../../src/games/registry.js';
import { loadGeneratedGames } from '../../src/games/generated.js';
import countGame from '../fixtures/countGame.js';

// AI-generated games stored in the database (plan §11, A3).

const COUNT_GAME_SOURCE = readFileSync(new URL('../fixtures/countGame.js', import.meta.url), 'utf8');

function setup() {
  const db = openDatabase(':memory:');
  const admin = createUser(db, 'admin', 'scrypt$x');
  const other = createUser(db, 'other', 'scrypt$x');
  /** Stores a game with code, in `status`. */
  const store = (status, source = COUNT_GAME_SOURCE, ownerUserId = admin.id) => {
    const game = createGeneratedGame(db, { ownerUserId, prompt: 'a tapping game', model: 'qwen3.8:27b' });
    saveGeneratedSource(db, game.id, { source, report: { ok: true }, name: 'Count to Three', description: 'Tap!', status });
    return game.id;
  };
  return { db, admin, other, store };
}

test('a game goes generating → review (with code, fingerprint and report) → playtest', () => {
  const { db, admin } = setup();
  const game = createGeneratedGame(db, { ownerUserId: admin.id, prompt: 'a tapping game', model: 'qwen3.8:27b', now: 5 });
  assert.match(game.id, /^g-[a-z2-9]{8}$/);
  assert.equal(game.status, 'generating');
  assert.equal(game.source, null);

  saveGeneratedSource(db, game.id, { source: 'code', report: { ok: true }, name: 'Tap', description: 'Tap it', now: 6 });
  const saved = getGeneratedGame(db, game.id);
  assert.equal(saved.status, 'review');
  assert.equal(saved.sourceSha256, sha256('code'));
  assert.deepEqual(saved.report, { ok: true });
  assert.equal(saved.updatedAt, 6);

  assert.equal(setGeneratedGameStatus(db, game.id, 'playtest'), true);
  assert.equal(getGeneratedGame(db, game.id).status, 'playtest');
  assert.throws(() => setGeneratedGameStatus(db, game.id, 'banana'), /unknown status/);
  assert.equal(setGeneratedGameStatus(db, 'g-nothere', 'playtest'), false);
});

test('a failed generation keeps the reason', () => {
  const { db, admin } = setup();
  const game = createGeneratedGame(db, { ownerUserId: admin.id, prompt: 'x' });
  markGenerationFailed(db, game.id, 'the model never produced passing code');
  assert.equal(getGeneratedGame(db, game.id).status, 'failed');
  assert.equal(getGeneratedGame(db, game.id).error, 'the model never produced passing code');
});

test('only playtest and published games with code are loadable', () => {
  const { db, store } = setup();
  const ids = Object.fromEntries(['review', 'playtest', 'published', 'rejected'].map((s) => [s, store(s)]));
  assert.deepEqual(listLoadableGames(db).map((g) => g.id).sort(), [ids.playtest, ids.published].sort());
  assert.equal(listGeneratedGames(db).length, 4);
  assert.equal(deleteGeneratedGame(db, ids.review), true);
  assert.equal(listGeneratedGames(db).length, 3);
});

test('deleting an account deletes its generated games', () => {
  const { db, other, store } = setup();
  store('published', COUNT_GAME_SOURCE, other.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(other.id);
  assert.deepEqual(listGeneratedGames(db), []);
});

// --- Who can see which game --------------------------------------------------------------

test('registry: official and published games are for everyone, playtest only for its owner', () => {
  const registry = new GameRegistry();
  registry.register(countGame);
  registry.register({ ...countGame, id: 'g-playtest' }, { source: 'generated', status: 'playtest', ownerUserId: 1 });
  registry.register({ ...countGame, id: 'g-published' }, { source: 'generated', status: 'published', ownerUserId: 1 });

  const ids = (viewer) => registry.list(viewer).map((g) => g.id);
  assert.deepEqual(ids({ userId: 1 }), ['count-game', 'g-playtest', 'g-published']);
  assert.deepEqual(ids({ userId: 2 }), ['count-game', 'g-published']);
  assert.deepEqual(ids({}), ['count-game', 'g-published']);

  assert.ok(registry.get('g-playtest', { userId: 1 }));
  assert.equal(registry.get('g-playtest', { userId: 2 }), undefined);
  assert.equal(registry.get('g-playtest'), undefined);

  const listed = registry.list({ userId: 1 });
  assert.equal(listed[0].source, 'official');
  assert.equal('status' in listed[0], false);
  assert.deepEqual([listed[1].source, listed[1].status], ['generated', 'playtest']);

  registry.setStatus('g-playtest', 'published');
  assert.ok(registry.get('g-playtest', { userId: 2 }), 'published now: everyone');
  assert.equal(registry.unregister('g-playtest'), true);
  assert.equal(registry.get('g-playtest', { userId: 1 }), undefined);
});

// --- Loading at startup -------------------------------------------------------------------

test('loadGeneratedGames: approved games load under their database id', async () => {
  const { db, admin, store } = setup();
  const playtestId = store('playtest');
  const publishedId = store('published');
  store('review'); // not approved yet: never loaded

  const registry = new GameRegistry();
  const result = await loadGeneratedGames(db, registry, { warn: () => {} });
  assert.deepEqual(result.loaded.sort(), [playtestId, publishedId].sort());
  assert.deepEqual(result.skipped, []);

  const game = registry.get(playtestId, { userId: admin.id });
  assert.equal(game.id, playtestId, 'runs as g-…, not as the "count-game" id its code declares');
  assert.equal(game.name, 'Count to Three');
  assert.equal(typeof game.createGame, 'function');
});

test('loadGeneratedGames: tampered or broken games are skipped with a warning, never stopping startup', async () => {
  const { db, store } = setup();
  const tampered = store('published');
  db.prepare("UPDATE generated_games SET source = source || '\n// sneaky edit' WHERE id = ?").run(tampered);
  const broken = store('published', 'export default { id: 1 };');
  const syntax = store('published', 'export default {');
  const good = store('published');

  const warnings = [];
  const registry = new GameRegistry();
  const result = await loadGeneratedGames(db, registry, { warn: (m) => warnings.push(m) });

  assert.deepEqual(result.loaded, [good]);
  const reasons = Object.fromEntries(result.skipped.map((s) => [s.id, s.reason]));
  assert.match(reasons[tampered], /doesn't match the code that was reviewed/);
  assert.match(reasons[broken], /does not follow the game contract/);
  assert.match(reasons[syntax], /SyntaxError|Unexpected end of input/);
  assert.equal(warnings.length, 3);
});
