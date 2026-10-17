import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { BrowserSlot } from '../../src/generation/browserSlot.js';
import { runGeneratorInSandbox } from '../../src/generation/sandbox.js';
import { lineReader, stdinGate, isGateToken } from '../../../generator/src/browserGate.js';
import { runJob } from '../../../generator/src/run.js';

// The shared browser slot (plan §28): many generation jobs at once, one browser check at a
// time. Three parts: the slot (server), the job's gate (generator, in the sandbox), and the
// conversation between them over the job's pipes (sandbox.js), here with a fake openshell.

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Fake timers: run them by hand. */
function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    setTimer: (fn) => {
      timers.set(next, fn);
      return next++;
    },
    clearTimer: (id) => timers.delete(id),
    fireAll: () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
    count: () => timers.size,
  };
}

// --- The slot -------------------------------------------------------------------------------

test('slot: one at a time, first come first served; release passes it on', async () => {
  const slot = new BrowserSlot();
  const got = [];
  slot.request('a').then(() => got.push('a'));
  slot.request('b').then(() => got.push('b'));
  slot.request('c').then(() => got.push('c'));
  await tick();
  assert.deepEqual(got, ['a']);
  assert.deepEqual(['a', 'b', 'c'].map((id) => slot.positionOf(id)), [0, 1, 2]);

  slot.release('b'); // not the holder: ignored
  await tick();
  assert.deepEqual(got, ['a']);

  slot.release('a');
  await tick();
  assert.deepEqual(got, ['a', 'b']);
  assert.equal(slot.positionOf('a'), null);
  slot.release('b');
  await tick();
  assert.deepEqual(got, ['a', 'b', 'c']);
  slot.release('c');
});

test('slot: a job that ends leaves the line, or frees the slot if it had it; size allows more at once', async () => {
  const slot = new BrowserSlot({ size: 2 });
  const got = [];
  for (const id of ['a', 'b', 'c', 'd']) slot.request(id).then(() => got.push(id));
  await tick();
  assert.deepEqual(got, ['a', 'b'], 'two at once');

  slot.cancel('c'); // ended while waiting: never gets it
  slot.cancel('a'); // ended while holding: frees a place
  await tick();
  assert.deepEqual(got, ['a', 'b', 'd']);
  await assert.rejects(slot.request('d'), /already asked/);
});

test('slot: held too long → taken back, the job is told, and the next one goes', async () => {
  const timers = fakeTimers();
  const slot = new BrowserSlot({ maxHoldMs: 1000, ...timers });
  let stopped = false;
  let bGot = false;
  await slot.request('a', { onTimeout: () => (stopped = true) });
  slot.request('b').then(() => (bGot = true));
  timers.fireAll();
  await tick();
  assert.equal(stopped, true);
  assert.equal(bGot, true);
  assert.equal(slot.positionOf('a'), null);
  slot.release('b');
  assert.equal(timers.count(), 0, 'releasing clears the hold timer');
});

// --- The job's side (generator/src/browserGate.js) -------------------------------------------

const TOKEN = 'a'.repeat(32);

test('gate: asks on stderr, waits for its own go on stdin (other lines ignored), says done', async () => {
  const stdin = new PassThrough();
  const lines = lineReader(stdin);
  const said = [];
  stdin.write('{"step":"build"}\nBROWSER! ');
  assert.equal(await lines.next(), '{"step":"build"}', 'the job is the first line');

  const gate = stdinGate(TOKEN, { lines, write: (t) => said.push(t) });
  let started = false;
  const acquiring = gate.acquire().then(() => (started = true));
  await tick();
  assert.deepEqual(said, [`BROWSER? ${TOKEN}\n`]);
  stdin.write(`${'b'.repeat(32)}\n`); // someone else's token: not a go
  stdin.write('BROWSER!\n');
  await tick();
  assert.equal(started, false);
  stdin.write(`BROWSER! ${TOKEN}\n`);
  await acquiring;
  gate.release();
  gate.release(); // once only
  assert.deepEqual(said, [`BROWSER? ${TOKEN}\n`, `BROWSER done ${TOKEN}\n`]);
});

test('gate: if the server hangs up before the go, the check fails instead of waiting forever', async () => {
  const stdin = new PassThrough();
  const gate = stdinGate(TOKEN, { lines: lineReader(stdin), write: () => {} });
  const acquiring = gate.acquire();
  stdin.end();
  await assert.rejects(acquiring, /stopped answering/);
  assert.equal(isGateToken(TOKEN), true);
  assert.equal(isGateToken('BROWSER'), false);
});

const GAME = readFileSync(new URL('../fixtures/tap-test.html', import.meta.url), 'utf8');
const DESIGN = readFileSync(new URL('../../../generator/spec/designs/bumper-blobs.md', import.meta.url), 'utf8');
const fenced = (text) => `\`\`\`html\n${text}\`\`\``;

test('build job: every browser check is inside the gate, and the gate is given back even if the check crashes', async () => {
  const log = [];
  const browser = { acquire: async () => log.push('acquire'), release: () => log.push('release') };
  const replies = [fenced(GAME.replace('party.ready(', 'fetch("/x"); party.ready(')), fenced(GAME)];
  const chatFn = async () => ({ content: replies.shift(), seconds: 1, usage: null });
  const check = async (source) => {
    log.push('check');
    return source.includes('fetch') ? { ok: false, problems: [{ rule: 'network', message: 'no' }], warnings: [] } : { ok: true, problems: [], warnings: [] };
  };
  const job = { step: 'build', idea: 'A game about voting together', design: DESIGN, edits: false };
  const result = await runJob(job, { chatFn, check, browser });
  assert.equal(result.ok, true);
  assert.deepEqual(log, ['acquire', 'check', 'release', 'acquire', 'check', 'release'], 'released between attempts, while the AI works');

  log.length = 0;
  const crashing = async () => {
    log.push('check');
    throw new Error('Chrome crashed');
  };
  await assert.rejects(runJob(job, { chatFn: async () => ({ content: fenced(GAME), seconds: 1, usage: null }), check: crashing, browser }), /Chrome crashed/);
  assert.deepEqual(log, ['acquire', 'check', 'release']);
});

