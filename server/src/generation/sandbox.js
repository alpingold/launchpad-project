// Runs the generator inside an OpenShell sandbox, from the server's side (plan §11).
//
// Three `openshell` commands per game:
//   1. sandbox create  a fresh sandbox from the generator image, with the GenAI Studio
//                      provider and our policy, whose main process just waits
//   2. sandbox exec    run the generator in it, with the job JSON piped in on stdin
//   3. sandbox delete  always, even if something failed
// (`sandbox create` doesn't forward stdin, so the job goes in through `exec`.)
//
// A job with a user's own key (plan §15) first makes a provider just for it, and deletes it
// at the end: `provider create --from-existing` reads the key from that one command's
// environment (never its arguments, which other programs on the machine can see). The
// sandbox only ever sees a placeholder, as with the server's own key.
//
// Commands are started with spawn() and an argument list, never through a shell, and the
// game idea travels on stdin, never as an argument: a prompt can't become a command.
//
// With a browser slot (plan §28), stdin stays open after the job: the job asks for the
// shared browser on stderr ("BROWSER? <token>") and gets the go on stdin ("BROWSER! <token>").
// The token is random per job, so a line that doesn't carry it is just ignored.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Runs a program and collects its output. Resolves even if it fails; rejects only if it
 * couldn't be started at all (e.g. openshell isn't installed).
 * @param {string} bin
 * @param {string[]} args
 * @param {{ input?: string, timeoutMs: number, onStderrLine?: (line: string) => void, env?: NodeJS.ProcessEnv, keepStdinOpen?: boolean, onStart?: (child: { write: (text: string) => void, kill: () => void }) => void }} opts
 *   env: the program's environment (default: this process's)
 *   keepStdinOpen: send `input` but don't close stdin, so more can be written (onStart's write)
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runCommand(bin, args, { input, timeoutMs, onStderrLine = () => {}, env = process.env, keepStdinOpen = false, onStart = () => {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    let partial = '';
    let timedOut = false;
    child.on('error', reject);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      const lines = (partial + d).split('\n');
      partial = lines.pop();
      for (const line of lines) onStderrLine(line);
    });
    child.stdin.on('error', () => {});
    if (keepStdinOpen) child.stdin.write(input ?? '');
    else child.stdin.end(input ?? '');
    onStart({
      write: (text) => {
        if (child.stdin.writable) child.stdin.write(text);
      },
      kill: () => child.kill('SIGKILL'),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Generates a game in a fresh sandbox.
 * @param {import('../../../generator/src/run.js').GeneratorJob} job  sent to the generator as it is
 * @param {{ onStep?: import('../../../generator/src/run.js').OnStep, onAttempt?: (attempt: object) => void, cfg?: typeof config, run?: typeof runCommand, apiKey?: string, browserSlot?: import('./browserSlot.js').BrowserSlot }} [deps]
 *   onStep: the generator's progress; `replace` updates the last step (a streaming reply)
 *   onAttempt: each attempt as it ends (keepThinking jobs only: compare-builds keeps them if stopped)
 *   apiKey: the job owner's own GenAI Studio key (plan §15); without it, the server's provider.
 *     An uploaded file's check (step 'check', plan §57) gets neither: no AI, so no key and no network
 *   browserSlot: shared between jobs, so only so many browser checks run at once (plan §28);
 *     without it the job checks whenever it likes
 * @returns {Promise<import('../../../generator/src/run.js').GeneratorResult>}
 */
export async function runGeneratorInSandbox(job, { onStep = () => {}, onAttempt = () => {}, cfg = config, run = runCommand, apiKey, browserSlot } = {}) {
  const hex = randomBytes(4).toString('hex');
  const name = `bg-gen-${hex}`; // OpenShell allows at most 19 characters
  // An upload's check runs someone's own code and needs no AI: no provider, so no key in reach
  // and (the policy has no rules of its own) no network at all.
  const noAi = job.step === 'check';
  const keyProvider = apiKey && !noAi ? `bg-key-${hex}` : null;
  const bin = cfg.OPENSHELL_BIN;
  const limitSeconds = Math.ceil(cfg.GENERATION_TIMEOUT_MS / 1000);
  // No error message may ever contain the key, even if a command printed it back.
  const hideKey = (text) => (apiKey ? text.split(apiKey).join('[key]') : text);
  const failed = (error) => ({ ok: false, model: job.model ?? null, source: null, report: null, attempts: [], error: hideKey(error) });

  try {
    if (keyProvider) {
      onStep('setting up your GenAI Studio key');
      const made = await run(bin, ['provider', 'create', '--name', keyProvider, '--type', cfg.GENERATOR_PROVIDER_TYPE, '--from-existing'], {
        timeoutMs: 60_000,
        env: { ...process.env, GENAI_API_KEY: apiKey },
      });
      if (made.code !== 0) return failed(`could not set up your key in OpenShell: ${lastLines(made.stderr || made.stdout)}`);
    }
    onStep('starting the sandbox');
    const created = await run(
      bin,
      [
        'sandbox', 'create',
        '--name', name,
        '--detach',
        '--no-keep', // safety net: if we never get to `delete`, it goes away when `sleep` ends
        '--from', cfg.GENERATOR_IMAGE,
        ...(noAi ? [] : ['--provider', keyProvider ?? cfg.GENERATOR_PROVIDER]),
        '--policy', cfg.GENERATOR_POLICY_PATH,
        '--', 'sleep', String(limitSeconds + 120),
      ],
      { timeoutMs: 3 * 60 * 1000 },
    );
    if (created.code !== 0) return failed(`could not start the sandbox: ${lastLines(created.stderr || created.stdout)}`);

    const gate = browserSlot ? slotGate(browserSlot, name, onStep) : null;
    let ran;
    try {
      ran = await run(
        bin,
        ['sandbox', 'exec', '-n', name, '--no-tty', '--timeout', String(limitSeconds), '--', 'node', '/app/generator/src/run.js'],
        {
          input: `${JSON.stringify(gate ? { ...job, browserGate: gate.token } : job)}\n`,
          keepStdinOpen: Boolean(gate),
          onStart: (child) => gate?.attach(child),
          timeoutMs: cfg.GENERATION_TIMEOUT_MS + 60_000,
          onStderrLine: (line) => {
            if (gate?.handle(line)) return;
            if (line.startsWith('ATTEMPT ')) {
              try {
                onAttempt(JSON.parse(line.slice(8)));
              } catch {
                // a broken line: the attempt is still in the final result
              }
            } else if (line.startsWith('STEP ')) onStep(line.slice(5));
            else if (line.startsWith('STEP~ ')) onStep(line.slice(6), { replace: true }); // replaces the last step
          },
        },
      );
    } finally {
      gate?.end(); // whatever happened, this job no longer holds or waits for the browser
    }
    if (gate?.heldTooLong) return failed(`the browser check took longer than ${Math.round(browserSlot.maxHoldMs / 1000)} s and was stopped`);
    if (ran.timedOut) return failed(`generation took longer than ${Math.round(limitSeconds / 60)} minutes and was stopped`);
    try {
      return JSON.parse(ran.stdout.trim().split('\n').at(-1));
    } catch {
      if (ran.stdout.length > 0) return failed(`the generator's result was cut off after ${ran.stdout.length} bytes (exit ${ran.code})`);
      return failed(`the generator gave no result (exit ${ran.code}): ${lastLines(ran.stderr)}`);
    }
  } catch (err) {
    return failed(err.code === 'ENOENT' ? `"${bin}" isn't installed on this machine (generator/README.md)` : err.message);
  } finally {
    await run(bin, ['sandbox', 'delete', name], { timeoutMs: 60_000 }).catch(() => {});
    if (keyProvider) await run(bin, ['provider', 'delete', keyProvider], { timeoutMs: 60_000 }).catch(() => {});
  }
}

/**
 * One job's side of the browser slot: answers its "BROWSER?" and "BROWSER done" lines, in
 * that order only, and only with its own token. Any other line is left for the caller.
 * @param {import('./browserSlot.js').BrowserSlot} slot
 * @param {string} id  the job (its sandbox name)
 * @param {import('../../../generator/src/run.js').OnStep} onStep
 */
export function slotGate(slot, id, onStep) {
  const token = randomBytes(16).toString('hex');
  /** @type {'idle' | 'waiting' | 'holding' | 'ended'} */
  let state = 'idle';
  let child = null;
  const gate = {
    token,
    heldTooLong: false,
    attach(c) {
      child = c;
    },
    /** @returns {boolean} whether the line was a gate message (of this job) */
    handle(line) {
      if (line === `BROWSER? ${token}`) {
        if (state !== 'idle') return true;
        state = 'waiting';
        const granted = slot.request(id, {
          onTimeout: () => {
            gate.heldTooLong = true;
            child?.kill();
          },
        });
        const place = slot.positionOf(id);
        if (place > 0) onStep(`waiting for a turn in the browser to test it (${ordinal(place)} in line)`);
        granted.then(() => {
          if (state !== 'waiting') return slot.release(id); // ended while it waited
          state = 'holding';
          child?.write(`BROWSER! ${token}\n`);
        });
        return true;
      }
      if (line === `BROWSER done ${token}`) {
        if (state === 'holding') {
          state = 'idle';
          slot.release(id);
        }
        return true;
      }
      return false;
    },
    end() {
      state = 'ended';
      slot.cancel(id);
    },
  };
  return gate;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th" (places in line are small). */
const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

const lastLines = (text) => text.trim().split('\n').filter((l) => !/^(STEP~? |BROWSER)/.test(l)).slice(-3).join(' | ').slice(0, 500);
