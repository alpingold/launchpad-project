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
//   Builds use EDIT MODE (plan §23): once there's a file, the model sends changes to it
//   (edits.js), not the whole file again. "edits": false turns it off.
//
// The job is the first line of stdin. With "browserGate": "<token>", the server shares one
// browser between jobs: before each playtest the job asks for it on stderr and waits for the
// go on stdin (browserGate.js, plan §28).
//
// Progress lines go to stderr: "STEP ..." adds a step; "STEP~ ..." replaces the last one
// (how far a reply has streamed in, every ~15 s). The result is one JSON line on stdout:
//   design: { ok, model, design, attempts, error? }
//   build:  { ok, model, source, report, changelog, attempts, error? }
//           Each build attempt keeps its code and check report (without screenshots, which
//           only the final report has), so a version's history can be read and studied later,
//           and its mode: "whole" (the model wrote the file) or "edits" (plan §23).

import { pathToFileURL } from 'node:url';
import { chat } from './llm.js';
import { extractGameFile, extractHeadings, extractChangelog, missingHeadings } from './extract.js';
import { applyReply, hasEdits, withoutEdits } from './edits.js';
import {
  designMessages,
  planMessages,
  buildMessages,
  changeBuildMessages,
  fixMessage,
  editsFailedMessage,
  missingHeadingsMessage,
  headingsFormat,
  BRIEF_VARIANTS,
  NO_CODE_MESSAGE,
  DESIGN_HEADINGS,
  PLAN_HEADINGS,
  MAX_IDEA_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_WHOLE_FILE_LENGTH,
  MAX_GAME_BYTES,
} from './prompt.js';
import { DEFAULT_MODEL, isAllowedModel, reasoningEffortFor } from './models.js';
import { checkGame } from './check/checkGame.js';
import { NO_GATE, isGateToken, lineReader, stdinGate } from './browserGate.js';
import { describeProblem } from '../../server/src/games/frameGame.js';

/**
 * One job: one step (see the top of this file). Comes from the server, so it's checked.
 * @typedef {Object} GeneratorJob
 * @property {'design' | 'build'} step
 * @property {string} idea
 * @property {string} [model]
 * @property {string} [design]            build: the approved design (a new game)
 * @property {{ request: string, source: string, design?: string | null, earlierRequests?: string[], plan?: string | null }} [change]
 *   a change to an existing game; build: `plan` is the approved plan (null: a small fix)
 * @property {{ draft: string, feedback: string }} [redraft]  design: a new draft of `draft`
 * @property {boolean} [examples]         design: add the example designs (off by default)
 * @property {boolean} [sizeLimit]        build: false leaves the 100 KB limit out of the prompt (plan §32's experiment)
 * @property {number} [maxAttempts]       build
 * @property {boolean} [edits]            build: false turns edit mode off (on by default, plan §23)
 * @property {'low' | 'medium' | 'xhigh'} [reasoningEffort]  for every step, instead of the model's own (models.js; plan §40's experiment)
 * @property {boolean} [briefThinking]    build: asks for a short plan before the file (on by default, plan §40)
 * @property {boolean} [fixBrief]          build: true keeps the short-plan sentence in fix requests (off by default, plan §43 test 1)
 * @property {boolean} [wholeOnParseError] build: after a file that doesn't parse, ask for a whole file, not edits (plan §43 test 1)
 * @property {'noart' | 'look' | 'art' | 'notricky' | 'nounclear'} [briefVariant]  build: a variant of that sentence (plan §43's experiments)
 * @property {boolean} [keepThinking]     each attempt keeps the model's thinking and whole reply (plan §38's look; off on the site)
 */

/**
 * One build attempt, as the result lists it. mode: how the model answered (plan §23). An
 * "edits" attempt whose edits didn't fit the file has no source; its report lists why.
 * @typedef {{ attempt: number, mode?: 'whole' | 'edits', ok: boolean, problems: number, seconds: number,
 *   usage: { prompt_tokens?: number, completion_tokens?: number } | null, finishReason?: string | null, toolCallChars?: number,
 *   thinking?: string, reply?: string, toolCalls?: string, outOfRoom?: true,
 *   source?: string | null, report?: import('../../server/src/games/frameGame.js').CheckReport }} AttemptResult
 */

