#!/usr/bin/env node
// THE GENERATOR (plan §13i, F5). Runs inside the OpenShell sandbox, never on the server:
// that's where the GenAI Studio key is, and where freshly written games are played.
//
// One job is one STEP, and the admin approves between them:
//
//   { "step": "design", "idea": "...", "model": "..." }
//       → a design document. With "redraft": { "draft", "feedback" }: a new draft.
//         "examples": true adds the example designs to the prompt (off by default, plan §13n).
//   { "step": "design", ..., "change": { "request", "source", "design"?, "earlierRequests"? } }
//       → a change plan for an existing game (with "redraft" too).
//   { "step": "build", "idea": "...", "design": "<the approved design>" }
//       → a game file: ask the model → check it (checkGame: the static check and a playtest
//         in a headless browser) → if it fails, show the model the problems and ask again.
//   { "step": "build", ..., "change": { ..., "plan": "<the approved plan>" | null } }
//       → the changed game file (plan null: a small fix with no plan).
//
// Progress lines go to stderr: "STEP ..." adds a step; "STEP~ ..." replaces the last one
// (how far a reply has streamed in, every ~15 s). The result is one JSON line on stdout:
//   design: { ok, model, design, attempts, error? }
//   build:  { ok, model, source, report, changelog, attempts, error? }
//           Each build attempt keeps its code and check report (without screenshots, which
//           only the final report has), so a version's history can be read and studied later.

import { pathToFileURL } from 'node:url';
import { chat } from './llm.js';
import { extractGameFile, extractDesign, extractChangelog, missingHeadings } from './extract.js';
import {
  designMessages,
  planMessages,
  buildMessages,
  changeBuildMessages,
  fixMessage,
  missingHeadingsMessage,
  NO_CODE_MESSAGE,
  DESIGN_HEADINGS,
  PLAN_HEADINGS,
  MAX_IDEA_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_GAME_BYTES,
} from './prompt.js';
import { DEFAULT_MODEL, isAllowedModel } from './models.js';
import { checkGame } from './check/checkGame.js';
import { describeProblem } from '../../server/src/games/frameGame.js';

export const DEFAULT_MAX_ATTEMPTS = 4;
/** A design missing headings gets one more try. */
const DESIGN_ATTEMPTS = 2;
/** How long the playtest plays each attempt (seconds). */
export const PLAYTEST_SECONDS = 15;

/**
 * Runs one job. Everything outside is passed in, so tests can use a fake model and checker.
 * @param {object} job  see the top of this file (untrusted: checked here)
 * @param {{ chatFn?: typeof chat, check?: typeof checkGame, onStep?: (text: string) => void }} [deps]
 */
export async function runJob(job, deps = {}) {
  const model = job?.model ?? DEFAULT_MODEL;
  const fail = (error) => ({ ok: false, model, attempts: [], error });
  if (!job || typeof job !== 'object') return fail('the job must be an object');
  if (!isAllowedModel(model)) return fail(`unknown model ${JSON.stringify(model)}`);
  if (!isText(job.idea, 10)) return fail(`the game idea must be 10–${MAX_IDEA_LENGTH} characters`);
  const { change, redraft } = job;
  if (change !== undefined) {
    if (!isText(change?.request, 10)) return fail(`the change request must be 10–${MAX_IDEA_LENGTH} characters`);
    if (typeof change.source !== 'string' || change.source.length === 0) return fail('a change needs the current game file');
    if (change.source.length > MAX_SOURCE_LENGTH) {
      return fail(`the game is too big for the AI to change (${Math.round(change.source.length / 1000)}K characters; at most ${MAX_SOURCE_LENGTH / 1000}K fit in the model's context)`);
    }
  }
  if (redraft !== undefined && (typeof redraft?.draft !== 'string' || !isText(redraft.feedback, 3))) {
    return fail('a new draft needs the last draft and what to change');
  }
  if (job.examples !== undefined && typeof job.examples !== 'boolean') return fail('examples must be true or false');

  if (job.step === 'design') return design(job, model, deps);
  if (job.step === 'build') {
    if (change === undefined && typeof job.design !== 'string') return fail('building needs the approved design');
    return build(job, model, deps);
  }
  return fail('the step must be "design" or "build"');
}

const isText = (value, min) => typeof value === 'string' && value.trim().length >= min && value.length <= MAX_IDEA_LENGTH;

/** Step 1: a design (or a change plan). One model call, plus one retry if headings are missing. */
async function design(job, model, { chatFn = chat, onStep = () => {} }) {
  const isPlan = job.change !== undefined;
  const what = isPlan ? 'plan' : 'design';
  const headings = isPlan ? PLAN_HEADINGS : DESIGN_HEADINGS;
  const messages = isPlan ? planMessages({ idea: job.idea, ...job.change }, job.redraft) : designMessages(job.idea, job.redraft, { examples: job.examples ?? false });
  const result = { ok: false, model, design: null, attempts: [] };

  for (let attempt = 1; attempt <= DESIGN_ATTEMPTS; attempt++) {
    const asking = `${what}${attempt > 1 ? ` (try ${attempt})` : ''}: asking ${model}`;
    onStep(asking);
    let reply;
    try {
      reply = await chatFn(messages, { model, onRetry: onStep, onProgress: (p) => onStep(`${asking} (${progressText(p)})`, { replace: true }) });
    } catch (err) {
      return { ...result, error: err.message };
    }
    messages.push({ role: 'assistant', content: reply.content });
    const text = extractDesign(reply.content);
    const missing = text ? missingHeadings(text, headings) : headings;
    result.attempts.push({ attempt, seconds: reply.seconds, ok: missing.length === 0, problems: missing.length, usage: reply.usage });
    if (text) result.design = text;
    if (missing.length === 0) {
      onStep(`${what}: ready`);
      return { ...result, ok: true };
    }
    messages.push({ role: 'user', content: missingHeadingsMessage(missing) });
  }
  // A design with a heading missing is still worth showing: the admin can fix it by hand.
  if (result.design) return { ...result, ok: true, warning: `the ${what} is missing some headings` };
  return { ...result, error: `the model wrote no ${what}` };
}

