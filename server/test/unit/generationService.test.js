import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/database.js';
import { createUser } from '../../src/db/users.js';
import { createGeneratedGame, getGeneratedGame, gameStatus } from '../../src/db/generatedGames.js';
import { GameRegistry } from '../../src/games/registry.js';
import { GenerationService, MAX_QUEUED } from '../../src/generation/service.js';
import { renamedSource } from '../helpers/frameGames.js';

// The generation queue, versions and going live (plan §11 A5, §12e K6). A fake generator
// stands in for the OpenShell sandbox; each call waits until the test lets it finish.

const GOOD_SOURCE = renamedSource('Majority Rules');
const PASSED = { ok: true, model: 'qwen3.8:27b', source: GOOD_SOURCE, report: { ok: true, problems: [], game: { name: 'Majority Rules', description: 'Vote!' } }, attempts: [] };
const IDEA = 'Everyone votes; the most popular answer wins';
const CHANGED_SOURCE = renamedSource('Majority Rules 2');
const CHANGED = { ...PASSED, source: CHANGED_SOURCE, changelog: '- Renamed it', report: { ...PASSED.report, game: { name: 'Majority Rules 2', description: 'Vote!' } } };

/** A fake generator: each call stays "running" until finish(result) is called for it. */
function fakeGenerator() {
  const calls = [];
  const runGenerator = (job, { onStep }) =>
    new Promise((resolve) => {
      calls.push({ job, onStep, finish: resolve });
    });
  return { runGenerator, calls };
}

function setup({ enabled = true } = {}) {
  const db = openDatabase(':memory:');
  const admin = createUser(db, 'admin', 'scrypt$x');
  const games = new GameRegistry();
  const fake = fakeGenerator();
  const service = new GenerationService({ db, games, enabled, runGenerator: fake.runGenerator, log: () => {} });
  return { db, admin, games, service, ...fake };
}

const codeOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return 'no error';
};

test('starting checks the input and the switch', () => {
  const { service, admin } = setup();
  const start = (idea, model) => () => service.start({ ownerUserId: admin.id, idea, model });
  assert.equal(codeOf(start('too short')), 'INVALID_IDEA');
  assert.equal(codeOf(start('x'.repeat(1001))), 'INVALID_IDEA');
  assert.equal(codeOf(start({ evil: true })), 'INVALID_IDEA');
  assert.equal(codeOf(start(IDEA, 'gpt-5')), 'INVALID_MODEL');
  assert.equal(codeOf(start(IDEA, ['qwen3.8:27b'])), 'INVALID_MODEL');
  assert.equal(codeOf(start(IDEA, 'gpt-oss:120b')), 'INVALID_MODEL', 'dropped on 2026-10-14');

  const off = setup({ enabled: false });
  assert.equal(codeOf(() => off.service.start({ ownerUserId: off.admin.id, idea: IDEA })), 'GENERATION_DISABLED');
  assert.equal(off.service.info().enabled, false);
  assert.match(off.service.info().disabledReason, /GENERATION_ENABLED=1/);
});

test('on the iframe-games branch, the real sandbox generator is switched off until it makes frame games (F5)', () => {
  const db = openDatabase(':memory:');
  const admin = createUser(db, 'admin', 'scrypt$x');
  const service = new GenerationService({ db, games: new GameRegistry(), enabled: true, log: () => {} });
  assert.equal(service.info().enabled, false);
  assert.match(service.info().disabledReason, /frame games/);
  assert.equal(codeOf(() => service.start({ ownerUserId: admin.id, idea: IDEA })), 'GENERATION_DISABLED');
});

