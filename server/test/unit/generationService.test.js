import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/database.js';
import { createUser, setAdmin } from '../../src/db/users.js';
import { createGeneratedGame, getGeneratedGame, gameStatus, saveDraft, startRedraft, listBuildAttempts } from '../../src/db/generatedGames.js';
import { GameRegistry } from '../../src/games/registry.js';
import { GenerationService, MAX_WAITING, RECHECK_REQUEST } from '../../src/generation/service.js';
import { renamedSource } from '../helpers/frameGames.js';

// The generation queue, designs, versions and going live (plan §11 A5, §12e K6, §13i F5).
// A fake generator stands in for the OpenShell sandbox; each call waits until the test lets
// it finish. Every version is designed first (a design job), then built (a build job).

const GOOD_SOURCE = renamedSource('Majority Rules');
const PASSED = { ok: true, model: 'qwen3.8:27b', source: GOOD_SOURCE, report: { ok: true, problems: [], game: { name: 'Majority Rules', description: 'Vote!' } }, attempts: [] };
const IDEA = 'Everyone votes; the most popular answer wins';
const CHANGED_SOURCE = renamedSource('Majority Rules 2');
const CHANGED = { ...PASSED, source: CHANGED_SOURCE, changelog: '- Renamed it', report: { ...PASSED.report, game: { name: 'Majority Rules 2', description: 'Vote!' } } };
const DESIGN = '# Majority Rules\n## Rules\nEveryone votes.\n';
const DESIGNED = { ok: true, model: 'qwen3.8:27b', design: DESIGN, attempts: [] };
const PLAN = '# Change: rename\n## What changes\n- The name\n';
const PLANNED = { ...DESIGNED, design: PLAN };

/** A fake generator: each call stays "running" until finish(result) is called for it. */
function fakeGenerator() {
  const calls = [];
  const runGenerator = (job, { onStep }) =>
    new Promise((resolve) => {
      calls.push({ job, onStep, finish: resolve });
    });
  return { runGenerator, calls };
}

function setup({ enabled = true, maxRunning } = {}) {
  const db = openDatabase(':memory:');
  const admin = createUser(db, 'admin', 'scrypt$x');
  setAdmin(db, 'admin', true); // admins without their own key use the server's
  const games = new GameRegistry();
  const fake = fakeGenerator();
  const service = new GenerationService({ db, games, enabled, runGenerator: fake.runGenerator, log: () => {}, maxRunning });
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
  assert.equal(codeOf(start(IDEA, 'gpt-oss:20b')), 'INVALID_MODEL', 'not on the list');

  const off = setup({ enabled: false });
  assert.equal(codeOf(() => off.service.start({ ownerUserId: off.admin.id, idea: IDEA })), 'GENERATION_DISABLED');
  assert.equal(off.service.info().enabled, false);
  assert.match(off.service.info().disabledReason, /GENERATION_ENABLED=1/);
});

test('the real sandbox generator is on (frame games since F5)', () => {
  const db = openDatabase(':memory:');
  const service = new GenerationService({ db, games: new GameRegistry(), enabled: true, log: () => {} });
  assert.equal(service.info().enabled, true);
  assert.equal(service.info().disabledReason, null);
});

test('a new game: its design is written first, then built when the admin says so', async () => {
  const { service, admin, calls, db } = setup();
  const game = service.start({ ownerUserId: admin.id, idea: `  ${IDEA}  ` });
  assert.equal(gameStatus(game), 'designing');
  assert.equal(game.prompt, IDEA, 'trimmed');
  assert.equal(game.versions[0].model, 'qwen3.8:27b', 'default model');
  assert.deepEqual(calls[0].job, { step: 'design', idea: IDEA, model: 'qwen3.8:27b' });

  calls[0].onStep('design: asking qwen3.8:27b');
  calls[0].onStep('design: asking qwen3.8:27b (thinking 400 tokens, writing 0)', { replace: true });
  calls[0].onStep('design: asking qwen3.8:27b (thinking 900 tokens, writing 120)', { replace: true });
  assert.deepEqual(service.progress(game.id).steps.map((s) => s.text), ['design: asking qwen3.8:27b (thinking 900 tokens, writing 120)'], 'progress updates the step');
  assert.equal(service.progress(game.id).queuePosition, 0);

  calls[0].finish(DESIGNED);
  await service.current;
  let saved = getGeneratedGame(db, game.id);
  assert.equal(gameStatus(saved), 'design', 'waiting for the admin');
  assert.deepEqual([saved.versions[0].status, saved.versions[0].design], ['design_ready', DESIGN]);
  assert.deepEqual(saved.versions[0].drafts.map((d) => [d.text, d.by]), [[DESIGN, 'ai']]);
  assert.equal(calls.length, 1, 'nothing is built until the admin says so');

  service.build({ id: game.id, version: 1 });
  assert.equal(gameStatus(service.get(game.id)), 'generating');
  assert.deepEqual(calls[1].job, { step: 'build', idea: IDEA, model: 'qwen3.8:27b', design: DESIGN, review: true });
  calls[1].finish(PASSED);
  await service.current;
  saved = getGeneratedGame(db, game.id);
  assert.equal(gameStatus(saved), 'review');
  const [v1] = saved.versions;
  assert.deepEqual([v1.version, v1.status, v1.name, v1.request, v1.basedOn, v1.design], [1, 'ready', 'Majority Rules', IDEA, null, DESIGN]);
  assert.equal(v1.source, GOOD_SOURCE);
  assert.equal(service.progress(game.id), null, 'no longer queued or running');
});

