import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionKind, kindRules, madeBy } from '../../src/generation/versionKind.js';

// What a version of an AI-made or uploaded game is, and what follows from it (plan §60): every
// kind × status the site has, as a table. The callers (the service, the sandbox, the pages) only
// read these answers.

/** A version with only what the table varies. */
const v = (fields) => ({ version: 1, basedOn: null, kind: null, status: 'ready', design: null, model: 'qwen3.8:27b', ...fields });

const CASES = [
  // [what, version, step, needsAi, designKind, track]
  ['a new game, being designed', v({ status: 'designing' }), 'design', true, 'whole', ['new', 1, 'working']],
  ['a new game, its design waiting', v({ status: 'design_ready', design: '# D' }), null, false, 'whole', ['new', 1, 'yours']],
  ['a new game, being built', v({ status: 'generating', design: '# D' }), 'build', true, 'whole', ['new', 2, 'working']],
  ['a new game, the design failed', v({ status: 'failed' }), null, false, 'whole', ['new', 1, 'failed']],
  ['a new game, the build failed', v({ status: 'failed', design: '# D' }), null, false, 'whole', ['new', 2, 'failed']],
  ['a new game, ready', v({ design: '# D' }), null, false, 'whole', ['new', 3, 'yours']],
  ['a change, its plan being written', v({ version: 2, basedOn: 1, status: 'designing' }), 'design', true, 'plan', ['change', 1, 'working']],
  ['a change, its plan waiting', v({ version: 2, basedOn: 1, status: 'design_ready', design: '# P' }), null, false, 'plan', ['change', 1, 'yours']],
  ['a small fix, being built', v({ version: 2, basedOn: 1, status: 'generating' }), 'build', true, 'plan', ['change', 2, 'working']],
  ['a change, ready', v({ version: 2, basedOn: 1 }), null, false, 'plan', ['change', 3, 'yours']],
  ['"Review again", running', v({ version: 2, basedOn: 1, kind: 'recheck', status: 'generating' }), 'recheck', true, 'plan', ['change', 2, 'working']],
  ['"Make it your own", its design being written', v({ version: 2, basedOn: 1, kind: 'remix', status: 'designing' }), 'design', true, 'whole', ['new', 1, 'working']],
  ['"Make it your own", being built', v({ version: 2, basedOn: 1, kind: 'remix', status: 'generating', design: '# R' }), 'build', true, 'whole', ['new', 2, 'working']],
  ["a remix's copy", v({ design: '# D', model: null }), null, false, 'whole', ['new', 3, 'yours']],
  // An upload has no design at all, v1 or later (the bug: v1 counted as a whole design).
  ['an upload, being checked', v({ kind: 'upload', status: 'generating', model: null }), 'check', false, 'none', ['upload', 1, 'working']],
  ['an upload, failed', v({ kind: 'upload', status: 'failed', model: null }), null, false, 'none', ['upload', 1, 'failed']],
  ['an upload, ready', v({ kind: 'upload', model: null }), null, false, 'none', ['upload', 2, 'yours']],
  ['a later upload, ready', v({ version: 3, basedOn: 2, kind: 'upload', model: null }), null, false, 'none', ['upload', 2, 'yours']],
];

test('every kind × status: its next step, whether it needs the AI, its design and its track', () => {
  for (const [what, version, step, needsAi, designKind, [kind, at, state]] of CASES) {
    const answer = versionKind(version);
    assert.deepEqual(answer, { step, needsAi, designKind, startsOver: designKind !== 'plan', track: { kind, at, state } }, what);
  }
});

test("what a kind decides before the version exists: whether the AI makes it (so its jobs need a key), and what it's made from", () => {
  assert.deepEqual(kindRules(null), { aiMade: true, base: 'chosen' }, 'a change: from the version asked for');
  assert.deepEqual(kindRules('recheck'), { aiMade: true, base: 'chosen' });
  assert.deepEqual(kindRules('remix'), { aiMade: true, base: 'copy' }, '"Make it your own": from the copy');
  assert.deepEqual(kindRules('upload'), { aiMade: false, base: null }, 'the file is the version');
});

test('made by (plan §57, §60): the AI if it built any version; else uploaded; else what a remix was copied from', () => {
  const game = (versions, remixOfMadeBy = null) => ({ versions, remixOfMadeBy });
  assert.equal(madeBy(game([v({})])), 'ai');
  assert.equal(madeBy(game([v({ kind: 'upload', model: null })])), 'upload');
  assert.equal(madeBy(game([v({ kind: 'upload', model: null }), v({ version: 2, basedOn: 1 })])), 'ai', 'the AI changed the upload');
  assert.equal(madeBy(game([v({ model: null })], 'upload')), 'upload', "a copy of an upload");
  assert.equal(madeBy(game([v({ model: null })])), 'ai', 'older and imported games');
});