/**
 * What a job returns (also what the server reads back from the sandbox).
 * @typedef {Object} GeneratorResult
 * @property {boolean} ok
 * @property {string | null} model
 * @property {AttemptResult[]} attempts
 * @property {string | null} [design]     design step
 * @property {string} [warning]           design step: e.g. a heading is missing
 * @property {string | null} [source]     build step: the last game file (passing or not)
 * @property {import('../../server/src/games/frameGame.js').CheckReport | null} [report]
 * @property {string | null} [changelog]  build step for a change: the model's list of changes
 * @property {string} [error]             why it stopped, if not ok
 */

/**
 * Progress: `replace` updates the last step instead of adding one (a streaming reply).
 * @typedef {(text: string, opts?: { replace?: boolean }) => void} OnStep
 */

export const DEFAULT_MAX_ATTEMPTS = 4;
/** A design missing headings gets one more try. */
const DESIGN_ATTEMPTS = 2;
/** How long the playtest plays each attempt (seconds). */
export const PLAYTEST_SECONDS = 15;

/**
 * Runs one job. Everything outside is passed in, so tests can use a fake model and checker.
 * @param {GeneratorJob} job  untrusted: checked here
 * @param {{ chatFn?: typeof chat, check?: typeof checkGame, onStep?: OnStep, browser?: typeof NO_GATE, onAttempt?: (attempt: object) => void }} [deps]
 *   browser: the gate around each browser check (browserGate.js); none by default
 *   onAttempt: hears about each attempt as soon as it's recorded
 * @returns {Promise<GeneratorResult>}
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
    // Without edit mode, the old game and the new one must both fit (prompt.js explains the numbers).
    const limit = job.edits === false ? MAX_WHOLE_FILE_LENGTH : MAX_SOURCE_LENGTH;
    if (change.source.length > limit) {
      return fail(`the game is too big for the AI to change (${Math.round(change.source.length / 1024)} KB; at most ${limit / 1024} KB fits in the model's context)`);
    }
  }
  if (redraft !== undefined && (typeof redraft?.draft !== 'string' || !isText(redraft.feedback, 3))) {
    return fail('a new draft needs the last draft and what to change');
  }
  if (job.examples !== undefined && typeof job.examples !== 'boolean') return fail('examples must be true or false');
  if (job.edits !== undefined && typeof job.edits !== 'boolean') return fail('edits must be true or false');
  if (job.sizeLimit !== undefined && typeof job.sizeLimit !== 'boolean') return fail('sizeLimit must be true or false');
  if (job.keepThinking !== undefined && typeof job.keepThinking !== 'boolean') return fail('keepThinking must be true or false');
  if (job.reasoningEffort !== undefined && !REASONING_EFFORTS.includes(job.reasoningEffort)) return fail(`reasoningEffort must be one of ${REASONING_EFFORTS.join(', ')}`);
  if (job.briefThinking !== undefined && typeof job.briefThinking !== 'boolean') return fail('briefThinking must be true or false');
  for (const flag of ['fixBrief', 'wholeOnParseError']) {
    if (job[flag] !== undefined && typeof job[flag] !== 'boolean') return fail(`${flag} must be true or false`);
  }
  if (job.briefVariant !== undefined && !Object.hasOwn(BRIEF_VARIANTS, job.briefVariant)) return fail(`briefVariant must be one of ${Object.keys(BRIEF_VARIANTS).join(', ')}`);

  if (job.step === 'design') return design(job, model, deps);
  if (job.step === 'build') {
    if (change === undefined && typeof job.design !== 'string') return fail('building needs the approved design');
    return build(job, model, deps);
  }
  return fail('the step must be "design" or "build"');
}

/**
 * The list of attempts: an ordinary array that also tells `onAttempt` about each one as it's
 * added, so a job that's stopped before it ends still leaves its attempts behind (plan §40).
 * @param {((attempt: object) => void) | undefined} onAttempt
 */
function watched(onAttempt) {
  const attempts = [];
  if (onAttempt) {
    attempts.push = (...added) => {
      for (const a of added) onAttempt(a);
      return Array.prototype.push.apply(attempts, added);
    };
  }
  return attempts;
}

/**
 * For an attempt's record: why the reply stopped and how much came as tool calls (always:
 * they're short), and the thinking, whole reply and tool calls themselves when the job asks.
 */