test('designs: new drafts with feedback, the admin\'s own edits, and what is refused', async () => {
  const { service, admin, calls } = setup();
  const { id } = service.start({ ownerUserId: admin.id, idea: IDEA });
  const v = { id, version: 1 };
  assert.equal(codeOf(() => service.build(v)), 'BUSY', 'not while the design is being written');
  calls[0].finish(DESIGNED);
  await service.current;

  // A new draft: the job carries the last draft and the feedback.
  assert.equal(codeOf(() => service.redesign({ ...v, feedback: 'no' })), 'INVALID_FEEDBACK');
  service.redesign({ ...v, feedback: '  Make it 2 rounds  ' });
  assert.equal(gameStatus(service.get(id)), 'designing');
  assert.deepEqual(calls[1].job.redraft, { draft: DESIGN, feedback: 'Make it 2 rounds' });
  calls[1].finish({ ...DESIGNED, design: '# Majority Rules\n## Rules\nTwo rounds.\n' });
  await service.current;
  let v1 = service.get(id).versions[0];
  assert.deepEqual(v1.drafts.map((d) => [d.by, d.feedback ?? null]), [['ai', null], ['ai', 'Make it 2 rounds']]);
  assert.match(v1.design, /Two rounds/);

  // A failed new draft keeps the last one, and says why.
  service.redesign({ ...v, feedback: 'Make it 3 rounds' });
  calls[2].finish({ ok: false, error: 'model call failed' });
  await service.current;
  v1 = service.get(id).versions[0];
  assert.deepEqual([v1.status, v1.error, v1.drafts.length], ['design_ready', 'model call failed', 2]);
  assert.match(v1.design, /Two rounds/);

  // The admin's own edit: a new draft, right away, no job.
  assert.equal(codeOf(() => service.editDesign({ ...v, design: 'too short' })), 'INVALID_DESIGN');
  service.editDesign({ ...v, design: '# Majority Rules\n## Rules\nTwo rounds, 30 s each.' });
  v1 = service.get(id).versions[0];
  assert.deepEqual([v1.drafts.at(-1).by, v1.design, v1.error], ['admin', '# Majority Rules\n## Rules\nTwo rounds, 30 s each.\n', null]);
  assert.equal(calls.length, 3);
  service.editDesign({ ...v, design: v1.design });
  assert.equal(service.get(id).versions[0].drafts.length, 3, 'an unchanged edit adds no draft');

  // Building uses the latest draft. A failed build keeps the design: change it, or build again.
  service.build(v);
  assert.match(calls[3].job.design, /30 s each/);
  calls[3].finish({ ok: false, source: null, report: null, error: 'no passing game after 4 attempts' });
  await service.current;
  assert.equal(service.get(id).versions[0].status, 'failed');
  service.build(v);
  assert.match(calls[4].job.design, /30 s each/, 'built again from the same design');
  calls[4].finish(PASSED);
  await service.current;
  assert.equal(codeOf(() => service.redesign({ ...v, feedback: 'Too late now' })), 'WRONG_STATUS', 'built and passed');
  assert.equal(codeOf(() => service.build({ id, version: 7 })), 'NOT_FOUND');
});

