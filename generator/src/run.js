#!/usr/bin/env node
// THE GENERATOR (plan §11, A4). Runs inside the OpenShell sandbox, never on the server.
//
//   echo '{"idea": "...", "model": "gpt-oss:120b"}' | node generator/src/run.js
//
// The loop: ask the model for a game → run the test harness on it → if it fails, show the
// model the problems and ask again (up to `maxAttempts` times). The freshly written code
// only ever runs here, in the sandbox, inside the harness's own locked-down process.
//
// Progress lines ("STEP ...") go to stderr. The result is one JSON line on stdout:
//   { ok, model, source, report, attempts: [...], error? }

import { pathToFileURL } from 'node:url';
import { chat } from './llm.js';
import { extractCode } from './extract.js';
import { firstMessages, fixMessage, NO_CODE_MESSAGE, MAX_IDEA_LENGTH } from './prompt.js';
import { DEFAULT_MODEL, isAllowedModel } from './models.js';
import { checkGameSourceIsolated, formatReport } from '../../server/src/games/harness/index.js';

export const DEFAULT_MAX_ATTEMPTS = 4;

/**
 * @typedef {Object} GenerateResult
 * @property {boolean} ok              true if the final code passed every check
 * @property {string} model
 * @property {string | null} source    the last code the model wrote (passing or not)
 * @property {object | null} report    the harness report for that code
 * @property {{ attempt: number, seconds: number, ok: boolean, problems: number, usage: object | null }[]} attempts
 * @property {string} [error]          why it stopped, if not ok
 */

/**
 * Generates a game. Everything outside is passed in, so tests can use a fake model.
 * @param {{ idea: string, model?: string, maxAttempts?: number }} job
 * @param {{ chatFn?: typeof chat, check?: typeof checkGameSourceIsolated, onStep?: (text: string) => void }} [deps]
 * @returns {Promise<GenerateResult>}
 */
export async function generateGame(job, { chatFn = chat, check = checkGameSourceIsolated, onStep = () => {} } = {}) {
  const model = job.model ?? DEFAULT_MODEL;
  const maxAttempts = job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const result = { ok: false, model, source: null, report: null, attempts: [] };

  if (typeof job.idea !== 'string' || job.idea.trim().length < 10 || job.idea.length > MAX_IDEA_LENGTH) {
    return { ...result, error: `the game idea must be 10–${MAX_IDEA_LENGTH} characters` };
  }
  if (!isAllowedModel(model)) return { ...result, error: `unknown model ${JSON.stringify(model)}` };

  const messages = firstMessages(job.idea);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onStep(`attempt ${attempt}/${maxAttempts}: asking ${model}`);
    let reply;
    try {
      reply = await chatFn(messages, { model, onRetry: onStep });
    } catch (err) {
      return { ...result, error: err.message };
    }
    messages.push({ role: 'assistant', content: reply.content });

    const source = extractCode(reply.content);
    if (!source) {
      result.attempts.push({ attempt, seconds: reply.seconds, ok: false, problems: 1, usage: reply.usage });
      messages.push({ role: 'user', content: NO_CODE_MESSAGE });
      continue;
    }

    onStep(`attempt ${attempt}/${maxAttempts}: testing the game`);
    const report = await check(source, { sourceName: 'game.js' });
    result.source = source;
    result.report = report;
    result.attempts.push({ attempt, seconds: reply.seconds, ok: report.ok, problems: report.problems.length, usage: reply.usage });
    if (report.ok) {
      onStep(`attempt ${attempt}/${maxAttempts}: passed`);
      return { ...result, ok: true };
    }
    onStep(`attempt ${attempt}/${maxAttempts}: ${report.problems.length} problem(s)`);
    messages.push({ role: 'user', content: fixMessage(formatReport(report, 'game.js')) });
  }
  return { ...result, error: `no passing game after ${maxAttempts} attempts` };
}

// Run as a program: read the job from stdin, print the result.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let job;
  try {
    job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    job = {};
  }
  const result = await generateGame(job, { onStep: (text) => process.stderr.write(`STEP ${text}\n`) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}