const thinkingOf = (job, reply) => ({
  finishReason: reply.finishReason ?? null,
  ...(reply.toolCalls && { toolCallChars: reply.toolCalls.length }),
  ...(job.keepThinking && { thinking: reply.thinking ?? '', reply: reply.content ?? '', ...(reply.toolCalls && { toolCalls: reply.toolCalls }) }),
});

/** What qwen3.8:27b on GenAI Studio takes (plan §38). */
const REASONING_EFFORTS = ['low', 'medium', 'xhigh'];

const isText = (value, min) => typeof value === 'string' && value.trim().length >= min && value.length <= MAX_IDEA_LENGTH;

/**
 * Step 1: a design (or a change plan). One model call, plus one retry if headings are missing.
 * @param {GeneratorJob} job
 * @param {string} model
 * @param {{ chatFn?: typeof chat, onStep?: OnStep }} deps
 * @returns {Promise<GeneratorResult>}
 */
async function design(job, model, { chatFn = chat, onStep = () => {}, onAttempt }) {
  const isPlan = job.change !== undefined;
  const what = isPlan ? 'plan' : 'design';
  const headings = isPlan ? PLAN_HEADINGS : DESIGN_HEADINGS;
  const messages = isPlan ? planMessages({ idea: job.idea, ...job.change }, job.redraft) : designMessages(job.idea, job.redraft, { examples: job.examples ?? false });
  const result = { ok: false, model, design: null, attempts: watched(onAttempt) };

  for (let attempt = 1; attempt <= DESIGN_ATTEMPTS; attempt++) {
    const asking = `${what}${attempt > 1 ? ` (try ${attempt})` : ''}: asking ${model}`;
    onStep(asking);
    let reply;
    try {
      reply = await chatFn(messages, {
        model,
        reasoningEffort: job.reasoningEffort ?? reasoningEffortFor(model, 'design'),
        responseFormat: headingsFormat(what),
        onRetry: onStep,
        onProgress: (p) => onStep(`${asking} (${progressText(p)})`, { replace: true }),
      });
    } catch (err) {
      if (!err.outOfRoom) return { ...result, error: err.message };
      result.attempts.push({ attempt, seconds: err.seconds, ok: false, problems: 1, outOfRoom: true, usage: err.usage, ...thinkingOf(job, err) });
      onStep(`${what}: ${err.message}`);
      continue;
    }
    messages.push({ role: 'assistant', content: reply.content });
    const text = extractHeadings(reply.content, headings, isPlan ? 'Change: ' : '');
    const missing = text ? missingHeadings(text, headings) : headings;
    result.attempts.push({ attempt, seconds: reply.seconds, ok: missing.length === 0, problems: missing.length, usage: reply.usage, ...thinkingOf(job, reply) });
    if (text) result.design = text;
    if (missing.length === 0) {
      onStep(`${what}: ready`);
      return { ...result, ok: true };
    }
    messages.push({ role: 'user', content: missingHeadingsMessage(missing) });
  }
  // A design with a heading missing is still worth showing: the admin can fix it by hand.
  if (result.design) return { ...result, ok: true, warning: `the ${what} is missing some headings` };
  if (result.attempts.at(-1)?.outOfRoom) return { ...result, error: `the model ran out of room while thinking and wrote no ${what}` };
  return { ...result, error: `the model wrote no ${what}` };
}

/**
 * Step 2: the game file, through the check → fix loop.
 *
 * Edit mode (plan §23): once there is a file (a change's old game, or a first build's
 * failed attempt), the model replies with EDITS to it (edits.js), not the whole file: much
 * shorter replies, room for bigger games, and no chance to garble code it wasn't asked to
 * touch. If its edits can't be applied twice in a row, it's asked for the whole file instead
 * (today's way), as long as the game is small enough for that; it stays that way for the
 * rest of the job. job.edits === false turns edit mode off (to compare the two, plan §23).
 *
 * @param {GeneratorJob} job
 * @param {string} model
 * @param {{ chatFn?: typeof chat, check?: typeof checkGame, onStep?: OnStep, browser?: typeof NO_GATE }} deps
 * @returns {Promise<GeneratorResult>}
 */
