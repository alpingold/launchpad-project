// THE JOB: what one step sent to the generator may contain, and the check every job goes
// through before it runs (run.js). The job comes from outside the sandbox (the site, or an
// experiment script), so it's untrusted: checkJob refuses a bad one with a reason, before
// any model call or browser.
//
// The typedef below is the one description of a job; the generator's top comment points here.

import {
  MIN_IDEA_LENGTH,
  MIN_FEEDBACK_LENGTH,
  MAX_IDEA_LENGTH,
  MAX_REQUEST_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_WHOLE_FILE_LENGTH,
} from './prompt.js';
import { DEFAULT_MODEL, isAllowedModel } from './models.js';

/**
 * One job: one step. The site sends the first four steps; "checklist", "review" and
 * "critical" are the reviewer's steps on their own, for plan §47's experiments
 * (server/scripts/review-builds.js, review-fix.js).
 *
 * - "design": a design document for `idea` (plan §13i). With `change`: a change plan for an
 *   existing game. With `remix`: a remix's whole design, the original's with `remix.request`
 *   worked in (plan §45b). With `redraft`: a new draft of the last one, with the feedback.
 * - "build": a game file for the approved `design`, through the check → fix loop. With
 *   `change`: the changed game (`change.plan` the approved plan; null: a small fix with no
 *   plan). With `remix`: the original's code rewritten for the remix's approved `design`.
 * - "recheck": another review round on a finished game, `change.source` ("Review again").
 * - "check": an uploaded file, `source`, checked with no model (plan §57); nothing else matters.
 * - "checklist": the reviewer's checklist for `design`.
 * - "review": the reviewer's review of `source` against `checklist`.
 * - "critical": only the crashes and dead ends in `source`, against `design`.
 *
 * @typedef {Object} GeneratorJob
 * @property {'design' | 'build' | 'recheck' | 'check' | 'checklist' | 'review' | 'critical'} step
 * @property {string} [idea]              every step but "check": the game's idea
 * @property {string} [model]             one of models.js (DEFAULT_MODEL if left out)
 * @property {string} [design]            build: the approved design; checklist, critical: the design to check against
 * @property {string} [source]            check: the uploaded file; review, critical: the game file
 * @property {{ request: string, source: string, design?: string | null, earlierRequests?: string[], plan?: string | null }} [change]
 *   a change to an existing game: the request, its current file, its design and the requests
 *   since; build: `plan` is the approved plan (null: a small fix)
 * @property {{ source: string, design?: string | null, request?: string }} [remix]
 *   a remix (plan §45b): the original's file and design; design step: `request`, what the remix changes
 * @property {{ draft: string, feedback: string }} [redraft]  design: a new draft of `draft`
 * @property {boolean} [review]           build: a passing game gets a review round (plan §47; the site turns it on)
 * @property {string} [browserGate]       the token for the browser shared between jobs (browserGate.js, plan §28)
 * @property {number} [maxAttempts]       build: how many tries before giving up
 * @property {boolean} [edits]            build: false turns edit mode off (on by default, plan §23)
 * @property {'low' | 'medium' | 'xhigh'} [reasoningEffort]  for every step, instead of the model's own (models.js; plan §40's experiment)
 * @property {boolean} [briefThinking]    build: asks for a short plan before the file (on by default, plan §40); critical: a short one first
 * @property {string} [briefText]         build: the wording of that ask, instead of the usual (plan §40's experiment)
 * @property {boolean} [keepThinking]     each attempt keeps the model's thinking and whole reply (plan §38's look; off on the site)
 * @property {{ id: string, area: string, text: string }[]} [checklist]  review: the checklist to review against
 * @property {string[]} [changes]         checklist, critical: the changes made since the design
 * @property {boolean} [count]            checklist: false leaves out the ask for how many items
 * @property {boolean} [stopRule]         critical: the rule for when to stop looking (an experiment)
 * @property {boolean} [noFormat]         review, critical: no response format (an experiment)
 */

/**
 * The verdict on a job: the checked job and the model it runs with (null for an upload's
 * check), or why it's refused. Refused jobs still name a model, for the result.
 * @typedef {{ ok: true, job: GeneratorJob, model: string | null } | { ok: false, model: string | null, error: string }} JobCheck
 */