test('one job at a time, in order; one per person; the queue has a limit', async () => {
  const { service, admin, calls, db } = setup();
  /** Another admin, so their jobs can wait in the same queue. */
  const person = (name) => {
    const user = createUser(db, name, 'scrypt$x');
    setAdmin(db, name, true);
    return user.id;
  };
  const first = service.start({ ownerUserId: admin.id, idea: IDEA });
  assert.equal(codeOf(() => service.start({ ownerUserId: admin.id, idea: IDEA })), 'ALREADY_RUNNING', 'one job per person (plan §15)');
  const second = service.start({ ownerUserId: person('second'), idea: `${IDEA} again`, model: 'qwen3.8:27b' });
  assert.equal(calls.length, 1, 'the second waits');
  assert.equal(service.progress(second.id).queuePosition, 1);

  for (let i = 2; i <= MAX_WAITING; i++) service.start({ ownerUserId: person(`p${i}`), idea: IDEA });
  assert.equal(codeOf(() => service.start({ ownerUserId: person('late'), idea: IDEA })), 'QUEUE_FULL');

  calls[0].finish(DESIGNED);
  await service.current;
  assert.equal(calls.length, 2, 'the next one started');
  assert.equal(calls[1].job.model, 'qwen3.8:27b');
  assert.equal(service.progress(first.id), null);
  assert.equal(service.progress(second.id).queuePosition, 0);
});

test('with maxRunning 2, two jobs run at once; the third waits for a free place, then starts (plan §28)', async () => {
  const { service, db, calls } = setup({ maxRunning: 2 });
  const person = (name) => {
    const user = createUser(db, name, 'scrypt$x');
    setAdmin(db, name, true);
    return user.id;
  };
  const a = service.start({ ownerUserId: person('ana'), idea: IDEA });
  const b = service.start({ ownerUserId: person('ben'), idea: IDEA });
  const c = service.start({ ownerUserId: person('cy'), idea: IDEA });
  assert.equal(calls.length, 2, 'two run at the same time');
  assert.equal(service.progress(a.id).queuePosition, 0);
  assert.equal(service.progress(b.id).queuePosition, 0);
  assert.equal(service.progress(c.id).queuePosition, 1);

  // The queue limit counts the waiting jobs, not the running ones.
  for (let i = 2; i <= MAX_WAITING; i++) service.start({ ownerUserId: person(`p${i}`), idea: IDEA });
  assert.equal(codeOf(() => service.start({ ownerUserId: person('late'), idea: IDEA })), 'QUEUE_FULL');

  calls[1].finish(DESIGNED); // the second finishes first
  await new Promise((resolve) => setImmediate(resolve)); // (service.current would wait for the first too)
  assert.equal(calls.length, 3, 'the third started in the free place');
  assert.equal(service.progress(c.id).queuePosition, 0);
  assert.equal(service.progress(a.id).queuePosition, 0, 'the first is still running');
  assert.equal(service.progress(b.id), null);
});

test('failures are saved with the reason, and the last attempt if there was one', async () => {
  const { service, admin, calls, db } = setup();
  const a = service.start({ ownerUserId: admin.id, idea: IDEA });
  calls[0].finish(DESIGNED);
  await service.current;
  service.build({ id: a.id, version: 1 });
  calls[1].finish({ ok: false, source: 'export default {}', report: { ok: false, problems: [{ message: 'bad' }] }, error: 'no passing game after 4 attempts' });
  await service.current;
  const failed = getGeneratedGame(db, a.id);
  assert.equal(gameStatus(failed), 'failed');
  assert.equal(failed.versions[0].error, 'no passing game after 4 attempts');
  assert.equal(failed.versions[0].source, 'export default {}');
  assert.equal(failed.versions[0].report.problems[0].message, 'bad');
  assert.equal(failed.versions[0].design, DESIGN, 'the design stays');

  // A design that fails with no earlier draft: the version has failed.
  const c = service.start({ ownerUserId: admin.id, idea: IDEA });
  calls[2].finish({ ok: false, error: 'the model wrote no design' });
  await service.current;
  assert.deepEqual([getGeneratedGame(db, c.id).versions[0].status, getGeneratedGame(db, c.id).versions[0].error], ['failed', 'the model wrote no design']);

  // A generator that throws (e.g. a bug) also ends as "failed", and the queue moves on.
  const throwing = new GenerationService({ db, games: new GameRegistry(), enabled: true, log: () => {}, runGenerator: async () => { throw new Error('boom'); } });
  const b = throwing.start({ ownerUserId: admin.id, idea: IDEA });
  await throwing.current;
  assert.equal(getGeneratedGame(db, b.id).versions[0].error, 'boom');
});