async function build(job, model, { chatFn = chat, check = checkGame, onStep = () => {}, browser = NO_GATE, onAttempt }) {
  const maxAttempts = job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const { change } = job;
  let edits = job.edits !== false;
  const plan = change?.plan ?? null;
  // The conversation is the prompt plus, after a failed attempt, ONLY that attempt and its
  // problems: earlier attempts are dropped. Each one can be a whole game (~10K tokens), and
  // the model's context is 65K (plan §13n): keeping them all would overflow by attempt 4.
  const prompt = change ? changeBuildMessages({ idea: job.idea, ...change }, plan, { edits }) : buildMessages(job.idea, job.design, { sizeLimit: job.sizeLimit ?? true, briefThinking: job.briefThinking ?? true, briefVariant: job.briefVariant });
  // A fix shows the model its last file as its own reply. For a change, that file replaces
  // the old one in the prompt (withCode: false), so the game is in the conversation once.
  // Fix requests leave the short-plan sentence out (plan §43 test 1: with it, fixes spiralled
  // into edits that didn't fit; without it, every broken first file was fixed in one round).
  // job.fixBrief: true keeps it, to compare.
  const newGameFixPrompt = job.fixBrief === true ? prompt : buildMessages(job.idea, job.design, { sizeLimit: job.sizeLimit ?? true, briefThinking: false });
  const fixPrompt = (asEdits) => (change ? changeBuildMessages({ idea: job.idea, ...change }, plan, { edits: asEdits, withCode: false }) : newGameFixPrompt);
  const fixMessages = (source, reportText, asEdits) => [...fixPrompt(asEdits), { role: 'assistant', content: `\`\`\`html\n${source}\`\`\`` }, { role: 'user', content: fixMessage(reportText, { edits: asEdits }) }];

  let messages = prompt;
  /** The file edits apply to: the old game, then the last file that was checked. */
  let current = change ? change.source : null;
  /** What the checks found in `current` (null: nothing yet, e.g. a change's old game). */
  let currentProblems = null;
  let failedInARow = 0;
  /** Plan §43 test 1 (job.wholeOnParseError): the last file didn't parse, so ask for a whole one. */
  let wholeNext = false;
  let changelog = null;
  const result = { ok: false, model, source: null, report: null, changelog: null, attempts: watched(onAttempt) };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Edits need a file to apply to: a new game's first attempt is always a whole file.
    const mode = edits && current !== null && !wholeNext ? 'edits' : 'whole';
    wholeNext = false;
    const asking = `attempt ${attempt}/${maxAttempts}${mode === 'edits' ? ' (edits)' : ''}: asking ${model}`;
    onStep(asking);
    let reply;
    try {
      // The first request for the file can think until the context is full (plan §40): models.js
      // may give it its own effort.
      const step = messages === prompt ? 'build' : 'fix';
      reply = await chatFn(messages, { model, reasoningEffort: job.reasoningEffort ?? reasoningEffortFor(model, step), onRetry: onStep, onProgress: (p) => onStep(`${asking} (${progressText(p)})`, { replace: true }) });
    } catch (err) {
      if (!err.outOfRoom) return { ...result, error: err.message };
      // It thought until the context was full: a used-up attempt. The next one asks the same again.
      result.attempts.push({ attempt, mode, seconds: err.seconds, usage: err.usage, ...thinkingOf(job, err), ok: false, problems: 1, outOfRoom: true, source: null });
      onStep(`attempt ${attempt}/${maxAttempts}: ${err.message}`);
      continue;
    }
    // The list of changes comes with the first answer that has one (fixes don't repeat it).
    if (change) changelog ??= extractChangelog(withoutEdits(reply.content));

    let source;
    let attemptMode = mode;
    const record = (fields) => result.attempts.push({ attempt, mode: attemptMode, seconds: reply.seconds, usage: reply.usage, ...thinkingOf(job, reply), ...fields });
    if (mode === 'edits' && !hasEdits(reply.content) && extractGameFile(reply.content)) {
      // Asked for edits, sent the whole file anyway: that's fine, use it.
      source = extractGameFile(reply.content);
      attemptMode = 'whole';
    } else if (mode === 'edits') {
      const applied = applyReply(current, reply.content);
      if (!applied.ok) {
        // Nothing was applied: the file is as it was. Say what didn't fit, and ask again.
        failedInARow += 1;
        const problems = applied.failures;
        record({ ok: false, problems: problems.length, source: null, report: { ok: false, problems, warnings: [] } });
        onStep(`attempt ${attempt}/${maxAttempts}: ${problems.length} edit(s) didn't fit the file`);
        if (failedInARow >= 2 && current.length <= MAX_WHOLE_FILE_LENGTH) {
          edits = false;
          onStep('edits failed twice: asking for the whole file instead');
          messages = currentProblems === null ? changeBuildMessages({ idea: job.idea, ...change }, plan, { edits: false }) : fixMessages(current, currentProblems, false);
        } else {
          messages = [...messages, { role: 'assistant', content: reply.content }, { role: 'user', content: editsFailedMessage(problems) }];
        }
        continue;
      }
      source = applied.source;
    } else {
      source = extractGameFile(reply.content);
    }
    failedInARow = 0;

    if (!source) {
      const report = { ok: false, problems: ['The reply had no game file.'], warnings: [] };
      record({ ok: false, problems: 1, source: null, report });
      messages = [...messages, { role: 'assistant', content: reply.content }, { role: 'user', content: NO_CODE_MESSAGE }];
      continue;
    }
    if (change && result.changelog === null) result.changelog = changelog;

    onStep(`attempt ${attempt}/${maxAttempts}: checking the game (static check, then ${PLAYTEST_SECONDS} s of play in a browser)`);
    // One browser at a time across jobs (plan §28): wait for the slot, and always give it back.
    await browser.acquire();
    let report;
    try {
      report = await checkWithSize(source, check, onStep);
    } finally {
      browser.release();
    }
    result.source = source;
    result.report = report;
    record({ ok: report.ok, problems: report.problems.length, source, report: withoutScreenshots(report) });
    if (report.ok) {
      onStep(`attempt ${attempt}/${maxAttempts}: passed`);
      return { ...result, ok: true };
    }
    onStep(`attempt ${attempt}/${maxAttempts}: ${report.problems.length} problem(s)`);
    current = source;
    currentProblems = formatReport(report);
    // Only the game file goes back (not the model's chatter around it), to keep it short.
    wholeNext = job.wholeOnParseError === true && report.problems.some((p) => p?.rule === 'syntax');
    messages = fixMessages(current, currentProblems, edits && !wholeNext);
  }
  const outOfRoom = result.attempts.at(-1)?.outOfRoom ? ' (the last one ran out of room while thinking)' : '';
  return { ...result, error: `no passing game after ${maxAttempts} attempts${outOfRoom}` };
}

