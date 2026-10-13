import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../../src/db/database.js';
import { createUser } from '../../src/db/users.js';
import { createGeneratedGame, getGeneratedGame } from '../../src/db/generatedGames.js';
import { GameRegistry } from '../../src/games/registry.js';
import { GenerationService, MAX_QUEUED } from '../../src/generation/service.js';

// The generation queue and approvals (plan §11, A5). A fake generator stands in for the
// OpenShell sandbox; each call waits until the test lets it finish.

const GOOD_SOURCE = readFileSync(new URL('../../src/games/majority-rules/index.js', import.meta.url), 'utf8');
const PASSED = { ok: true, model: 'gpt-oss:120b', source: GOOD_SOURCE, report: { ok: true, problems: [], game: { name: 'Majority Rules', description: 'Vote!' } }, attempts: [] };
const IDEA = 'Everyone votes; the most popular answer wins';

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
  assert.equal(codeOf(start(IDEA, ['gpt-oss:120b'])), 'INVALID_MODEL');

  const off = setup({ enabled: false });
  assert.equal(codeOf(() => off.service.start({ ownerUserId: off.admin.id, idea: IDEA })), 'GENERATION_DISABLED');
  assert.equal(off.service.info().enabled, false);
});

test('a job runs in the background, shows progress, and ends up ready for review', async () => {
  const { service, admin, calls, db } = setup();
  const game = service.start({ ownerUserId: admin.id, idea: `  ${IDEA}  ` });
  assert.equal(game.status, 'generating');
  assert.equal(game.prompt, IDEA, 'trimmed');
  assert.equal(game.model, 'gpt-oss:120b', 'default model');
  assert.deepEqual(calls[0].job, { idea: IDEA, model: 'gpt-oss:120b' });

  calls[0].onStep('attempt 1/4: asking gpt-oss:120b');
  assert.deepEqual(service.progress(game.id).steps.map((s) => s.text), ['attempt 1/4: asking gpt-oss:120b']);
  assert.equal(service.progress(game.id).queuePosition, 0);

  calls[0].finish(PASSED);
  await service.current;
  const saved = getGeneratedGame(db, game.id);
  assert.equal(saved.status, 'review');
  assert.equal(saved.name, 'Majority Rules');
  assert.equal(saved.source, GOOD_SOURCE);
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
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'no passing game after 4 attempts');
  assert.equal(failed.source, 'export default {}');
  assert.equal(failed.report.problems[0].message, 'bad');

  // A generator that throws (e.g. a bug) also ends as "failed", and the queue moves on.
  const throwing = new GenerationService({ db, games: new GameRegistry(), enabled: true, log: () => {}, runGenerator: async () => { throw new Error('boom'); } });
  const b = throwing.start({ ownerUserId: admin.id, idea: IDEA });
  await throwing.current;
  assert.equal(getGeneratedGame(db, b.id).error, 'boom');
});

test('after a restart, jobs that were cut off are marked failed', () => {
  const { db, admin, games } = setup();
  const stuck = createGeneratedGame(db, { ownerUserId: admin.id, prompt: IDEA });
  new GenerationService({ db, games, enabled: true, log: () => {} }).recoverInterrupted();
  assert.equal(getGeneratedGame(db, stuck.id).status, 'failed');
  assert.match(getGeneratedGame(db, stuck.id).error, /server restarted/);
});

/** A game that finished generating and is waiting for review. */
async function reviewed(ctx, result = PASSED) {
  const game = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  ctx.calls.at(-1).finish(result);
  await ctx.service.current;
  return game.id;
}

test('review → playtest → published → playtest → rejected, live in the game list', async () => {
  const ctx = setup();
  const { service, games, admin } = ctx;
  const id = await reviewed(ctx);
  assert.equal(games.get(id, { userId: admin.id }), undefined, 'not loaded before review');

  await service.act(id, 'playtest');
  assert.equal(games.get(id, { userId: admin.id }).name, 'Majority Rules', 'loaded for its owner');
  assert.equal(games.get(id, { userId: 99 }), undefined, 'not for anyone else');

  await service.act(id, 'publish');
  assert.ok(games.get(id, { userId: 99 }), 'published: everyone');
  assert.equal(service.get(id).status, 'published');

  await service.act(id, 'playtest');
  assert.equal(games.get(id, { userId: 99 }), undefined, 'back to playtest');

  await service.act(id, 'reject');
  assert.equal(games.get(id, { userId: admin.id }), undefined, 'rejected: gone');
  await service.act(id, 'playtest');
  assert.ok(games.get(id, { userId: admin.id }), 'a rejected game can be given another chance');
});

test('moves that make no sense are refused', async () => {
  const ctx = setup();
  const id = await reviewed(ctx);
  await assert.rejects(ctx.service.act(id, 'publish'), { code: 'WRONG_STATUS' }, 'review → published skips playtesting');
  await assert.rejects(ctx.service.act(id, 'explode'), { code: 'NOT_FOUND' });
  await assert.rejects(ctx.service.act('g-nothere', 'playtest'), { code: 'NOT_FOUND' });

  const running = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  await assert.rejects(ctx.service.act(running.id, 'playtest'), { code: 'WRONG_STATUS' });
});

test('playtesting re-checks the code: changed or broken code is not loaded', async () => {
  const ctx = setup();
  const changed = await reviewed(ctx);
  ctx.db.prepare("UPDATE generated_games SET source = source || '\n// edited' WHERE id = ?").run(changed);
  await assert.rejects(ctx.service.act(changed, 'playtest'), { code: 'CODE_CHANGED' });

  const broken = await reviewed(ctx, { ...PASSED, source: 'export default { id: 5 };' });
  await assert.rejects(ctx.service.act(broken, 'playtest'), { code: 'LOAD_FAILED' });
  assert.equal(ctx.service.get(broken).status, 'review', 'status unchanged when loading fails');
});

test('deleting: removes it from the list and the database; a waiting job can be cancelled, a running one not', async () => {
  const ctx = setup();
  const id = await reviewed(ctx);
  await ctx.service.act(id, 'playtest');
  ctx.service.remove(id);
  assert.equal(ctx.games.get(id, { userId: ctx.admin.id }), undefined);
  assert.equal(codeOf(() => ctx.service.get(id)), 'NOT_FOUND');

  const running = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  const waiting = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  assert.equal(codeOf(() => ctx.service.remove(running.id)), 'WRONG_STATUS');
  ctx.service.remove(waiting.id);
  ctx.calls.at(-1).finish(PASSED);
  await ctx.service.current;
  assert.equal(ctx.calls.length, 2, 'the cancelled job never ran (1 earlier + the running one)');
});