test('a job runs in the background, shows progress, and ends up as version 1, ready for review', async () => {
  const { service, admin, calls, db } = setup();
  const game = service.start({ ownerUserId: admin.id, idea: `  ${IDEA}  ` });
  assert.equal(gameStatus(game), 'generating');
  assert.equal(game.prompt, IDEA, 'trimmed');
  assert.equal(game.versions[0].model, 'qwen3.8:27b', 'default model');
  assert.deepEqual(calls[0].job, { idea: IDEA, model: 'qwen3.8:27b' }, 'a new game: no `change`');

  calls[0].onStep('attempt 1/4: asking qwen3.8:27b');
  assert.deepEqual(service.progress(game.id).steps.map((s) => s.text), ['attempt 1/4: asking qwen3.8:27b']);
  assert.equal(service.progress(game.id).queuePosition, 0);

  calls[0].finish(PASSED);
  await service.current;
  const saved = getGeneratedGame(db, game.id);
  assert.equal(gameStatus(saved), 'review');
  const [v1] = saved.versions;
  assert.deepEqual([v1.version, v1.status, v1.name, v1.request, v1.basedOn], [1, 'ready', 'Majority Rules', IDEA, null]);
  assert.equal(v1.source, GOOD_SOURCE);
  assert.equal(service.progress(game.id), null, 'no longer queued or running');
});

test('one job at a time, in order; the queue has a limit', async () => {
  const { service, admin, calls } = setup();
  const first = service.start({ ownerUserId: admin.id, idea: IDEA });
  const second = service.start({ ownerUserId: admin.id, idea: `${IDEA} again`, model: 'qwen3.8:27b' });
  assert.equal(calls.length, 1, 'the second waits');
  assert.equal(service.progress(second.id).queuePosition, 1);

  for (let i = 2; i < MAX_QUEUED; i++) service.start({ ownerUserId: admin.id, idea: IDEA });
  assert.equal(codeOf(() => service.start({ ownerUserId: admin.id, idea: IDEA })), 'QUEUE_FULL');

  calls[0].finish(PASSED);
  await service.current;
  assert.equal(calls.length, 2, 'the next one started');
  assert.equal(calls[1].job.model, 'qwen3.8:27b');
  assert.equal(service.progress(first.id), null);
  assert.equal(service.progress(second.id).queuePosition, 0);
});

test('failures are saved with the reason, and the last attempt if there was one', async () => {
  const { service, admin, calls, db } = setup();
  const a = service.start({ ownerUserId: admin.id, idea: IDEA });
  calls[0].finish({ ok: false, source: 'export default {}', report: { ok: false, problems: [{ message: 'bad' }] }, error: 'no passing game after 4 attempts' });
  await service.current;
  const failed = getGeneratedGame(db, a.id);
  assert.equal(gameStatus(failed), 'failed');
  assert.equal(failed.versions[0].error, 'no passing game after 4 attempts');
  assert.equal(failed.versions[0].source, 'export default {}');
  assert.equal(failed.versions[0].report.problems[0].message, 'bad');

  // A generator that throws (e.g. a bug) also ends as "failed", and the queue moves on.
  const throwing = new GenerationService({ db, games: new GameRegistry(), enabled: true, log: () => {}, runGenerator: async () => { throw new Error('boom'); } });
  const b = throwing.start({ ownerUserId: admin.id, idea: IDEA });
  await throwing.current;
  assert.equal(getGeneratedGame(db, b.id).versions[0].error, 'boom');
});

test('after a restart, versions that were cut off are marked failed', () => {
  const { db, admin, games } = setup();
  const stuck = createGeneratedGame(db, { ownerUserId: admin.id, prompt: IDEA });
  new GenerationService({ db, games, enabled: true, log: () => {} }).recoverInterrupted();
  assert.equal(gameStatus(getGeneratedGame(db, stuck.id)), 'failed');
  assert.match(getGeneratedGame(db, stuck.id).versions[0].error, /server restarted/);
});

/** A game whose version 1 finished generating and is waiting for review. */
async function reviewed(ctx, result = PASSED) {
  const game = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  ctx.calls.at(-1).finish(result);
  await ctx.service.current;
  return game.id;
}

/** Asks for a change and lets the fake generator answer with `result`. */
async function changed(ctx, id, request = 'Give it a new name please', result = CHANGED, basedOn) {
  ctx.service.requestChanges({ id, request, basedOn });
  ctx.calls.at(-1).finish(result);
  await ctx.service.current;
  return ctx.service.get(id).versions.at(-1);
}