// --- The conversation (server/src/generation/sandbox.js) -------------------------------------

const RESULT = { ok: true, model: 'qwen3.8:27b', source: 'x', report: { ok: true }, attempts: [] };

/**
 * A fake openshell whose `exec` behaves like a generator: it reads its token from the job,
 * asks for the browser, and waits for the go before "checking". `script(token, say)` decides
 * what it prints; `go` resolves when it gets the go.
 */
function interactiveOpenshell(script) {
  const execs = [];
  const run = (bin, args, opts) => {
    if (args[1] !== 'exec') return Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: false });
    return new Promise((resolve) => {
      const job = JSON.parse(opts.input);
      let gotGo;
      const go = new Promise((r) => (gotGo = r));
      const exec = { job, keepStdinOpen: opts.keepStdinOpen, written: [], killed: false, finish: () => resolve({ code: 0, stdout: JSON.stringify(RESULT), stderr: '', timedOut: false }) };
      opts.onStart({
        write: (text) => {
          exec.written.push(text);
          if (text === `BROWSER! ${job.browserGate}\n`) gotGo();
        },
        kill: () => {
          exec.killed = true;
          resolve({ code: null, stdout: '', stderr: '', timedOut: false });
        },
      });
      execs.push(exec);
      script(job.browserGate, (line) => opts.onStderrLine(line), go, exec);
    });
  };
  return { run, execs };
}

test('sandbox: two jobs share the browser; the second waits for the first to finish its check', async () => {
  const slot = new BrowserSlot();
  const checking = [];
  const { run, execs } = interactiveOpenshell(async (token, say, go, exec) => {
    say('STEP attempt 1/4: asking the AI');
    say(`BROWSER? ${token}`);
    await go;
    checking.push(exec);
  });
  const stepsB = [];
  const a = runGeneratorInSandbox({ idea: 'job a' }, { run, browserSlot: slot });
  const b = runGeneratorInSandbox({ idea: 'job b' }, { run, browserSlot: slot, onStep: (s) => stepsB.push(s) });
  await tick();
  await tick();
  assert.equal(execs.length, 2);
  assert.ok(execs.every((e) => e.keepStdinOpen && isGateToken(e.job.browserGate)), 'each job gets its own token, stdin open');
  assert.notEqual(execs[0].job.browserGate, execs[1].job.browserGate);
  assert.deepEqual(checking, [execs[0]], 'only the first checks');
  assert.match(stepsB.at(-1), /waiting for a turn in the browser to test it \(1st in line\)/);

  execs[0].finish(); // the first job ends (its done line never came: ending frees the slot anyway)
  assert.deepEqual(await a, RESULT);
  await tick();
  assert.deepEqual(checking, [execs[0], execs[1]], 'then the second');
  execs[1].finish();
  assert.deepEqual(await b, RESULT);
  assert.equal(slot.positionOf(execs[1].job.browserGate), null);
});

test("sandbox: lines without the job's token, or out of order, are ignored; a done hands the slot on", async () => {
  const slot = new BrowserSlot();
  const { run, execs } = interactiveOpenshell(async (token, say, go) => {
    say('BROWSER done ' + token); // done before asking: ignored
    say('BROWSER? ' + 'f'.repeat(32)); // a made-up token: ignored (shown as nothing, not a step)
    say('STEP   BROWSER done ' + token); // inside a step (e.g. a game's message): just a step
    say('BROWSER? ' + token);
    await go;
    say('BROWSER done ' + token);
  });
  const steps = [];
  const a = runGeneratorInSandbox({ idea: 'job a' }, { run, browserSlot: slot, onStep: (s) => steps.push(s) });
  await tick();
  await tick();
  assert.equal(execs[0].written.length, 1, 'one go');
  assert.equal(slot.holders.size, 0, 'its done freed the slot');
  assert.ok(steps.includes(`  BROWSER done ${execs[0].job.browserGate}`), 'a step mentioning it is only a step');
  execs[0].finish();
  await a;
});

test('sandbox: a job that holds the browser too long is stopped, and its result says why', async () => {
  const timers = fakeTimers();
  const slot = new BrowserSlot({ maxHoldMs: 30_000, ...timers });
  const { run, execs } = interactiveOpenshell(async (token, say) => say(`BROWSER? ${token}`));
  const a = runGeneratorInSandbox({ idea: 'job a', model: 'qwen3.8:27b' }, { run, browserSlot: slot });
  await tick();
  await tick();
  timers.fireAll();
  const result = await a;
  assert.equal(execs[0].killed, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /the browser check took longer than 30 s and was stopped/);
  assert.equal(slot.holders.size, 0);
});

test('sandbox: without a slot (the generate script), no token, and stdin is closed as before', async () => {
  const { run, execs } = interactiveOpenshell(async (token, say, go, exec) => exec.finish());
  assert.deepEqual(await runGeneratorInSandbox({ idea: 'job a' }, { run }), RESULT);
  assert.equal(execs[0].job.browserGate, undefined);
  assert.equal(execs[0].keepStdinOpen, false);
});
