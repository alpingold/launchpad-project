import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/database.js';
import { createUser } from '../../src/db/users.js';
import { createGeneratedGame, addVersion, saveDraft, saveVersionSource, markVersionFailed, setLiveVersions, listGeneratedGames } from '../../src/db/generatedGames.js';
import { datasetRecords, toJsonLines } from '../../src/generation/dataset.js';

// The game library as data (plan §13n): one record per version.

test('every version becomes a record: drafts with feedback, design, code, checks, outcome; no owner', () => {
  const db = openDatabase(':memory:');
  const admin = createUser(db, 'zelda-owner', 'scrypt$x');
  const { id } = createGeneratedGame(db, { ownerUserId: admin.id, prompt: 'A voting game', model: 'qwen3.8:27b' });
  saveDraft(db, id, 1, { text: '# Vote\n', by: 'ai', now: 1 });
  saveDraft(db, id, 1, { text: '# Vote, 2 rounds\n', by: 'ai', feedback: 'Two rounds', now: 2 });
  saveVersionSource(db, id, 1, {
    source: '<game>',
    name: 'Vote',
    report: { ok: true, problems: [], warnings: [{ rule: 'save', message: 'never saves' }, { rule: 'address', message: 'x', count: 3 }], playtest: { screenshots: { host: 'data:...' } } },
  });
  addVersion(db, id, { request: 'Fix the typo', basedOn: 1, status: 'generating' });
  saveVersionSource(db, id, 2, { source: '<game 2>', name: 'Vote', report: { ok: true, problems: [], warnings: [] }, changelog: '- Typo' });
  addVersion(db, id, { request: 'Add a timer', basedOn: 2 });
  saveDraft(db, id, 3, { text: '# Change: timer\n', by: 'admin' });
  markVersionFailed(db, id, 3, 'no passing game', { source: '<bad>', report: { ok: false, problems: ['no game info', { rule: 'csp', message: 'y' }], warnings: [] } });
  setLiveVersions(db, id, { publishedVersion: 2 });

  const records = datasetRecords(listGeneratedGames(db));
  assert.deepEqual(records.map((r) => [r.version, r.kind, r.outcome]), [
    [1, 'new', 'built-then-changed'],
    [2, 'small-fix', 'published'],
    [3, 'change', 'failed'],
  ]);
  assert.deepEqual(records[0].drafts, [
    { by: 'ai', feedback: null, text: '# Vote\n' },
    { by: 'ai', feedback: 'Two rounds', text: '# Vote, 2 rounds\n' },
  ]);
  assert.deepEqual([records[0].idea, records[0].request, records[0].design, records[0].source], ['A voting game', null, '# Vote, 2 rounds\n', '<game>']);
  assert.deepEqual(records[0].checks, { ok: true, problems: {}, warnings: { save: 1, address: 3 } });
  assert.deepEqual(records[2].checks, { ok: false, problems: { info: 1, csp: 1 }, warnings: {} });
  assert.equal(records[1].request, 'Fix the typo');

  const text = toJsonLines(records);
  assert.equal(text.trim().split('\n').length, 3);
  assert.doesNotMatch(text, /ownerUserId|zelda-owner|data:\.\.\./, 'no owner, no screenshots');
  assert.equal(toJsonLines([]), '');
});
