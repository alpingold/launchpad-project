#!/usr/bin/env node
// THE GENERATOR (plan §13i, F5). Runs inside the OpenShell sandbox, never on the server:
// that's where the GenAI Studio key is, and where freshly written games are played.
//
// One job is one STEP, and the admin approves between them. What a job may contain (its
// seven steps and every field) is described and checked in job.js: runJob checks every job
// there before it runs. A design step asks for a design or a change plan; a build step asks
// for the game file, then checks it (checkGame: the static check and a playtest in a headless
// browser) and shows the model the problems until it passes. Builds use EDIT MODE (plan §23):
// once there's a file, the model sends changes to it (edits.js). With "review": true, a
// passing build gets one REVIEW ROUND (plan §47), a step of its own after the build (runJob
// joins them), and what it found comes back as "review".
//
// The job is the first line of stdin. With "browserGate": "<token>", the server shares one
// browser between jobs: before each playtest the job asks for it on stderr and waits for the
// go on stdin (browserGate.js, plan §28).
//
// Progress lines go to stderr: "STEP ..." adds a step; "STEP~ ..." replaces the last one
// (how far a reply has streamed in, every ~15 s). The result is one JSON line on stdout:
//   design: { ok, model, design, attempts, error? }
//   build:  { ok, model, source, report, changelog, attempts, review?, error? }
//           Each build attempt keeps its code and check report (without screenshots, which
//           only the final report has), so a version's history can be read and studied later,
//           and its mode: "whole" (the model wrote the file) or "edits" (plan §23).

import { pathToFileURL } from 'node:url';
import { chat } from './llm.js';
import { makeChecklist, reviewGame, reviewCritical, reviewFinished, forCreator, fixRequest, CRITICAL } from './review.js';
import { extractGameFile, extractHeadings, extractChangelog, missingHeadings, copiedSections } from './extract.js';
import { applyReply, hasEdits, withoutEdits } from './edits.js';
import {
  designMessages,
  planMessages,
  remixDesignMessages,
  buildMessages,
  changeBuildMessages,
  remixBuildMessages,
  fixMessage,
  editsFailedMessage,
  missingHeadingsMessage,
  copiedSectionsMessage,
  designInstructions,
  headingsFormat,
  NO_CODE_MESSAGE,
  DESIGN_HEADINGS,
  PLAN_HEADINGS,
  MAX_REQUEST_LENGTH,
  MAX_WHOLE_FILE_LENGTH,
  MAX_GAME_BYTES,
} from './prompt.js';
import { reasoningEffortFor } from './models.js';
import { checkJob } from './job.js';
import { checkGame } from './check/checkGame.js';
import { NO_GATE, isGateToken, lineReader, stdinGate } from './browserGate.js';
import { describeProblem } from '../../server/src/games/frameGame.js';

/** One job: one step. Described and checked in job.js. @typedef {import('./job.js').GeneratorJob} GeneratorJob */

/**
 * One build attempt, as the result lists it. mode: how the model answered (plan §23). An
 * "edits" attempt whose edits didn't fit the file has no source; its report lists why.
 * For the edit stats: fix (the call asked to fix an earlier attempt, or was the review's fix),
 * noReply (the model wrote nothing: it ran out of room while thinking, or the call gave up on
 * empty replies; seconds null then) and editsApplied (an
 * "edits" reply only: whether its edits fit the file).
 * @typedef {{ attempt: number, mode?: 'whole' | 'edits', ok: boolean, problems: number, seconds: number | null,
 *   fix?: boolean, noReply?: boolean, editsApplied?: boolean,
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
 * @property {import('./review.js').CreatorReview | { error: string }} [review]  build with "review", and recheck
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
 * @param {unknown} untrusted  the job as it came in: checked first (checkJob, job.js)
 * @param {{ chatFn?: typeof chat, check?: typeof checkGame, onStep?: OnStep, browser?: typeof NO_GATE, onAttempt?: (attempt: object) => void }} [deps]
 *   browser: the gate around each browser check (browserGate.js); none by default
 *   onAttempt: hears about each attempt as soon as it's recorded
 * @returns {Promise<GeneratorResult>}
 */
