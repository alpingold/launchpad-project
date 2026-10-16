import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGeneratorInSandbox, runCommand } from '../../src/generation/sandbox.js';
import { config } from '../../src/config.js';

// The server's side of running the generator in OpenShell (plan §11, A4). A fake `run`
// stands in for the openshell command, so these tests need no Docker or OpenShell.

const RESULT = { ok: true, model: 'qwen3.8:27b', source: 'export default {};\n', report: { ok: true }, attempts: [] };

/** A fake openshell: answers each subcommand with what `answers[subcommand]` returns. */
function fakeOpenshell(answers = {}) {
  const calls = [];
  const run = async (bin, args, opts) => {
    calls.push({ bin, args, input: opts.input, env: opts.env });
    const sub = args[0] === 'sandbox' ? args[1] : args.slice(0, 2).join(' '); // 'create', 'exec', … or 'provider create'
    const answer = answers[sub] ?? { code: 0, stdout: '', stderr: '' };
    if (answer instanceof Error) throw answer;
    if (sub === 'exec') for (const line of (answer.stderr ?? '').split('\n')) opts.onStderrLine?.(line);
    return { timedOut: false, ...answer };
  };
  return { run, calls };
}

const job = { idea: 'Everyone votes; the minority wins', model: 'qwen3.8:27b' };

test('create → exec (job on stdin) → delete, and the result comes back', async () => {
  const steps = [];
  const { run, calls } = fakeOpenshell({
    exec: {
      code: 0,
      stdout: `${JSON.stringify(RESULT)}\n`,
      stderr: 'STEP attempt 1/4: asking qwen3.8:27b\nnoise\nSTEP~ attempt 1/4: asking qwen3.8:27b (thinking 900 tokens, writing 0)\nSTEP attempt 1/4: passed\n',
    },
  });
  const result = await runGeneratorInSandbox(job, { run, onStep: (s, opts) => steps.push(opts?.replace ? `~${s}` : s) });
  assert.deepEqual(result, RESULT);
  assert.deepEqual(steps, [
    'starting the sandbox',
    'attempt 1/4: asking qwen3.8:27b',
    '~attempt 1/4: asking qwen3.8:27b (thinking 900 tokens, writing 0)', // "STEP~": replaces the last step
    'attempt 1/4: passed',
  ]);

  assert.deepEqual(calls.map((c) => c.args.slice(0, 2)), [['sandbox', 'create'], ['sandbox', 'exec'], ['sandbox', 'delete']]);
  const [create, exec, del] = calls;
  const name = create.args[create.args.indexOf('--name') + 1];
  assert.match(name, /^bg-gen-[0-9a-f]{8}$/);
  for (const flag of ['--detach', '--from', '--provider', '--policy']) assert.ok(create.args.includes(flag), flag);
  assert.equal(create.args[create.args.indexOf('--policy') + 1], config.GENERATOR_POLICY_PATH);
  assert.equal(exec.args[exec.args.indexOf('-n') + 1], name);
  assert.deepEqual(exec.args.slice(-3), ['--', 'node', '/app/generator/src/run.js']);
  assert.deepEqual(del.args, ['sandbox', 'delete', name]);
});

test('the game idea is passed on stdin, never as a command argument', async () => {
  const sneaky = { idea: '"; rm -rf / # a game about $(whoami)', model: 'qwen3.8:27b' };
  const { run, calls } = fakeOpenshell({ exec: { code: 0, stdout: JSON.stringify(RESULT) } });
  await runGeneratorInSandbox(sneaky, { run });
  for (const call of calls) assert.ok(!call.args.some((a) => a.includes('whoami')), call.args.join(' '));
  assert.deepEqual(JSON.parse(calls[1].input), sneaky);
});

test('the sandbox is deleted even when things go wrong', async () => {
  for (const answers of [
    { create: { code: 1, stderr: 'image not found' } },
    { exec: { code: 1, stdout: '', stderr: 'Error: boom' } },
    { exec: new Error('lost connection to the gateway') },
  ]) {
    const { run, calls } = fakeOpenshell(answers);
    const result = await runGeneratorInSandbox(job, { run });
    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.deepEqual(calls.at(-1).args.slice(0, 2), ['sandbox', 'delete'], JSON.stringify(answers));
  }
});