/**
 * What the site knows about a version's next step: its facts, not the job's field names. The
 * server works these out (the step from its version kind module, the history walk) and
 * makeJob spells the job. Each kind of version has its own group: none for a new game, `upload`
 * for an uploaded file, `change` for a change, `remix` for a remix.
 *
 * @typedef {Object} JobFacts
 * @property {'design' | 'build' | 'recheck' | 'check'} step  the version's next step
 * @property {string} idea               the game's idea
 * @property {string | null} model       the version's model (null for an upload)
 * @property {string | null} [design]    the version's design: its last draft while designing, the
 *   approved one when building (a change's plan; null for a small fix or an upload)
 * @property {string | null} [feedback]  designing: the maker's feedback, asking for a new draft of `design`
 * @property {{ source: string }} [upload]  an uploaded file, to check
 * @property {ChangeFacts} [change]   a change (a plan, a small fix or "Review again")
 * @property {{ source: string, design: string | null, request: string }} [remix]
 *   a remix: still spelled close to the job's `remix` (plan for ticket 05: its own facts)
 */

/**
 * What a change starts from: the server walks the game's versions for these.
 * @typedef {Object} ChangeFacts
 * @property {string} request            what the maker asked for ("Review again": its standard request)
 * @property {string} gameFile           the file of the version it's based on
 * @property {string | null} gameDesign  the game's whole design as of that version (null: an upload's)
 * @property {string[]} requestsSince    the changes asked for since that design, oldest first
 */

/**
 * What the server logs for a job.
 * @typedef {'design' | 'new draft' | 'build' | 'code review' | 'upload check'} JobLabel
 */

/**
 * Makes the job for a version's next step, and the short label the server logs for it.
 * Every build the site asks for gets the review round (plan §47): that's what its build step is.
 * @param {JobFacts} facts
 * @returns {{ job: GeneratorJob, label: JobLabel }}
 */
export function makeJob(facts) {
  const { step, idea, model, design = null, feedback = null } = facts;
  // An upload (plan §57): its file is only checked, with no model.
  if (step === 'check') return { job: { step, idea, source: facts.upload.source }, label: 'upload check' };
  /** @type {GeneratorJob} */
  const job = { step, idea, model };
  if (step === 'build') job.review = true;
  if (facts.remix) Object.assign(job, remixParts(step, facts.remix, design));
  else if (facts.change) job.change = changeParts(step, facts.change, design);
  else if (step !== 'design') job.design = design; // a new game's approved design
  if (step === 'design' && feedback && design) job.redraft = { draft: design, feedback };
  const label = step === 'design' ? (job.redraft ? 'new draft' : 'design') : step === 'recheck' ? 'code review' : 'build';
  return { job, label };
}

/**
 * A change's part of its job: the game it starts from; when building (or reviewing again), the
 * approved plan (null: a small fix, or "Review again").
 * @param {JobFacts['step']} step
 * @param {ChangeFacts} facts
 * @param {string | null} plan
 */
function changeParts(step, { request, gameFile, gameDesign, requestsSince }, plan) {
  const change = { request, source: gameFile, design: gameDesign, earlierRequests: requestsSince };
  return step === 'design' ? change : { ...change, plan };
}

/**
 * A remix's part of its job (plan §45b): the original's file and design; its design step
 * also gets what should be different, its build the remix's approved design.
 */
function remixParts(step, { source, design, request }, approved) {
  return step === 'design' ? { remix: { source, design, request } } : { remix: { source, design }, design: approved };
}

/** What qwen3.8:27b on GenAI Studio takes (plan §38). */
const REASONING_EFFORTS = ['low', 'medium', 'xhigh'];

const isText = (value, min, max = MAX_IDEA_LENGTH) => typeof value === 'string' && value.trim().length >= min && value.length <= max;

/**
 * Checks a job before it runs: everything it says must make sense for its step.
 * @param {unknown} job  untrusted
 * @returns {JobCheck}
 */