export async function runJob(untrusted, deps = {}) {
  const checked = checkJob(untrusted);
  if (!checked.ok) return { ok: false, model: checked.model, attempts: [], error: checked.error };
  const { job, model } = checked;
  if (job.step === 'check') return checkUpload(job, deps);
  if (job.step === 'design') return design(job, model, deps);
  // The reviewer's two steps on their own (plan §47's experiments: review-builds, review-fix).
  if (job.step === 'checklist') return makeChecklist(job, model, deps);
  if (job.step === 'review') return reviewGame(job, model, deps);
  if (job.step === 'critical') return reviewCritical(job, model, deps);
  // Building and reviewing are separate steps, joined only here. A build with "review" that
  // passes gets a review round; "recheck" is the round alone, on a finished game.
  const built = job.step === 'build' ? await build(job, model, deps) : gameToRecheck(job, model);
  if (!built.ok || (job.step === 'build' && job.review !== true)) return built;
  return withReview(job, built, await reviewRound(job, built.source, model, deps));
}

/**
 * A recheck's game, as a build would have returned it: checkJob made sure there is one.
 * @param {GeneratorJob} job
 * @param {string} model
 * @returns {GeneratorResult}
 */
const gameToRecheck = (job, model) => ({ ok: true, model, source: job.change.source, report: null, changelog: null, attempts: [] });

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
  const messages = isPlan
    ? planMessages({ idea: job.idea, ...job.change }, job.redraft)
    : job.remix
      ? remixDesignMessages({ idea: job.idea, design: job.remix.design, request: job.remix.request }, job.redraft)
      : designMessages(job.idea, job.redraft);
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
    // A design whose sections copy their instructions (plan §55) is asked for again too.
    const copied = text && !isPlan && missing.length === 0 ? copiedSections(text, designInstructions()) : [];
    result.attempts.push({ attempt, seconds: reply.seconds, ok: missing.length + copied.length === 0, problems: missing.length + copied.length, usage: reply.usage, ...thinkingOf(job, reply) });
    if (text) result.design = text;
    if (missing.length + copied.length === 0) {
      onStep(`${what}: ready`);
      return { ...result, ok: true };
    }
    if (copied.length) onStep(`${what}: ${copied.length} section(s) repeat the instructions; asking again`);
    messages.push({ role: 'user', content: missing.length ? missingHeadingsMessage(missing) : copiedSectionsMessage(copied) });
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
  // A remix (plan §45b) writes the whole file from the start, like a first build, from the
  // original's code, whatever its size (no MAX_WHOLE_FILE_LENGTH: tried on Stowaways, 62 KB).
  const remix = job.remix ?? null;
  const remixJob = remix && { idea: job.idea, oldDesign: remix.design ?? null, design: job.design, source: remix.source };
  let edits = remix ? false : job.edits !== false;
  const plan = change?.plan ?? null;
  // The conversation is the prompt plus, after a failed attempt, ONLY that attempt and its
  // problems: earlier attempts are dropped. Each one can be a whole game (~10K tokens), and
  // the model's context is 65K (plan §13n): keeping them all would overflow by attempt 4.
  const prompt = change
    ? changeBuildMessages({ idea: job.idea, ...change }, plan, { edits })
    : remix
      ? remixBuildMessages(remixJob, { edits, briefThinking: job.briefThinking ?? true })
      : buildMessages(job.idea, job.design, { briefThinking: job.briefThinking ?? true, briefText: job.briefText });
  // A fix shows the model its last file as its own reply. For a change, that file replaces
  // the old one in the prompt (withCode: false), so the game is in the conversation once.
  // Fix requests leave the short-plan sentence out (plan §43 test 1: with it, fixes spiralled
  // into edits that didn't fit; without it, every broken first file was fixed in one round).
  const newGameFixPrompt = buildMessages(job.idea, job.design, { briefThinking: false });
  const fixPrompt = (asEdits) =>
    change
      ? changeBuildMessages({ idea: job.idea, ...change }, plan, { edits: asEdits, withCode: false })
      : remix
        ? remixBuildMessages(remixJob, { edits: asEdits, withCode: false })
        : newGameFixPrompt;
  const fixMessages = (source, reportText, asEdits) => [...fixPrompt(asEdits), { role: 'assistant', content: `\`\`\`html\n${source}\`\`\`` }, { role: 'user', content: fixMessage(reportText, { edits: asEdits }) }];

  let messages = prompt;
  /** The file edits apply to: the old game, then the last file that was checked. */
  let current = change ? change.source : remix ? remix.source : null;
  /** What the checks found in `current` (null: nothing yet, e.g. a change's old game). */
  let currentProblems = null;
  let failedInARow = 0;
  let changelog = null;
  const result = { ok: false, model, source: null, report: null, changelog: null, attempts: watched(onAttempt) };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Edits need a file to apply to: a new game's first attempt is always a whole file.
    const mode = edits && current !== null ? 'edits' : 'whole';
    const asking = `attempt ${attempt}/${maxAttempts}${mode === 'edits' ? ' (edits)' : ''}: asking ${model}`;
    onStep(asking);
    // The first request for the file can think until the context is full (plan §40): models.js
    // may give it its own effort.
    const step = messages === prompt ? 'build' : 'fix';
    const askedToFix = step === 'fix';
    let reply;
    try {
      reply = await chatFn(messages, { model, reasoningEffort: job.reasoningEffort ?? reasoningEffortFor(model, step), onRetry: onStep, onProgress: (p) => onStep(`${asking} (${progressText(p)})`, { replace: true }) });
    } catch (err) {
      // It gave up on empty replies (often the rate limit): the job fails, but the call is kept,
      // as one with no reply, for the edit stats.
      if (err.noReply) result.attempts.push({ attempt, mode, fix: askedToFix, noReply: true, seconds: null, usage: null, ok: false, problems: 1, source: null });
      if (!err.outOfRoom) return { ...result, error: err.message };
      // It thought until the context was full: a used-up attempt. The next one asks the same again.
      result.attempts.push({ attempt, mode, fix: askedToFix, noReply: true, seconds: err.seconds, usage: err.usage, ...thinkingOf(job, err), ok: false, problems: 1, outOfRoom: true, source: null });
      onStep(`attempt ${attempt}/${maxAttempts}: ${err.message}`);
      continue;
    }
    // The list of changes comes with the first answer that has one (fixes don't repeat it).
    if (change || remix) changelog ??= extractChangelog(withoutEdits(reply.content));

    let source;
    let attemptMode = mode;
    const record = (fields) =>
      result.attempts.push({ attempt, mode: attemptMode, fix: askedToFix, noReply: false, ...(attemptMode === 'edits' && { editsApplied: true }), seconds: reply.seconds, usage: reply.usage, ...thinkingOf(job, reply), ...fields });
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
        record({ ok: false, editsApplied: false, problems: problems.length, source: null, report: { ok: false, problems, warnings: [] } });
        onStep(`attempt ${attempt}/${maxAttempts}: ${problems.length} edit(s) didn't fit the file`);
        if (failedInARow >= 2 && current.length <= MAX_WHOLE_FILE_LENGTH) {
          edits = false;
          onStep('edits failed twice: asking for the whole file instead');
          const whole = remix ? remixBuildMessages(remixJob, { edits: false }) : changeBuildMessages({ idea: job.idea, ...change }, plan, { edits: false });
          messages = currentProblems === null ? whole : fixMessages(current, currentProblems, false);
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
    if ((change || remix) && result.changelog === null) result.changelog = changelog;

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
    messages = fixMessages(current, currentProblems, edits);
  }
  const outOfRoom = result.attempts.at(-1)?.outOfRoom ? ' (the last one ran out of room while thinking)' : '';
  return { ...result, error: `no passing game after ${maxAttempts} attempts${outOfRoom}` };
}

