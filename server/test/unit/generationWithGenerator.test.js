import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/database.js';
import { createUser, setAdmin } from '../../src/db/users.js';
import { gameStatus, createRemix, listBuildAttempts } from '../../src/db/generatedGames.js';
import { GameRegistry } from '../../src/games/registry.js';
import { GenerationService } from '../../src/generation/service.js';
import { realGenerator, fakeModel, staticOnly, withHeadings } from '../helpers/realGenerator.js';
import { TAP_SOURCE, renamedSource } from '../helpers/frameGames.js';
import { PLAN_HEADINGS } from '../../../generator/src/prompt.js';
import { DEFAULT_MODEL } from '../../../generator/src/models.js';

// The generation module with the REAL generator in place of the sandbox (its runJob, with a
// fake model and a fake checker): what the server sends is what the generator must accept,
// so a job the generator would refuse fails here, not only in a real sandbox run. These tests
// check what a maker sees (statuses, results, messages), never the job itself.

const IDEA = 'Everyone votes; the most popular answer wins';
const DESIGN = withHeadings('Majority Rules', undefined, (h) => (h === 'Rules' ? 'Everyone votes.' : `The ${h.toLowerCase()}.`));

function setup(model, check) {
  const db = openDatabase(':memory:');
  const admin = createUser(db, 'admin', 'scrypt$x');
  setAdmin(db, 'admin', true); // admins without their own key use the server's
  const { runGenerator, asked } = realGenerator({ model, check });
  const service = new GenerationService({ db, games: new GameRegistry(), enabled: true, runGenerator, log: () => {} });
  return { db, admin, service, asked };
}

/** A new game, designed and built: version 1 is ready. */
async function readyGame({ service, admin }) {
  const { id } = service.start({ ownerUserId: admin.id, idea: IDEA });
  await service.current;
  service.build({ id, version: 1 });
  await service.current;
  return id;
}

