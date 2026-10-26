import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/database.js';
import { createUser, setAdmin } from '../../src/db/users.js';
import { gameStatus, createRemix } from '../../src/db/generatedGames.js';
import { GameRegistry } from '../../src/games/registry.js';
import { GenerationService } from '../../src/generation/service.js';
import { realGenerator, fakeModel, staticOnly, withHeadings } from '../helpers/realGenerator.js';
import { TAP_SOURCE } from '../helpers/frameGames.js';

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
  const { runGenerator } = realGenerator({ model, check });
  const service = new GenerationService({ db, games: new GameRegistry(), enabled: true, runGenerator, log: () => {} });
  return { admin, service };
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

// A remix (plan §45b): kim's copy of a game, its code built from the copy's design.
const COPY_DESIGN = withHeadings('Majority Rules', undefined, (h) => (h === 'Rules' ? 'Everyone votes alone.' : `The ${h.toLowerCase()}.`));
const TEAMS_DESIGN = withHeadings('Majority Teams', undefined, (h) => (h === 'Rules' ? 'Two teams vote.' : `The ${h.toLowerCase()}.`));
const TEAMS_SOURCE = `${TAP_SOURCE}<!-- teams -->\n`;
const WISH = 'Make it a team game: two teams vote';

/**
 * A fake model that reads what it's asked: it writes the teams design only when asked with the
 * copy's design and what kim wants different, and the teams game only when asked to rewrite the
 * copy's code, from the copy's design, into the teams design. Anything else gets replies the
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
