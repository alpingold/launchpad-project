import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/db/database.js';
import { createUser } from '../../src/db/users.js';
import { createKeyVault, loadKeySecret } from '../../src/auth/keyVault.js';
import { createUserKeys, checkGenaiKey } from '../../src/generation/userKeys.js';
import { GenerationService } from '../../src/generation/service.js';
import { GameRegistry } from '../../src/games/registry.js';

// Users' own GenAI Studio keys (plan §15): encrypted at rest, checked before saving, used
// only for their owner's jobs.

const KEY = 'sk-0123456789abcdef0123456789abcdef';

test('the vault: a sealed key opens only for the same user and the same secret, and only unchanged', () => {
  const secret = randomBytes(32);
  const vault = createKeyVault(secret);
  const sealed = vault.seal(7, KEY);
  assert.ok(!sealed.ciphertext.toString('utf8').includes(KEY.slice(3)), 'not readable');
  assert.equal(vault.open(7, sealed), KEY);
  assert.notDeepEqual(vault.seal(7, KEY).iv, sealed.iv, 'a fresh IV every time');
  assert.throws(() => vault.open(8, sealed), 'moved to another account');
  assert.throws(() => createKeyVault(randomBytes(32)).open(7, sealed), 'another secret');
  const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
  tampered.ciphertext[0] ^= 1;
  assert.throws(() => vault.open(7, tampered), 'changed');
  assert.throws(() => createKeyVault(randomBytes(16)), /32 bytes/);
});

test('loadKeySecret: from GENAI_KEY_SECRET, or a file made once and readable only by its owner', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'boilergames-secret-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = randomBytes(32);
  assert.deepEqual(loadKeySecret({ env: env.toString('base64'), file: path.join(dir, 'unused') }), env);
  assert.throws(() => loadKeySecret({ env: 'c2hvcnQ=', file: path.join(dir, 'unused') }), /32 bytes/);

  const file = path.join(dir, 'sub', 'key-secret');
  const made = loadKeySecret({ env: '', file });
  assert.equal(made.length, 32);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadKeySecret({ env: '', file }), made, 'the same one next time');
  assert.deepEqual(readFileSync(file), made);
});

function setup(verdict = 'ok') {
  const db = openDatabase(':memory:');
  const user = createUser(db, 'sam', 'scrypt$x');
  const checked = [];
  const userKeys = createUserKeys({
    db,
    vault: createKeyVault(randomBytes(32)),
    checkKey: async (key) => {
      checked.push(key);
      return verdict;
    },
  });
  return { db, user, userKeys, checked };
}

test('saving a key: checked first, stored encrypted, shown only as its last 4 characters', async () => {
  const { db, user, userKeys, checked } = setup();
  assert.deepEqual(userKeys.status(user.id), { saved: false, last4: null, savedAt: null });
  const status = await userKeys.save(user.id, `  ${KEY}\n`);
  assert.deepEqual([status.saved, status.last4], [true, 'cdef']);
  assert.deepEqual(checked, [KEY], 'trimmed, then checked with GenAI Studio');
  const row = db.prepare('SELECT * FROM genai_keys').get();
  assert.ok(!JSON.stringify(row).includes('0123456789abcdef'), 'the database never holds the key in the clear');
  assert.ok(!Buffer.concat([row.ciphertext, row.iv, row.tag]).toString('latin1').includes('0123456789abcdef'));
  assert.equal(userKeys.keyFor(user.id), KEY);
  await userKeys.save(user.id, `${KEY.slice(0, -4)}zzzz`);
  assert.equal(userKeys.status(user.id).last4, 'zzzz', 'a new key replaces the old one');
  userKeys.remove(user.id);
  assert.equal(userKeys.keyFor(user.id), null);
});

test('saving a key: refused when it looks wrong, GenAI Studio rejects it, or GenAI Studio is unreachable', async () => {
  const code = async (userKeys, id, key) => userKeys.save(id, key).then(() => 'saved', (err) => err.code);
  const ok = setup();
  for (const bad of [undefined, 42, 'short', 'has spaces in the middle of it', 'x'.repeat(300)]) {
    assert.equal(await code(ok.userKeys, ok.user.id, bad), 'INVALID_KEY');
  }
  assert.deepEqual(ok.checked, [], 'never sent anywhere');
  const rejected = setup('rejected');
  assert.equal(await code(rejected.userKeys, rejected.user.id, KEY), 'KEY_REJECTED');
  const down = setup('unreachable');
  assert.equal(await code(down.userKeys, down.user.id, KEY), 'GENAI_UNREACHABLE');
  assert.equal(down.userKeys.status(down.user.id).saved, false);
});

test("checkGenaiKey: GenAI Studio's model list says whether a key works", async () => {
  const seen = [];
  const fakeFetch = (status) => async (url, opts) => {
    seen.push([url, opts.headers.Authorization]);
    if (status === 'throw') throw new Error('offline');
    return { ok: status === 200, status };
  };
  assert.equal(await checkGenaiKey(KEY, { fetchFn: fakeFetch(200) }), 'ok');
  assert.deepEqual(seen[0], ['https://genai.rcac.purdue.edu/api/models', `Bearer ${KEY}`]);
  assert.equal(await checkGenaiKey(KEY, { fetchFn: fakeFetch(401) }), 'rejected');
  assert.equal(await checkGenaiKey(KEY, { fetchFn: fakeFetch(500) }), 'unreachable');
  assert.equal(await checkGenaiKey(KEY, { fetchFn: fakeFetch('throw') }), 'unreachable');
});

test('jobs: a user needs a saved key; their job runs with it; a key that no longer opens fails the job clearly', async () => {
  const { db, user, userKeys } = setup();
  const calls = [];
  const service = new GenerationService({
    db,
    games: new GameRegistry(),
    enabled: true,
    userKeys,
    log: () => {},
    runGenerator: async (job, opts) => {
      calls.push(opts.apiKey);
      return { ok: true, design: '# A game\n' };
    },
  });
  const idea = 'Everyone votes; the most popular answer wins';
  assert.throws(() => service.start({ ownerUserId: user.id, idea }), (err) => err.code === 'NO_KEY');

  await userKeys.save(user.id, KEY);
  service.start({ ownerUserId: user.id, idea });
  await service.current;
  assert.deepEqual(calls, [KEY], "the owner's own key, given to the sandbox runner (never in the job itself)");

  // The secret changed (e.g. its file was lost): the saved key can't be opened any more.
  const other = createUser(db, 'kim', 'scrypt$x');
  const lost = createUserKeys({ db, vault: createKeyVault(randomBytes(32)), checkKey: async () => 'ok' });
  await userKeys.save(other.id, KEY);
  const service2 = new GenerationService({ db, games: new GameRegistry(), enabled: true, userKeys: lost, log: () => {}, runGenerator: async () => assert.fail('must not run') });
  const game = service2.start({ ownerUserId: other.id, idea });
  await service2.current;
  assert.match(service2.get(game.id).versions[0].error, /couldn't be used\. Save it again/);
});
