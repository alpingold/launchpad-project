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

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Runs a program and collects its output. Resolves even if it fails; rejects only if it
 * couldn't be started at all (e.g. openshell isn't installed).
 * @param {string} bin
 * @param {string[]} args
 * @param {{ input?: string, timeoutMs: number, onStderrLine?: (line: string) => void, env?: NodeJS.ProcessEnv }} opts
 *   env: the program's environment (default: this process's)
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runCommand(bin, args, { input, timeoutMs, onStderrLine = () => {}, env = process.env }) {
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
    child.stdin.end(input ?? '');
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
 * @param {{ onStep?: import('../../../generator/src/run.js').OnStep, cfg?: typeof config, run?: typeof runCommand, apiKey?: string }} [deps]
 *   onStep: the generator's progress; `replace` updates the last step (a streaming reply)
 *   apiKey: the job owner's own GenAI Studio key (plan §15); without it, the server's provider
 * @returns {Promise<import('../../../generator/src/run.js').GeneratorResult>}
 */
export async function runGeneratorInSandbox(job, { onStep = () => {}, cfg = config, run = runCommand, apiKey } = {}) {
  const hex = randomBytes(4).toString('hex');
  const name = `bg-gen-${hex}`; // OpenShell allows at most 19 characters
  const keyProvider = apiKey ? `bg-key-${hex}` : null;
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
        '--provider', keyProvider ?? cfg.GENERATOR_PROVIDER,
        '--policy', cfg.GENERATOR_POLICY_PATH,
        '--', 'sleep', String(limitSeconds + 120),
      ],
      { timeoutMs: 3 * 60 * 1000 },
    );
    if (created.code !== 0) return failed(`could not start the sandbox: ${lastLines(created.stderr || created.stdout)}`);

    const ran = await run(
      bin,
      ['sandbox', 'exec', '-n', name, '--no-tty', '--timeout', String(limitSeconds), '--', 'node', '/app/generator/src/run.js'],
      {
        input: JSON.stringify(job),
        timeoutMs: cfg.GENERATION_TIMEOUT_MS + 60_000,
        onStderrLine: (line) => {
          if (line.startsWith('STEP ')) onStep(line.slice(5));
          else if (line.startsWith('STEP~ ')) onStep(line.slice(6), { replace: true }); // replaces the last step
        },
      },
    );
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

const lastLines = (text) => text.trim().split('\n').filter((l) => !/^STEP~? /.test(l)).slice(-3).join(' | ').slice(0, 500);