test('after a restart, versions that were cut off are marked failed (a new draft goes back to the last one)', () => {
  const { db, admin, games } = setup();
  const stuck = createGeneratedGame(db, { ownerUserId: admin.id, prompt: IDEA });
  const building = createGeneratedGame(db, { ownerUserId: admin.id, prompt: IDEA, status: 'generating' });
  const redrafting = createGeneratedGame(db, { ownerUserId: admin.id, prompt: IDEA });
  saveDraft(db, redrafting.id, 1, { text: DESIGN, by: 'ai' });
  startRedraft(db, redrafting.id, 1, 'Shorter please');
  new GenerationService({ db, games, enabled: true, log: () => {} }).recoverInterrupted();
  assert.equal(gameStatus(getGeneratedGame(db, stuck.id)), 'failed');
  assert.match(getGeneratedGame(db, stuck.id).versions[0].error, /server restarted/);
  assert.equal(gameStatus(getGeneratedGame(db, building.id)), 'failed');
  const back = getGeneratedGame(db, redrafting.id).versions[0];
  assert.deepEqual([back.status, back.design, back.designFeedback], ['design_ready', DESIGN, null]);
  assert.match(back.error, /server restarted/);
});

/** Lets the fake generator answer the design job, then "Build it" with `result`. */
async function designAndBuild(ctx, id, version, design, result) {
  ctx.calls.at(-1).finish(design);
  await ctx.service.current;
  ctx.service.build({ id, version });
  ctx.calls.at(-1).finish(result);
  await ctx.service.current;
}

/** A game whose version 1 was designed and built, and is waiting for review. */
async function reviewed(ctx, result = PASSED) {
  const game = ctx.service.start({ ownerUserId: ctx.admin.id, idea: IDEA });
  await designAndBuild(ctx, game.id, 1, DESIGNED, result);
  return game.id;
}

/** Asks for a change: its plan, then the build answered with `result`. */
async function changed(ctx, id, request = 'Give it a new name please', result = CHANGED, basedOn) {
  ctx.service.requestChanges({ id, request, basedOn });
  await designAndBuild(ctx, id, ctx.service.get(id).versions.at(-1).version, PLANNED, result);
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
  // The plan job, then the build job with the approved plan. Both see the game's design.
  const change = { request: 'Make the rounds shorter', source: GOOD_SOURCE, design: DESIGN, earlierRequests: [] };
  assert.deepEqual(calls.at(-2).job, { step: 'design', idea: IDEA, model: 'qwen3.8:27b', change });
  assert.deepEqual(calls.at(-1).job, { step: 'build', idea: IDEA, model: 'qwen3.8:27b', change: { ...change, plan: PLAN }, review: true });
  assert.deepEqual([v2.request, v2.basedOn, v2.changelog, v2.status, v2.design], ['Make the rounds shorter', 1, '- Renamed it', 'ready', PLAN]);

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
  // Longer than an idea may be (a change can list several fixes), up to 4000 characters.
  assert.equal(codeOf(ask('x'.repeat(4001))), 'INVALID_REQUEST');
  assert.equal(service.info().maxRequestLength, 4000);
  assert.equal(codeOf(ask('A perfectly fine request', 7)), 'NO_BASE_VERSION');
  assert.equal(codeOf(() => service.requestChanges({ id: 'g-nothere', request: 'A perfectly fine request' })), 'NOT_FOUND');

  service.requestChanges({ id, request: 'A perfectly fine request' });
  assert.equal(codeOf(ask('Another request meanwhile')), 'BUSY');
  ctx.calls.at(-1).finish(PLANNED);
  await service.current;
  assert.match(codeOf(ask('Another request meanwhile')), /BUSY/, 'a plan waiting for you counts too');
  service.build({ id, version: 2 });
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
  createUser(ctx.db, 'other', 'scrypt$x');
  setAdmin(ctx.db, 'other', true);
  const waiting = ctx.service.start({ ownerUserId: ctx.admin.id + 1, idea: IDEA }); // one job per person
  assert.equal(codeOf(() => ctx.service.remove(running.id)), 'WRONG_STATUS');
  ctx.service.remove(waiting.id);
  const before = ctx.calls.length;
  ctx.calls.at(-1).finish(PASSED);
  await ctx.service.current;
  assert.equal(ctx.calls.length, before, 'the cancelled job never ran');
});

test('small fixes skip the plan; the newest version can be discarded while it has no passing code', async () => {
  const ctx = setup();
  const { service, calls } = ctx;
  const id = await reviewed(ctx);
  service.requestChanges({ id, request: 'Fix the typo in the title', skipDesign: true });
  assert.equal(service.get(id).versions[1].status, 'generating');
  assert.deepEqual(calls.at(-1).job.change.plan, null, 'built from the request alone');
  calls.at(-1).finish(CHANGED);
  await service.current;
  assert.equal(service.get(id).versions[1].status, 'ready');

  service.requestChanges({ id, request: 'Something we will not want' });
  calls.at(-1).finish(PLANNED);
  await service.current;
  assert.equal(codeOf(() => service.discard({ id, version: 2 })), 'WRONG_STATUS', 'only the newest');
  assert.equal(codeOf(() => service.discard({ id, version: 1 })), 'WRONG_STATUS', 'never version 1');
  service.discard({ id, version: 3 });
  assert.deepEqual(service.get(id).versions.map((v) => v.version), [1, 2]);
  assert.equal(gameStatus(service.get(id)), 'review');
  service.requestChanges({ id, request: 'Now something else' }); // no longer blocked
  assert.equal(service.get(id).versions.at(-1).version, 3);
});