export function checkJob(job) {
  const model = /** @type {any} */ (job)?.model ?? DEFAULT_MODEL;
  const fail = (error) => ({ ok: /** @type {const} */ (false), model, error });
  if (!job || typeof job !== 'object') return fail('the job must be an object');
  const j = /** @type {GeneratorJob} */ (job);
  // An uploaded file's check (plan §57): no model, so nothing else in the job matters.
  if (j.step === 'check') {
    if (typeof j.source !== 'string' || j.source.length === 0) return { ok: false, model: null, error: 'a check needs the game file' };
    return { ok: true, job: j, model: null };
  }
  if (!isAllowedModel(model)) return fail(`unknown model ${JSON.stringify(model)}`);
  if (!isText(j.idea, MIN_IDEA_LENGTH)) return fail(`the game idea must be ${MIN_IDEA_LENGTH}–${MAX_IDEA_LENGTH} characters`);
  const { change, redraft, remix } = j;
  if (change !== undefined) {
    if (!isText(change?.request, MIN_IDEA_LENGTH, MAX_REQUEST_LENGTH)) return fail(`the change request must be ${MIN_IDEA_LENGTH}–${MAX_REQUEST_LENGTH} characters`);
    if (typeof change.source !== 'string' || change.source.length === 0) return fail('a change needs the current game file');
    // Without edit mode, the old game and the new one must both fit (prompt.js explains the numbers).
    const limit = j.edits === false ? MAX_WHOLE_FILE_LENGTH : MAX_SOURCE_LENGTH;
    if (change.source.length > limit) {
      return fail(`the game is too big for the AI to change (${Math.round(change.source.length / 1024)} KB; at most ${limit / 1024} KB fits in the model's context)`);
    }
  }
  if (remix !== undefined) {
    if (change !== undefined) return fail('a job is a change or a remix, not both');
    if (typeof remix?.source !== 'string' || remix.source.length === 0) return fail('a remix needs the original game file');
    if (remix.source.length > MAX_SOURCE_LENGTH) return fail(`the game is too big for the AI to remix (${Math.round(remix.source.length / 1024)} KB; at most ${MAX_SOURCE_LENGTH / 1024} KB)`);
    if (remix.design !== undefined && remix.design !== null && typeof remix.design !== 'string') return fail("the remix's original design must be text");
    if (j.step === 'design' && !isText(remix.request, MIN_IDEA_LENGTH, MAX_REQUEST_LENGTH)) return fail(`what the remix changes must be ${MIN_IDEA_LENGTH}–${MAX_REQUEST_LENGTH} characters`);
  }
  if (redraft !== undefined && (typeof redraft?.draft !== 'string' || !isText(redraft.feedback, MIN_FEEDBACK_LENGTH))) {
    return fail('a new draft needs the last draft and what to change');
  }
  // The experiment switches (plan §23, §38, §40) and the site's review round (plan §47).
  if (j.edits !== undefined && typeof j.edits !== 'boolean') return fail('edits must be true or false');
  if (j.keepThinking !== undefined && typeof j.keepThinking !== 'boolean') return fail('keepThinking must be true or false');
  if (j.reasoningEffort !== undefined && !REASONING_EFFORTS.includes(j.reasoningEffort)) return fail(`reasoningEffort must be one of ${REASONING_EFFORTS.join(', ')}`);
  if (j.briefThinking !== undefined && typeof j.briefThinking !== 'boolean') return fail('briefThinking must be true or false');
  if (j.briefText !== undefined && !isText(j.briefText, 5)) return fail(`briefText must be 5–${MAX_IDEA_LENGTH} characters`);
  if (j.review !== undefined && typeof j.review !== 'boolean') return fail('review must be true or false');

  // What each step needs on top.
  const ok = { ok: /** @type {const} */ (true), job: j, model };
  switch (j.step) {
    case 'design':
      return ok;
    case 'checklist':
      return typeof j.design === 'string' ? ok : fail('a checklist needs the design');
    case 'review':
      return Array.isArray(j.checklist) && typeof j.source === 'string' ? ok : fail('a review needs the checklist and the game file');
    case 'critical':
      return typeof j.design === 'string' && typeof j.source === 'string' ? ok : fail('a critical review needs the design and the game file');
    case 'build':
      return change !== undefined || typeof j.design === 'string' ? ok : fail('building needs the approved design');
    case 'recheck':
      return change !== undefined ? ok : fail('a review needs the game (change.source)');
    default:
      return fail('the step must be "design", "build", "recheck", "check", "checklist", "review" or "critical"');
  }
}