/** Step 2: the game file, through the check → fix loop. */
async function build(job, model, { chatFn = chat, check = checkGame, onStep = () => {} }) {
  const maxAttempts = job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const { change } = job;
  // The conversation is the prompt plus, after a failed attempt, ONLY that attempt and its
  // problems: earlier attempts are dropped. Each one is a whole game (~10K tokens), and the
  // model's context is 65K (plan §13n): keeping them all would overflow by attempt 4.
  const prompt = change ? changeBuildMessages({ idea: job.idea, ...change }, change.plan ?? null) : buildMessages(job.idea, job.design);
  let messages = prompt;
  const result = { ok: false, model, source: null, report: null, changelog: null, attempts: [] };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const asking = `attempt ${attempt}/${maxAttempts}: asking ${model}`;
    onStep(asking);
    let reply;
    try {
      reply = await chatFn(messages, { model, onRetry: onStep, onProgress: (p) => onStep(`${asking} (${progressText(p)})`, { replace: true }) });
    } catch (err) {
      return { ...result, error: err.message };
    }

    const source = extractGameFile(reply.content);
    // The list of changes comes with the first answer that has code (fixes don't repeat it).
    if (change && source && result.changelog === null) result.changelog = extractChangelog(reply.content);
    if (!source) {
      const report = { ok: false, problems: ['The reply had no game file.'], warnings: [] };
      result.attempts.push({ attempt, seconds: reply.seconds, ok: false, problems: 1, usage: reply.usage, source: null, report });
      messages = [...prompt, { role: 'assistant', content: reply.content }, { role: 'user', content: NO_CODE_MESSAGE }];
      continue;
    }

    onStep(`attempt ${attempt}/${maxAttempts}: checking the game (static check, then ${PLAYTEST_SECONDS} s of play in a browser)`);
    const report = await checkWithSize(source, check, onStep);
    result.source = source;
    result.report = report;
    result.attempts.push({ attempt, seconds: reply.seconds, ok: report.ok, problems: report.problems.length, usage: reply.usage, source, report: withoutScreenshots(report) });
    if (report.ok) {
      onStep(`attempt ${attempt}/${maxAttempts}: passed`);
      return { ...result, ok: true };
    }
    onStep(`attempt ${attempt}/${maxAttempts}: ${report.problems.length} problem(s)`);
    // Only the game file goes back (not the model's chatter around it), to keep it short.
    messages = [...prompt, { role: 'assistant', content: `\`\`\`html\n${source}\`\`\`` }, { role: 'user', content: fixMessage(formatReport(report)) }];
  }
  return { ...result, error: `no passing game after ${maxAttempts} attempts` };
}

/** A report without the playtest's screenshots (only the final report keeps them: they're large). */
function withoutScreenshots(report) {
  if (!report.playtest?.screenshots) return report;
  const { screenshots, ...playtest } = report.playtest;
  return { ...report, playtest };
}

/** "thinking: 1,200 tokens, writing: 3,400" */
const progressText = ({ thinking, writing }) => `thinking ${thinking.toLocaleString('en-US')} tokens, writing ${writing.toLocaleString('en-US')}`;

/** checkGame, plus the generator's own size limit (the rulebook's 100 KB). */
async function checkWithSize(source, check, onStep) {
  const report = await check(source, { seconds: PLAYTEST_SECONDS, onStep: (text) => onStep(`  ${text}`) });
  const bytes = Buffer.byteLength(source);
  if (bytes <= MAX_GAME_BYTES) return report;
  const problem = { rule: 'size', message: `The file is ${Math.round(bytes / 1024)} KB; the limit is ${MAX_GAME_BYTES / 1024} KB. Make it shorter.` };
  return { ...report, ok: false, problems: [...report.problems, problem] };
}

/**
 * A report as text for the model: each problem with where it happened and its line, then
 * the warnings (worth fixing, but they don't fail the game).
 */
export function formatReport(report) {
  const line = (p) => {
    if (typeof p === 'string') return `- ${p}`;
    const where = [p.screen ? `on the ${p.screen}` : null, p.count > 1 ? `${p.count} times` : null].filter(Boolean).join(', ');
    return `- ${describeProblem(p).replace(/\n\s+/, '\n    code: ')}${where ? ` (${where})` : ''}`;
  };
  const parts = [`Problems (each must be fixed):\n${report.problems.map(line).join('\n')}`];
  if (report.warnings?.length) parts.push(`Also worth fixing:\n${report.warnings.map(line).join('\n')}`);
  return parts.join('\n\n');
}

// Run as a program: read the job from stdin, print the result.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let job;
  try {
    job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    job = null;
  }
  const result = await runJob(job, { onStep: (text, { replace = false } = {}) => process.stderr.write(`STEP${replace ? '~' : ''} ${text}\n`) });
  // Exit only once the result is fully written: `openshell sandbox exec` passes stdout on
  // asynchronously, and exiting right away cut a built game's result off at 64 KB (F5).
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(result.ok ? 0 : 1));
}