test('playtest → publish, live in the game list; then a new version is playtested NEXT TO the published one', async () => {
  const ctx = setup();
  const { service, games, admin } = ctx;
  const id = await reviewed(ctx);
  assert.equal(games.get(id, { userId: admin.id }), undefined, 'not loaded before review');

  await service.playtest(id, 1);
  assert.equal(games.get(`${id}-v1`, { userId: admin.id }).name, 'Majority Rules', 'loaded for its owner, as "-v1"');
  assert.equal(games.get(`${id}-v1`, { userId: 99 }), undefined, 'not for anyone else');
  assert.equal(gameStatus(service.get(id)), 'playtest');

  await service.publish(id);
  assert.ok(games.get(id, { userId: 99 }), 'published: everyone, under the game id');
  assert.equal(games.get(`${id}-v1`, { userId: admin.id }), undefined, 'the playtest is over');
  assert.deepEqual([service.get(id).publishedVersion, service.get(id).playtestVersion], [1, null]);

  const v2 = await changed(ctx, id);
  assert.equal(v2.version, 2);
  await service.playtest(id, 2);
  assert.equal(games.get(id, { userId: 99 }).name, 'Majority Rules', 'other hosts keep v1');
  assert.equal(games.get(`${id}-v2`, { userId: admin.id }).name, 'Majority Rules 2', 'the owner can try v2');
  assert.deepEqual(
    games.list({ userId: admin.id }).filter((g) => g.id.startsWith(id)).map((g) => [g.id, g.status, g.version]),
    [
      [id, 'published', 1],
      [`${id}-v2`, 'playtest', 2],
    ],
  );

  await service.publish(id);
  assert.equal(games.get(id, { userId: 99 }).name, 'Majority Rules 2', 'v2 replaces v1 for everyone');
  assert.equal(games.get(`${id}-v2`, { userId: admin.id }), undefined);

  // Rolling back = playtesting the old version, then publishing it.
  await service.playtest(id, 1);
  await service.publish(id);
  assert.equal(games.get(id, { userId: 99 }).name, 'Majority Rules');
  assert.equal(service.get(id).publishedVersion, 1);
});

test('stopping a playtest and unpublishing take versions down', async () => {
  const ctx = setup();
  const { service, games, admin } = ctx;
  const id = await reviewed(ctx);
  await service.playtest(id, 1);
  await service.publish(id);
  await changed(ctx, id);
  await service.playtest(id, 2);

  service.takeDown(id, 'playtest');
  assert.equal(games.get(`${id}-v2`, { userId: admin.id }), undefined);
  assert.ok(games.get(id, { userId: 99 }), 'the published version stays');
  service.takeDown(id, 'published');
  assert.equal(games.get(id, { userId: admin.id }), undefined);
  assert.equal(gameStatus(service.get(id)), 'review', 'nothing live');
});

test('asking for changes: the model gets the base code and the earlier requests; the changelog is saved', async () => {
  const ctx = setup();
  const { service, calls } = ctx;
  const id = await reviewed(ctx);
  const v2 = await changed(ctx, id, '  Make the rounds shorter  ');
  assert.deepEqual(calls.at(-1).job, { idea: IDEA, model: 'qwen3.8:27b', change: { request: 'Make the rounds shorter', source: GOOD_SOURCE, earlierRequests: [] } });
  assert.deepEqual([v2.request, v2.basedOn, v2.changelog, v2.status], ['Make the rounds shorter', 1, '- Renamed it', 'ready']);

  await changed(ctx, id, 'Add a scoreboard after each round');
  assert.equal(calls.at(-1).job.change.source, CHANGED_SOURCE, 'by default, changes the newest ready version');
  assert.deepEqual(calls.at(-1).job.change.earlierRequests, ['Make the rounds shorter']);

  // An explicit base: the history follows that version's line, not every version.
  await changed(ctx, id, 'A different take on version 1', CHANGED, 1);
  assert.equal(calls.at(-1).job.change.source, GOOD_SOURCE);
  assert.deepEqual(calls.at(-1).job.change.earlierRequests, []);

  // While something is playtested, that's the default base.
  await service.playtest(id, 2);
  await changed(ctx, id, 'Change the playtest version');
  assert.equal(service.get(id).versions.at(-1).basedOn, 2);
});