/** A report without the playtest's screenshots (only the final report keeps them: they're large). */
function withoutScreenshots(report) {
  if (!report.playtest?.screenshots) return report;
  const { screenshots, ...playtest } = report.playtest;
  return { ...report, playtest };
}

/** "thinking: 1,200 tokens, writing: 3,400" */
const progressText = ({ thinking, writing }) => `thinking ${thinking.toLocaleString('en-US')} tokens, writing ${writing.toLocaleString('en-US')}`;

/**
 * checkGame, plus the generator's own size limit (the rulebook's 100 KB).
 * @param {string} source
 * @param {typeof checkGame} check
 * @param {OnStep} onStep
 */
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

// Run as a program: the job is the first line of stdin; print the result.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = lineReader(process.stdin);
  let job;
  try {
    job = JSON.parse((await lines.next()) ?? '');
  } catch {
    job = null;
  }
  const write = (text) => process.stderr.write(text);
  const browser = isGateToken(job?.browserGate) ? stdinGate(job.browserGate, { lines, write }) : NO_GATE;
  // One line per step: a line break inside a step (say, from a game's error message) would
  // otherwise start a new line the server reads on its own.
  const onStep = (text, { replace = false } = {}) => write(`STEP${replace ? '~' : ''} ${String(text).replace(/[\r\n]+/g, ' ')}\n`);
  // keepThinking jobs (experiments) also send each attempt as it ends, on one line (JSON has
  // no raw line breaks), so a run that's stopped keeps what it has.
  const onAttempt = job?.keepThinking === true ? (a) => write(`ATTEMPT ${JSON.stringify(a)}\n`) : undefined;
  let result;
  try {
    result = await runJob(job, { onStep, browser, onAttempt });
  } catch (err) {
    result = { ok: false, model: job?.model ?? null, attempts: [], error: err.message };
  }
  // Exit only once the result is fully written: `openshell sandbox exec` passes stdout on
  // asynchronously, and exiting right away cut a built game's result off at 64 KB (F5).
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(result.ok ? 0 : 1));
}