test("a new game's design reaches \"design ready\" with the model's design", async () => {
  const { service, admin } = setup({ design: DESIGN });
  const { id } = service.start({ ownerUserId: admin.id, idea: IDEA });
  await service.current;
  const [v1] = service.get(id).versions;
  assert.deepEqual([gameStatus(service.get(id)), v1.status, v1.error], ['design', 'design_ready', null]);
  assert.match(v1.design, /^# Majority Rules\n/);
  assert.match(v1.design, /Everyone votes\./);
});

test('an upload whose game has a short name and no description is checked and reaches its result (plan §57)', async () => {
  // The case a real sandbox run found: the generator refused the check for its short idea.
  const source = TAP_SOURCE.replace('"name": "Tap Test", "description": "First to 3 taps wins. Test-only."', '"name": "Zap", "description": ""');
  const { service, admin } = setup();
  const { id } = service.upload({ ownerUserId: admin.id, source });
  await service.current;
  const [v1] = service.get(id).versions;
  assert.deepEqual([v1.status, v1.error, v1.name, v1.description, v1.source], ['ready', null, 'Zap', '', source]);
  assert.equal(v1.report.ok, true);
});

test("a new game's approved design is built, and the build gets its review round (plan §47)", async () => {
  const { service, admin } = setup({ design: DESIGN });
  const { id } = service.start({ ownerUserId: admin.id, idea: IDEA });
  await service.current;
  service.build({ id, version: 1 });
  await service.current;
  const [v1] = service.get(id).versions;
  assert.deepEqual([gameStatus(service.get(id)), v1.status, v1.error, v1.name, v1.source], ['review', 'ready', null, 'Tap Test', TAP_SOURCE]);
  assert.deepEqual(v1.codeReview?.bugs, [], 'the review round ran, and found nothing');
});

test('a new draft of a design, with the feedback, reaches "design ready" with the new draft', async () => {
  const { service, admin } = setup({ design: DESIGN });
  const { id } = service.start({ ownerUserId: admin.id, idea: IDEA });
  await service.current;
  service.redesign({ id, version: 1, feedback: 'Make it 2 rounds' });
  await service.current;
  const [v1] = service.get(id).versions;
  assert.deepEqual([v1.status, v1.error], ['design_ready', null]);
  assert.deepEqual(v1.drafts.map((d) => [d.by, d.feedback ?? null]), [['ai', null], ['ai', 'Make it 2 rounds']]);
});

test("a build is written from the latest draft, the admin's own edit too, and built again from it after a failure", async () => {
  // A checker that fails every file until the test lets it pass.
  let failing = true;
  const bad = { rule: 'stuck', message: 'nothing happens after the first round' };
  const check = async (source) => (failing ? { ...(await staticOnly(source)), ok: false, problems: [bad] } : staticOnly(source));
  const { service, admin, asked } = setup({ design: DESIGN }, check);
  const { id } = service.start({ ownerUserId: admin.id, idea: IDEA });
  await service.current;
  service.editDesign({ id, version: 1, design: withHeadings('Majority Rules', undefined, (h) => (h === 'Rules' ? 'Two rounds, 30 s each.' : `The ${h.toLowerCase()}.`)) });
  service.build({ id, version: 1 });
  await service.current;
  assert.equal(service.get(id).versions[0].status, 'failed');
  const firstBuild = asked.filter((a) => a.kind === 'code');
  assert.ok(firstBuild.length > 0);
  assert.match(firstBuild[0].text, /30 s each/, "the admin's edit reached the AI");
  asked.length = 0;
  failing = false;
  service.build({ id, version: 1 });
  await service.current;
  assert.equal(service.get(id).versions[0].status, 'ready');
  assert.match(asked.find((a) => a.kind === 'code').text, /30 s each/, 'built again from the same design');
});

test("a game's model is the one the AI is asked with, for its design and its build", async () => {
  const { db, service, admin, asked } = setup({ design: DESIGN });
  const { id } = service.start({ ownerUserId: admin.id, idea: IDEA, model: DEFAULT_MODEL });
  await service.current;
  service.build({ id, version: 1 });
  await service.current;
  assert.equal(service.get(id).versions[0].status, 'ready');
  assert.deepEqual([...new Set(asked.map((a) => a.model))], [DEFAULT_MODEL]);
  assert.deepEqual([...new Set(asked.map((a) => a.kind))].sort(), ['code', 'critical_bugs', 'design']);
  // Its build attempts keep it too, with what the generator said about each call (the edit stats).
  const attempts = listBuildAttempts(db, id).get(1);
  assert.deepEqual(attempts.map((a) => [a.model, a.fix, a.noReply, a.editsApplied]), [[DEFAULT_MODEL, false, false, null]]);
});

test("an upload's new file is checked too; a file that fails its checks fails with its report", async () => {
  // A checker whose playtest gets stuck on a file marked so.
  const stuck = { rule: 'stuck', message: 'nothing happens after the first round' };
  const check = async (source) => (source.includes('<!-- stuck -->') ? { ...(await staticOnly(source)), ok: false, problems: [stuck] } : staticOnly(source));
  const { service, admin } = setup(undefined, check);
  const { id } = service.upload({ ownerUserId: admin.id, source: TAP_SOURCE });
  await service.current;
  const broken = `${TAP_SOURCE}<!-- stuck -->`;
  service.upload({ ownerUserId: admin.id, id, source: broken });
  await service.current;
  const [v1, v2] = service.get(id).versions;
  assert.equal(v1.status, 'ready');
  assert.deepEqual([v2.status, v2.kind, v2.basedOn, v2.source], ['failed', 'upload', 1, broken]);
  assert.deepEqual([v2.report?.ok, v2.report?.problems], [false, [stuck]]);
});

// --- Changes --------------------------------------------------------------------------------

const PLAN = withHeadings('Change: Two rounds', PLAN_HEADINGS, (h) => `What changes for the ${h.toLowerCase()}.`);

test("a change's plan reaches \"plan ready\", written from the game's file, its design and the request", async () => {
  const ctx = setup({ design: DESIGN, plan: PLAN });
  const id = await readyGame(ctx);
  ctx.service.requestChanges({ id, request: 'Make it 2 rounds please' });
  await ctx.service.current;
  const v2 = ctx.service.get(id).versions[1];
  assert.deepEqual([gameStatus(ctx.service.get(id)), v2.status, v2.error, v2.basedOn], ['design', 'design_ready', null, 1]);
  assert.match(v2.design, /^# Change: Two rounds\n/);
  const { text } = ctx.asked.at(-1);
  assert.match(text, /<change-request>\nMake it 2 rounds please/);
  assert.match(text, /# Majority Rules/, "the game's design");
  assert.match(text, /"name": "Tap Test"/, "the game's file");
});

test('a new draft of a plan, with the feedback, is written from the last draft and reaches "plan ready"', async () => {
  const ctx = setup({ design: DESIGN, plan: PLAN });
  const id = await readyGame(ctx);
  ctx.service.requestChanges({ id, request: 'Make it 2 rounds please' });
  await ctx.service.current;
  ctx.service.redesign({ id, version: 2, feedback: 'Keep the timer' });
  await ctx.service.current;
  const v2 = ctx.service.get(id).versions[1];
  assert.deepEqual([v2.status, v2.error], ['design_ready', null]);
  assert.deepEqual(v2.drafts.map((d) => [d.by, d.feedback ?? null]), [['ai', null], ['ai', 'Keep the timer']]);
  const { text } = ctx.asked.at(-1);
  assert.match(text, /Keep the timer/);
  assert.match(text, /# Change: Two rounds/, 'the last draft');
});

test('an approved plan is built: the change is ready, and the next change knows the requests since the design', async () => {
  const ctx = setup({ design: DESIGN, plan: PLAN, game: [TAP_SOURCE, renamedSource('Tap Twice')] });
  const id = await readyGame(ctx);
  ctx.service.requestChanges({ id, request: 'Make it 2 rounds please' });
  await ctx.service.current;
  ctx.service.build({ id, version: 2 });
  await ctx.service.current;
  const v2 = ctx.service.get(id).versions[1];
  assert.deepEqual([gameStatus(ctx.service.get(id)), v2.status, v2.error, v2.name, v2.design], ['review', 'ready', null, 'Tap Twice', PLAN]);
  assert.deepEqual(v2.codeReview?.bugs, [], 'the review round ran on the change too');
  const build = ctx.asked.findLast((a) => a.kind === 'code');
  assert.match(build.text, /The plan was approved/);
  assert.match(build.text, /# Change: Two rounds/);

  ctx.service.requestChanges({ id, request: 'Add a scoreboard please' });
  await ctx.service.current;
  const { text } = ctx.asked.at(-1);
  assert.match(text, /<earlier-changes>\n- Make it 2 rounds please\n<\/earlier-changes>/);
  assert.match(text, /"name": "Tap Twice"/, 'from the newest ready version');
  assert.match(text, /# Majority Rules/, "still the game's design, not the plan");

  // An explicit base: the history follows that version's line, not every version.
  ctx.service.discard({ id, version: 3 });
  ctx.service.requestChanges({ id, request: 'A different take on version 1', basedOn: 1 });
  await ctx.service.current;
  const other = ctx.asked.at(-1).text;
  assert.doesNotMatch(other, /<earlier-changes>/);
  assert.match(other, /"name": "Tap Test"/);
});

test('a small fix is built from the request alone, with no plan', async () => {
  const ctx = setup({ design: DESIGN, game: renamedSource('Tap Fixed') });
  const id = await readyGame(ctx);
  ctx.service.requestChanges({ id, request: 'Fix the typo in the title', skipDesign: true });
  await ctx.service.current;
  const v2 = ctx.service.get(id).versions[1];
  assert.deepEqual([v2.status, v2.error, v2.design, v2.name], ['ready', null, null, 'Tap Fixed']);
  const build = ctx.asked.findLast((a) => a.kind === 'code');
  assert.match(build.text, /Make this small change/);
  assert.match(build.text, /Fix the typo in the title/);
});

test('"Review again" runs a review round on the version it names, against its design and the changes since', async () => {
  const ctx = setup({ design: DESIGN });
  const id = await readyGame(ctx);
  ctx.service.requestChanges({ id, request: 'Fix the typo in the title', skipDesign: true });
  await ctx.service.current;
  const before = ctx.asked.length;
  ctx.service.reviewAgain({ id, basedOn: 2 });
  await ctx.service.current;
  const [, v2, v3] = ctx.service.get(id).versions;
  assert.deepEqual([v3.kind, v3.basedOn, v3.status, v3.error, v3.source], ['recheck', 2, 'ready', null, v2.source]);
  assert.deepEqual(v3.codeReview?.bugs, []);
  const asks = ctx.asked.slice(before);
  assert.deepEqual(asks.map((a) => a.kind), ['critical_bugs'], 'only the review: nothing to fix, nothing built');
  assert.match(asks[0].text, /Fix the typo in the title/);
  assert.match(asks[0].text, /# Majority Rules/);
});

test('a change to a game too big for the AI is refused with the size limit', async () => {
  const big = `${TAP_SOURCE}<!--${'x'.repeat(100 * 1024)}-->`;
  const ctx = setup();
  const { id } = ctx.service.upload({ ownerUserId: ctx.admin.id, source: big });
  await ctx.service.current;
  assert.equal(ctx.service.get(id).versions[0].status, 'ready');
  const refusal = { code: 'TOO_BIG_FOR_AI', message: 'The AI can only change game files up to 100 KB. Upload a changed file instead.' };
  assert.throws(() => ctx.service.requestChanges({ id, request: 'Make it blue please' }), refusal);
  assert.throws(() => ctx.service.reviewAgain({ id }), refusal);
  assert.equal(ctx.service.get(id).versions.length, 1, 'no version was added');
});

test('an uploaded file that failed its checks can be fixed by the AI as a change (plan §57)', async () => {
  const stuck = { rule: 'stuck', message: 'nothing happens after the first round' };
  const check = async (source) => (source.includes('<!-- stuck -->') ? { ...(await staticOnly(source)), ok: false, problems: [stuck] } : staticOnly(source));
  const ctx = setup({ game: renamedSource('Tap Unstuck') }, check);
  const broken = `${TAP_SOURCE}<!-- stuck -->`;
  const { id } = ctx.service.upload({ ownerUserId: ctx.admin.id, source: broken });
  await ctx.service.current;
  assert.equal(ctx.service.get(id).versions[0].status, 'failed');
  ctx.service.requestChanges({ id, request: 'Make the second round start', basedOn: 1, skipDesign: true });
  await ctx.service.current;
  const v2 = ctx.service.get(id).versions[1];
  assert.deepEqual([v2.status, v2.error, v2.basedOn, v2.name], ['ready', null, 1, 'Tap Unstuck']);
  const build = ctx.asked.findLast((a) => a.kind === 'code');
  assert.match(build.text, /<!-- stuck -->/, 'from the uploaded file');

  // "Review again" on it: with no design, the review reads the game's own description.
  ctx.service.reviewAgain({ id, basedOn: 2 });
  await ctx.service.current;
  const v3 = ctx.service.get(id).versions[2];
  assert.deepEqual([v3.kind, v3.status, v3.error], ['recheck', 'ready', null]);
  const review = ctx.asked.at(-1);
  assert.equal(review.kind, 'critical_bugs');
  assert.match(review.text, /Tap Test: First to 3 taps wins/);
});

// A remix (plan §45b): kim's copy of a game, its code built from the copy's design.
const COPY_DESIGN = withHeadings('Majority Rules', undefined, (h) => (h === 'Rules' ? 'Everyone votes alone.' : `The ${h.toLowerCase()}.`));
const TEAMS_DESIGN = withHeadings('Majority Teams', undefined, (h) => (h === 'Rules' ? 'Two teams vote.' : `The ${h.toLowerCase()}.`));
const TEAMS_SOURCE = `${TAP_SOURCE}<!-- teams -->\n`;
const WISH = 'Make it a team game: two teams vote';
const TEAMS_PLAN = withHeadings('Change: A shorter vote', PLAN_HEADINGS);

/**
 * A fake model that reads what it's asked: it writes the teams design only when asked with the
 * copy's design and what kim wants different, and the teams game only when asked to rewrite the
 * copy's code, from the copy's design, into the teams design; a change plan only when asked
 * against the teams design alone. Anything else gets replies the
 * tests can tell apart (a design called "Not asked right", the copy's own code).
 */
function remixModel() {
  const otherwise = fakeModel({ design: withHeadings('Not asked right') });
  return async (messages, opts) => {
    const asked = messages.map((m) => m.content).join('\n');
    const kind = opts?.responseFormat?.json_schema?.name ?? 'code';
    if (kind === 'design' && asked.includes('Everyone votes alone.') && asked.includes(WISH)) return fakeModel({ design: TEAMS_DESIGN })(messages, opts);
    const fromCopy = /<original-design>[^]*Everyone votes alone\.[^]*<\/original-design>/.test(asked);
    const toTeams = /<design>[^]*Two teams vote\.[^]*<\/design>/.test(asked);
    if (kind === 'code' && fromCopy && toTeams && asked.includes(TAP_SOURCE)) return fakeModel({ game: TEAMS_SOURCE })(messages, opts);
    if (kind === 'plan' && toTeams && !asked.includes('Everyone votes alone.')) return fakeModel({ plan: TEAMS_PLAN })(messages, opts);
    return otherwise(messages, opts);
  };
}

/** kim's remix: version 1 is the copy, ready, with the design its code was built from. */
function remixSetup() {
  const db = openDatabase(':memory:');
  const kim = createUser(db, 'kim', 'scrypt$x');
  setAdmin(db, 'kim', true);
  const { runGenerator } = realGenerator({ model: remixModel() });
  const service = new GenerationService({ db, games: new GameRegistry(), enabled: true, runGenerator, log: () => {} });
  const { id } = createRemix(db, {
    ownerUserId: kim.id,
    prompt: IDEA,
    remixOf: { id: 'g-original', version: 1, name: 'Majority Rules' },
    design: COPY_DESIGN,
    source: TAP_SOURCE,
    report: null,
    name: 'Tap Test',
    description: 'First to 3 taps wins. Test-only.',
  });
  return { service, id };
}

test('"Make it your own" reaches "design ready" with the remix\'s whole design, written from the copy\'s design and what should be different', async () => {
  const { service, id } = remixSetup();
  service.requestRemixDesign({ id, request: WISH });
  await service.current;
  const [, v2] = service.get(id).versions;
  assert.deepEqual([v2.kind, v2.status, v2.error, v2.design], ['remix', 'design_ready', null, TEAMS_DESIGN]);
});

test("a remix's approved design is built from the copy's code and the design that code was built from (plan §60), and reviewed", async () => {
  const { service, id } = remixSetup();
  service.requestRemixDesign({ id, request: WISH });
  await service.current;
  service.build({ id, version: 2 });
  await service.current;
  const [, v2] = service.get(id).versions;
  assert.deepEqual([v2.status, v2.error, v2.source], ['ready', null, TEAMS_SOURCE]);
  assert.deepEqual(v2.codeReview?.bugs, [], 'the review round ran, and found nothing');
});

test("after that, a change to the remix is planned against the remix's own design, not the copy's", async () => {
  const { service, id } = remixSetup();
  service.requestRemixDesign({ id, request: WISH });
  await service.current;
  service.build({ id, version: 2 });
  await service.current;
  service.requestChanges({ id, request: 'Make the vote 20 seconds', basedOn: 2 });
  await service.current;
  const [, , v3] = service.get(id).versions;
  assert.deepEqual([v3.status, v3.error, v3.design], ['design_ready', null, TEAMS_PLAN]);
});