/** Attempts a review's fix gets (plan §47's test: every fix passed in 1 or 2). */
const FIX_ATTEMPTS = 3;

/**
 * What the review round reads: the game, its design, and the changes made since (the game
 * already has every change asked for, a build's own request too; a recheck's are all earlier).
 * @param {GeneratorJob} job
 * @param {string} source  the game that passed
 */
function reviewSubject(job, source) {
  const { change } = job;
  if (!change) return { idea: job.idea, design: job.design, changes: [], source };
  const changes = [...(change.earlierRequests ?? []), ...(job.step === 'build' ? [change.request] : [])];
  return { idea: job.idea, design: change.design ?? null, changes, source };
}

/**
 * The review's fix: a small change to the game that passed, whatever the job was (a remix's
 * too), keeping the job's own switches (edit mode, reasoning effort, kept thinking).
 * @param {GeneratorJob} job
 * @param {ReturnType<typeof reviewSubject>} game
 * @param {string} request  the critical bugs, as a change request
 * @returns {GeneratorJob}
 */
function fixJob(job, game, request) {
  const { remix: _remix, review: _review, ...switches } = job;
  const change = { request, source: game.source, design: game.design, earlierRequests: game.changes, plan: null };
  return { ...switches, step: 'build', maxAttempts: FIX_ATTEMPTS, change };
}