test('asking for changes: refused while a version is being made, for bad requests, and on versions without passing code', async () => {
  const ctx = setup();
  const { service } = ctx;
  const id = await reviewed(ctx);
  const ask = (request, basedOn) => () => service.requestChanges({ id, request, basedOn });
  assert.equal(codeOf(ask('short')), 'INVALID_REQUEST');
  assert.equal(codeOf(ask({ evil: true })), 'INVALID_REQUEST');
  assert.equal(codeOf(ask('A perfectly fine request', 7)), 'NO_BASE_VERSION');
  assert.equal(codeOf(() => service.requestChanges({ id: 'g-nothere', request: 'A perfectly fine request' })), 'NOT_FOUND');

  service.requestChanges({ id, request: 'A perfectly fine request' });
  assert.equal(codeOf(ask('Another request meanwhile')), 'BUSY');
  ctx.calls.at(-1).finish({ ok: false, error: 'no passing game after 4 attempts' });
  await service.current;
  assert.equal(service.get(id).versions[1].status, 'failed');
  assert.equal(codeOf(ask('Build on the failed one', 2)), 'NO_BASE_VERSION');
  assert.equal(gameStatus(service.get(id)), 'failed', 'its newest version failed');
});

test('moves that make no sense are refused', async () => {
  const ctx = setup();
  const id = await reviewed(ctx);
  await assert.rejects(ctx.service.publish(id), { code: 'WRONG_STATUS' }, 'publishing needs a playtest first');
  await assert.rejects(ctx.service.playtest(id, 9), { code: 'NOT_FOUND' });
  await assert.rejects(ctx.service.playtest('g-nothere', 1), { code: 'NOT_FOUND' });
  await ctx.service.playtest(id, 1);
  await ctx.service.publish(id);
  await assert.rejects(ctx.service.playtest(id, 1), { code: 'WRONG_STATUS' }, 'already published');

  const running = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  await assert.rejects(ctx.service.playtest(running.id, 1), { code: 'WRONG_STATUS' });
});

test('going live re-checks the code: changed or broken code is not loaded, and a failed publish changes nothing', async () => {
  const ctx = setup();
  const edit = (id, version) =>
    ctx.db.prepare("UPDATE game_versions SET source = source || '\n// edited' WHERE game_id = ? AND version = ?").run(id, version);

  const tampered = await reviewed(ctx);
  edit(tampered, 1);
  await assert.rejects(ctx.service.playtest(tampered, 1), { code: 'CODE_CHANGED' });

  const broken = await reviewed(ctx, { ...PASSED, source: 'export default { id: 5 };' });
  await assert.rejects(ctx.service.playtest(broken, 1), { code: 'LOAD_FAILED' });
  assert.equal(gameStatus(ctx.service.get(broken)), 'review', 'unchanged when loading fails');

  // v1 published, v2 playtested, then v2's code is edited: publishing v2 fails, v1 stays.
  const id = await reviewed(ctx);
  await ctx.service.playtest(id, 1);
  await ctx.service.publish(id);
  await changed(ctx, id);
  await ctx.service.playtest(id, 2);
  edit(id, 2);
  await assert.rejects(ctx.service.publish(id), { code: 'CODE_CHANGED' });
  assert.equal(ctx.games.get(id, { userId: 99 }).name, 'Majority Rules', 'v1 still runs for everyone');
  assert.equal(ctx.service.get(id).publishedVersion, 1);
});

test('deleting: removes every live version and the database rows; a waiting job can be cancelled, a running one not', async () => {
  const ctx = setup();
  const id = await reviewed(ctx);
  await ctx.service.playtest(id, 1);
  await ctx.service.publish(id);
  await changed(ctx, id);
  await ctx.service.playtest(id, 2);
  ctx.service.remove(id);
  assert.equal(ctx.games.get(id, { userId: ctx.admin.id }), undefined);
  assert.equal(ctx.games.get(`${id}-v2`, { userId: ctx.admin.id }), undefined);
  assert.equal(codeOf(() => ctx.service.get(id)), 'NOT_FOUND');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM game_versions WHERE game_id = ?').get(id).n, 0);

  const running = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  const waiting = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  assert.equal(codeOf(() => ctx.service.remove(running.id)), 'WRONG_STATUS');
  ctx.service.remove(waiting.id);
  const before = ctx.calls.length;
  ctx.calls.at(-1).finish(PASSED);
  await ctx.service.current;
  assert.equal(ctx.calls.length, before, 'the cancelled job never ran');
});