test('every build attempt is kept, passing or not, as one build per "Build it" (plan §13n)', async () => {
  const { service, admin, calls, db } = setup();
  const { id } = service.start({ ownerUserId: admin.id, idea: IDEA });
  calls[0].finish(DESIGNED);
  await service.current;
  service.build({ id, version: 1 });
  const failedAttempt = { attempt: 1, ok: false, source: 'bad', report: { ok: false, problems: ['x'] }, seconds: 30, usage: null };
  calls[1].finish({ ok: false, error: 'no passing game after 1 attempts', attempts: [failedAttempt] });
  await service.current;
  service.build({ id, version: 1 });
  calls[2].finish({ ...PASSED, attempts: [failedAttempt, { attempt: 2, ok: true, source: GOOD_SOURCE, report: PASSED.report, seconds: 40, usage: null }] });
  await service.current;
  const attempts = listBuildAttempts(db, id).get(1);
  assert.deepEqual(attempts.map((a) => [a.build, a.attempt, a.ok]), [[1, 1, false], [2, 1, false], [2, 2, true]]);
});

test('the code review (plan §47): every build asks for one, and what it found is kept with the version', async () => {
  const ctx = setup();
  const codeReview = { score: { points: 30, of: 40 }, bugs: [{ severity: 'crash', what: 'scores is not defined', fixed: true }], missing: [], fix: { ok: true, changelog: '- Defined scores' } };
  const id = await reviewed(ctx, { ...PASSED, review: codeReview });
  assert.equal(ctx.calls.at(-1).job.review, true);
  assert.deepEqual(ctx.service.get(id).versions[0].codeReview, codeReview);
  // A review that couldn't finish is kept too: the creator sees why.
  const other = await reviewed(ctx, { ...PASSED, review: { error: 'no review: the model wrote no review' } });
  assert.deepEqual(ctx.service.get(other).versions[0].codeReview, { error: 'no review: the model wrote no review' });
});

test('"Review again" (plan §47): the next version is a code review round on the one it names', async () => {
  const ctx = setup();
  const { service, calls } = ctx;
  const id = await reviewed(ctx);
  await changed(ctx, id);

  // Nothing to fix: the same code, its report carried over, and the new review.
  const look = { score: { points: 1, of: 1 }, bugs: [{ severity: 'spoils', what: 'the timer never turns red', fixed: false }], missing: [], fix: null };
  service.reviewAgain({ id, basedOn: 2 });
  const job = calls.at(-1).job;
  assert.deepEqual(job, {
    step: 'recheck',
    idea: IDEA,
    model: 'qwen3.8:27b',
    change: { request: RECHECK_REQUEST, source: CHANGED_SOURCE, design: DESIGN, earlierRequests: ['Give it a new name please'], plan: null },
  });
  calls.at(-1).finish({ ok: true, model: 'qwen3.8:27b', source: CHANGED_SOURCE, report: null, changelog: null, attempts: [], review: look });
  await service.current;
  const v3 = service.get(id).versions.at(-1);
  assert.deepEqual([v3.kind, v3.basedOn, v3.status, v3.source, v3.name, v3.codeReview], ['recheck', 2, 'ready', CHANGED_SOURCE, 'Majority Rules 2', look]);
  assert.deepEqual(v3.report, service.get(id).versions[1].report);

  // A fix: the new code, its own report and the fix's list of changes.
  service.reviewAgain({ id, basedOn: 3 });
  calls.at(-1).finish({ ...CHANGED, source: renamedSource('Majority Rules 3'), changelog: '- Fixed the crash', review: { ...look, fix: { ok: true, changelog: '- Fixed the crash' } } });
  await service.current;
  const v4 = service.get(id).versions.at(-1);
  assert.deepEqual([v4.kind, v4.changelog, v4.source], ['recheck', '- Fixed the crash', renamedSource('Majority Rules 3')]);

  // Like a change: not while another version is being made, and only on a version that passed.
  service.reviewAgain({ id });
  assert.throws(() => service.reviewAgain({ id }), /already being made/);
});