/**
 * The review round (plan §47), on a game that passed: the reviewer reads the code against the
 * design (and the changes since). Its CRITICAL bugs (a crash, or play that can't go on) go back
 * to the model as a small change, the way a creator's request would, and must pass the same
 * checks. It returns what the review found and the fix's build (fixBuild), passing or not (null
 * if no fix was tried); withReview decides what the version keeps.
 * @param {GeneratorJob} job
 * @param {string} source  the game that passed
 * @param {string} model
 * @returns {Promise<{ review: import('./review.js').CreatorReview | { error: string }, fixBuild: GeneratorResult | null }>}
 */
async function reviewRound(job, source, model, deps) {
  const { onStep = () => {} } = deps;
  const game = reviewSubject(job, source);
  onStep('review: reading the code against the design');
  const reviewed = await reviewFinished(game, model, { chatFn: deps.chatFn, onStep });
  if (!reviewed.ok) {
    onStep(`review: ${reviewed.error}`);
    return { review: { error: reviewed.error }, fixBuild: null };
  }
  // Crashes first: if they don't all fit in one request, those matter most.
  const critical = reviewed.bugs.filter((b) => CRITICAL.includes(b.severity)).sort((a, b) => CRITICAL.indexOf(a.severity) - CRITICAL.indexOf(b.severity));
  if (critical.length === 0) {
    onStep('review: no crashes or dead ends');
    return { review: forCreator(reviewed), fixBuild: null };
  }

  const { request, included } = fixRequest(critical, MAX_REQUEST_LENGTH);
  onStep(`review: ${critical.length} crash(es) or dead end(s): fixing ${included === critical.length ? 'them' : `${included} of them`}`);
  const fixBuild = await build(fixJob(job, game, request), model, deps);
  // The review's own `fix` says how it went, for the creator.
  if (!fixBuild.ok) {
    onStep("review: the fix didn't pass the checks, so the game stays as it was");
    return { review: { ...forCreator(reviewed), fix: { ok: false, error: fixBuild.error ?? 'unknown error' } }, fixBuild };
  }
  onStep('review: fixed, and the fixed game passed the checks');
  return { review: { ...forCreator(reviewed, critical.slice(0, included)), fix: { ok: true, changelog: fixBuild.changelog ?? null } }, fixBuild };
}

/**
 * The game that passed, with its review round: the review always comes along, and the fix's
 * attempts follow the build's, every one marked as a fix (its first call too). A fix that
 * passed replaces the game; one that didn't keeps the game as it was. A review that failed
 * never fails the job.
 * @param {GeneratorJob} job
 * @param {GeneratorResult} built  the game that passed (a recheck's: the finished game, report null)
 * @param {Awaited<ReturnType<typeof reviewRound>>} round
 * @returns {GeneratorResult}
 */
function withReview(job, built, { review, fixBuild }) {
  if (!fixBuild) return { ...built, review };
  const attempts = [...built.attempts, ...fixBuild.attempts.map((a) => ({ ...a, attempt: built.attempts.length + a.attempt, fix: true }))];
  if (!fixBuild.ok) return { ...built, attempts, review };
  // A recheck's only change is the fix, so its list of changes is the version's.
  const changelog = job.step === 'recheck' ? (fixBuild.changelog ?? null) : built.changelog;
  return { ...built, source: fixBuild.source, report: fixBuild.report, changelog, attempts, review };
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
 * The "check" step (plan §57): an uploaded game file, checked the way a build is (the static
 * check, then the playtest in a browser), with no model and no key. The server's own size limit
 * (1 MB) applies, not the 100 KB the AI is held to. Runs here, in the sandbox, because the
 * playtest runs the game.
 * @param {GeneratorJob} job  job.source: the uploaded file
 * @param {{ check?: typeof checkGame, onStep?: OnStep, browser?: typeof NO_GATE, onAttempt?: (attempt: object) => void }} deps
 * @returns {Promise<GeneratorResult>}
 */
async function checkUpload(job, { check = checkGame, onStep = () => {}, browser = NO_GATE, onAttempt }) {
  onStep(`checking the game (the static check, then ${PLAYTEST_SECONDS} s of play in a browser)`);
  await browser.acquire();
  let report;
  try {
    report = await check(job.source, { seconds: PLAYTEST_SECONDS, onStep: (text) => onStep(`  ${text}`) });
  } finally {
    browser.release();
  }
  const attempts = watched(onAttempt);
  attempts.push({ attempt: 1, mode: 'whole', ok: report.ok, problems: report.problems.length, source: job.source, report: withoutScreenshots(report) });
  onStep(report.ok ? 'passed the checks' : `${report.problems.length} problem(s)`);
  const result = { ok: report.ok, model: null, source: job.source, report, changelog: null, attempts };
  return report.ok ? result : { ...result, error: "it didn't pass the checks" };
}

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