test('failures are explained', async () => {
  const notStarted = await runGeneratorInSandbox(job, fakeOpenshell({ create: { code: 1, stderr: 'line1\nimage not found' } }));
  assert.match(notStarted.error, /could not start the sandbox: line1 \| image not found/);

  const noResult = await runGeneratorInSandbox(job, fakeOpenshell({ exec: { code: 137, stdout: '', stderr: 'STEP x\nKilled' } }));
  assert.equal(noResult.error, 'the generator gave no result (exit 137): Killed');

  const cutOff = await runGeneratorInSandbox(job, fakeOpenshell({ exec: { code: 0, stdout: '{"ok":true,"source":"<scri', stderr: '' } }));
  assert.equal(cutOff.error, "the generator's result was cut off after 26 bytes (exit 0)");

  const slow = await runGeneratorInSandbox(job, fakeOpenshell({ exec: { code: null, stdout: '', stderr: '', timedOut: true } }));
  assert.match(slow.error, /took longer than 60 minutes/);

  const missing = Object.assign(new Error('spawn openshell ENOENT'), { code: 'ENOENT' });
  const notInstalled = await runGeneratorInSandbox(job, fakeOpenshell({ create: missing }));
  assert.match(notInstalled.error, /"openshell" isn't installed/);
});

test('runCommand: passes stdin, collects output, reports stderr lines, and kills on timeout', async () => {
  const lines = [];
  const echo = await runCommand(
    process.execPath,
    ['-e', 'process.stdin.pipe(process.stdout); console.error("STEP one"); console.error("STEP two")'],
    { input: 'hello', timeoutMs: 10_000, onStderrLine: (l) => lines.push(l) },
  );
  assert.equal(echo.code, 0);
  assert.equal(echo.stdout, 'hello');
  assert.deepEqual(lines, ['STEP one', 'STEP two']);

  const stuck = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
  assert.equal(stuck.timedOut, true);
  await assert.rejects(runCommand('definitely-not-a-real-program', [], { timeoutMs: 1000 }), { code: 'ENOENT' });
});

test("a user's own key (plan §15): a provider just for this job, the key only in its environment, deleted after", async () => {
  const KEY = 'sk-user-own-key-0123456789abcdef';
  const { run, calls } = fakeOpenshell({ exec: { code: 0, stdout: JSON.stringify(RESULT) } });
  const result = await runGeneratorInSandbox(job, { run, apiKey: KEY });
  assert.deepEqual(result, RESULT);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(' ')), ['provider create', 'sandbox create', 'sandbox exec', 'sandbox delete', 'provider delete']);
  const [provider, create] = calls;
  const name = provider.args[provider.args.indexOf('--name') + 1];
  assert.match(name, /^bg-key-[0-9a-f]{8}$/);
  assert.deepEqual(provider.args.slice(4), ['--type', 'genai-studio', '--from-existing']);
  assert.equal(provider.env.GENAI_API_KEY, KEY, 'the key travels in the environment');
  assert.equal(create.args[create.args.indexOf('--provider') + 1], name, 'the sandbox uses that provider');
  assert.deepEqual(calls.at(-1).args, ['provider', 'delete', name]);
  for (const call of calls) assert.ok(!call.args.join(' ').includes(KEY), 'never in any argument list');
  assert.ok(!calls[2].input.includes(KEY), 'never in the job');
  for (const call of calls.slice(1)) assert.equal(call.env?.GENAI_API_KEY, undefined, 'only the provider command gets it');

  // Failing to make the provider: nothing else runs, it's still cleaned up, and the key never shows.
  const broken = fakeOpenshell({ 'provider create': { code: 1, stderr: `invalid credential ${KEY}` } });
  const failed = await runGeneratorInSandbox(job, { run: broken.run, apiKey: KEY });
  assert.match(failed.error, /could not set up your key in OpenShell: invalid credential \[key\]/);
  assert.deepEqual(broken.calls.map((c) => c.args.slice(0, 2).join(' ')), ['provider create', 'sandbox delete', 'provider delete']);

  // Without a key: the server's own provider, as before.
  const plain = fakeOpenshell({ exec: { code: 0, stdout: JSON.stringify(RESULT) } });
  await runGeneratorInSandbox(job, { run: plain.run });
  assert.equal(plain.calls[0].args[plain.calls[0].args.indexOf('--provider') + 1], 'genai-studio');
  assert.ok(!plain.calls.some((c) => c.args[0] === 'provider'));
});

test('runCommand: passes the environment it is given', async () => {
  const out = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.env.ONLY_HERE ?? "none")'], { timeoutMs: 5000, env: { ...process.env, ONLY_HERE: 'yes' } });
  assert.equal(out.stdout, 'yes');
});
