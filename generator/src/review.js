// THE REVIEWER (plan §47): reads a built game's code against its design. On the site, every
// game that passes gets one review (run.js: withReview): its crashes and dead ends are fixed
// right away, and everything it found goes to the game's creator. Experiments use it to score
// build variants on more than "did it pass the checks" (server/scripts/review-builds.js).
// Two steps, each one model call:
//
//   checklist  the design → numbered, checkable items (a rule with its numbers, a screen part, a
//              drawn character, a sound…). Made once per design, so every build of it is scored
//              against the same list.
//   review     the checklist + the game's code (with line numbers) → for each item: implemented,
//              partial, missing or wrong, with the lines that show it; plus bugs and dead code.
//
// The replies are JSON held to a schema (GenAI Studio's response_format), so no item is skipped.
// verify() checks the answers afterwards: a model can claim what it didn't see, and on a long
// list it can drift, putting one item's answer under the next item's id.

import { chat } from './llm.js';
import { reasoningEffortFor } from './models.js';
import { MAX_REQUEST_LENGTH } from './prompt.js';

export const AREAS = ['rules', 'big screen', 'phones', 'art', 'sound', 'ending', 'edge cases'];
export const STATUSES = ['implemented', 'partial', 'missing', 'wrong'];
/** How bad a bug is. The first two are CRITICAL: worth fixing before anyone plays. */
export const SEVERITIES = ['crash', 'stuck', 'spoils', 'minor'];
export const CRITICAL = ['crash', 'stuck'];

const lines = { type: 'array', items: { type: 'integer' } };

export const CHECKLIST_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'checklist',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, area: { type: 'string', enum: AREAS }, text: { type: 'string' } },
            required: ['id', 'area', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
};

export const REVIEW_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'review',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, about: { type: 'string' }, status: { type: 'string', enum: STATUSES }, lines, note: { type: 'string' } },
            required: ['id', 'about', 'status', 'lines', 'note'],
            additionalProperties: false,
          },
        },
        bugs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { lines, what: { type: 'string' }, severity: { type: 'string', enum: SEVERITIES } },
            required: ['lines', 'what', 'severity'],
            additionalProperties: false,
          },
        },
        deadCode: {
          type: 'array',
          items: { type: 'object', properties: { lines, what: { type: 'string' } }, required: ['lines', 'what'], additionalProperties: false },
        },
      },
      required: ['items', 'bugs', 'deadCode'],
      additionalProperties: false,
    },
  },
};

const CHECKLIST_SYSTEM = `You turn the design of a party game (one big screen, players on their phones) into a checklist for reviewing the game's code.

Each item is ONE concrete thing the code must do or show, checkable by reading the code:
- rules: a step, a timer, points, a speed, a limit, with the design's numbers
- big screen / phones: a part of a screen, a control, what is shown when
- art: a drawn character or object and its features, the scene, a look per phase, the big moment and how it moves
- sound: a sound at a moment
- ending: when it ends, the winner, each tie-break in order
- edge cases: leaving, coming back, nobody acting, 1 player, the most players, a reload

Split sentences that hold several things into several items. Keep the design's numbers. Never add what the design doesn't say.{{COUNT}} Ids are "R1", "R2"… for rules, "S1"… big screen, "P1"… phones, "A1"… art, "N1"… sound, "E1"… ending, "X1"… edge cases.`;

const REVIEW_SYSTEM = `You review the code of a party game (one HTML file: the big screen and every phone run it) against a checklist made from its design. Read the code carefully; each line starts with its number.

For EVERY checklist item, in order: its id, then "about": the item's own words, shortened (so it's clear which item you're judging), then decide:
- implemented: the code does it as the item says (the numbers match)
- partial: it does some of it, or with different numbers or a simpler version (say what differs)
- missing: nothing in the code does it
- wrong: the code does something that contradicts it
Cite the line numbers that show it (for missing: []). Be strict: a comment, a constant that is never used, a function that is never called, or a variable named after the feature is not an implementation. Something drawn as an emoji or a plain shape when the item describes a character with features is partial.

Then list:
- bugs: things in the code that would break or spoil play that the item list doesn't cover (an undefined name, a phase that can never be reached, a button that does nothing), with lines and a severity. Write "what" for the game's owner first, then the cause: what goes wrong for the players, in plain words, then why in the code. Severity:
  - crash: an error is thrown during normal play (an undefined name, a method called on the wrong kind of value)
  - stuck: play can't go on or can't be won (a goal that can't be reached, a phase that never ends, a control that never works)
  - spoils: it plays, but wrongly (a wrong score or winner, a screen that doesn't update)
  - minor: harmless or only looks wrong
  Only call it crash or stuck if you can point to the lines that make it happen.
- deadCode: functions or blocks that are never used, with lines

Notes are short and plain.`;

/** The game's code with "123| " in front of every line, for citing. */
export function numberLines(source) {
  return String(source)
    .split('\n')
    .map((line, i) => `${i + 1}| ${line}`)
    .join('\n');
}

/**
 * @param {string} design
 * @param {string[]} [changes]  changes asked for since the design, oldest first: they win where they differ
 * @returns {import('./llm.js').Message[]}
 */
export function checklistMessages(design, changes = [], { count = true } = {}) {
  const since = changes.length
    ? `\n\nChanges made to the game since, oldest first. Where one differs from the design, the change is what the game must do now:\n\n<changes>\n${changes.map((c) => `- ${String(c).trim()}`).join('\n')}\n</changes>`
    : '';
  return [
    // count false: no "Usually 30-60 items" (an experiment: the checklists ran to 89–183 items).
    { role: 'system', content: CHECKLIST_SYSTEM.replace('{{COUNT}}', count ? ' Usually 30-60 items.' : '') },
    { role: 'user', content: `The design:\n\n<design>\n${String(design).trim()}\n</design>${since}\n\nReply with the checklist as JSON.` },
  ];
}

export const CRITICAL_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'critical_bugs',
    schema: {
      type: 'object',
      properties: {
        bugs: {
          type: 'array',
          items: {
            type: 'object',
            properties: { lines, what: { type: 'string' }, severity: { type: 'string', enum: CRITICAL } },
            required: ['lines', 'what', 'severity'],
            additionalProperties: false,
          },
        },
      },
      required: ['bugs'],
      additionalProperties: false,
    },
  },
};

const CRITICAL_SYSTEM = `You look for the bugs that would ruin a party game (one HTML file: the big screen and every phone run it). Read the code carefully; each line starts with its number. The design says what the game should do.

List only these:
- crash: an error is thrown during normal play (an undefined name, a method called on the wrong kind of value)
- stuck: play can't go on or can't be won (a goal that can't be reached, a phase that never ends, a control that never works)

Only list a bug if you can point to the lines that make it happen. For each: its lines, its severity, and "what": what goes wrong for the players, in plain words, then why in the code. Nothing else: not minor bugs, not differences from the design that still play. No bugs is a fine answer.`;

/**
 * A review's brief-thinking sentence (an experiment, like BRIEF_THINKING for builds): without a
 * checklist to work through, the critical-only review thought until the context was full on the
 * biggest games.
 */
export const CRITICAL_BRIEF = `Read the code once, top to bottom, following one round of play as the players would. Note a bug only when you can name its lines; don't re-read the whole file or trace every branch to be sure. Then reply.`;

/**
 * When to stop (an experiment): on a game with nothing critical, the review searched item after
 * item without deciding it was done, and the reply ended mid-thought with no answer.
 */
export const CRITICAL_STOP = `Read the code once, top to bottom. If after that you have found no crash or dead end you can point to the lines of, stop there and answer {"bugs": []}. Don't keep searching to be sure; finding nothing is a normal result for a finished game.`;

/**
 * The critical-only review (an experiment, plan §47): only crashes and dead ends, from the design
 * and the code, without a checklist.
 * @param {{ brief?: boolean, stop?: boolean }} [opts]  brief: add CRITICAL_BRIEF; stop: add CRITICAL_STOP
 * @returns {import('./llm.js').Message[]}
 */
export function criticalMessages(design, source, { brief = false, stop = false, changes = [] } = {}) {
  const since = changes.length
    ? `\n\nChanges made to the game since, oldest first. Where one differs from the design, the change is what the game must do now:\n\n<changes>\n${changes.map((c) => `- ${String(c).trim()}`).join('\n')}\n</changes>`
    : '';
  const ask = `${brief ? `${CRITICAL_BRIEF}\n\n` : ''}${stop ? `${CRITICAL_STOP}\n\n` : ''}Reply with the bugs as JSON: {"bugs": [{"lines": [numbers], "severity": "crash" or "stuck", "what": "..."}]}.`;
  return [
    { role: 'system', content: CRITICAL_SYSTEM },
    { role: 'user', content: `The design:\n\n<design>\n${String(design).trim()}\n</design>${since}\n\nThe code:\n\n<code>\n${numberLines(source)}\n</code>\n\n${ask}` },
  ];
}

/** How a reply went, for measuring (plan §47's experiments): its thinking and answer sizes, and why it stopped. */
const replyStats = (reply) => ({
  thinkingChars: reply.thinking?.length ?? 0,
  replyChars: reply.content?.length ?? 0,
  finishReason: reply.finishReason ?? null,
  // When there's no answer: how the thinking ended (an experiment, to see why).
  ...(!reply.content && reply.thinking ? { thinkingEnd: String(reply.thinking).slice(-1500) } : {}),
});

/** A model call that may run out of room: then a failed result with what it thought, not a throw. */
async function ask(chatFn, messages, opts, model) {
  try {
    return { reply: await chatFn(messages, opts) };
  } catch (err) {
    if (!err.outOfRoom) throw err;
    return { failed: { ok: false, model, error: err.message, outOfRoom: true, usage: err.usage, seconds: err.seconds, ...replyStats(err) } };
  }
}

/**
 * @param {{ shape?: boolean }} [opts]  shape: describe the JSON in words (no response format: an experiment)
 * @returns {import('./llm.js').Message[]}
 */
export function reviewMessages(checklist, source, { shape = false } = {}) {
  const list = checklist.map((it) => `${it.id} [${it.area}] ${it.text}`).join('\n');
  return [
    { role: 'system', content: REVIEW_SYSTEM },
    {
      role: 'user',
      content: `The checklist:\n\n<checklist>\n${list}\n</checklist>\n\nThe code:\n\n<code>\n${numberLines(source)}\n</code>\n\nReply with the review as JSON, one entry for every checklist id, in order.${shape ? ' Its shape: {"items": [{"id", "about", "status", "lines": [numbers], "note"}], "bugs": [{"lines": [numbers], "what", "severity"}], "deadCode": [{"lines": [numbers], "what"}]}.' : ''}`,
    },
  ];
}

const parse = (text) => {
  // Without a response format (an experiment) the JSON may come in a ```json fence.
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(cleaned);
  try {
    return JSON.parse(fenced ? fenced[1] : cleaned);
  } catch {
    return null;
  }
};

/**
 * The "checklist" job step.
 * @returns {Promise<{ ok: boolean, model: string, checklist?: object[], usage?: object, seconds?: number, error?: string }>}
 */
export async function makeChecklist(job, model, { chatFn = chat, onStep = () => {} } = {}) {
  onStep(`checklist: asking ${model}`);
  const { reply, failed } = await ask(chatFn, checklistMessages(job.design, job.changes, { count: job.count !== false }), { model, reasoningEffort: job.reasoningEffort ?? reasoningEffortFor(model, 'design'), responseFormat: CHECKLIST_FORMAT }, model);
  if (failed) return failed;
  const items = parse(reply.content)?.items;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, model, error: 'the model wrote no checklist', ...replyStats(reply) };
  return { ok: true, model, checklist: items, usage: reply.usage, seconds: reply.seconds, ...replyStats(reply) };
}

/**
 * The "review" job step: job.checklist (from makeChecklist) and job.source (the game file).
 * @returns {Promise<{ ok: boolean, model: string, review?: object, usage?: object, seconds?: number, error?: string }>}
 */
export async function reviewGame(job, model, { chatFn = chat, onStep = () => {} } = {}) {
  onStep(`review: asking ${model}`);
  const { reply, failed } = await ask(chatFn, reviewMessages(job.checklist, job.source, { shape: job.noFormat === true }), { model, reasoningEffort: job.reasoningEffort ?? reasoningEffortFor(model, 'fix'), responseFormat: job.noFormat ? undefined : REVIEW_FORMAT }, model);
  if (failed) return failed;
  const review = parse(reply.content);
  if (!review || !Array.isArray(review.items)) return { ok: false, model, error: 'the model wrote no review', ...replyStats(reply) };
  return { ok: true, model, review, usage: reply.usage, seconds: reply.seconds, ...replyStats(reply) };
}

/**
 * The "critical" job step (an experiment): job.design and job.source; only crashes and dead ends.
 * @returns {Promise<{ ok: boolean, model: string, review?: { bugs: object[] }, usage?: object, seconds?: number, error?: string }>}
 */
export async function reviewCritical(job, model, { chatFn = chat, onStep = () => {} } = {}) {
  onStep(`critical review: asking ${model}`);
  const { reply, failed } = await ask(chatFn, criticalMessages(job.design, job.source, { brief: job.briefThinking === true, stop: job.stopRule === true, changes: job.changes ?? [] }), { model, reasoningEffort: job.reasoningEffort ?? reasoningEffortFor(model, 'fix'), responseFormat: job.noFormat ? undefined : CRITICAL_FORMAT }, model);
  if (failed) return failed;
  const review = parse(reply.content);
  if (!review || !Array.isArray(review.bugs)) return { ok: false, model, error: 'the model wrote no review', ...replyStats(reply) };
  return { ok: true, model, review, usage: reply.usage, seconds: reply.seconds, ...replyStats(reply) };
}

/** Words worth comparing: lower case, 4+ letters, cut to their first 5 (so "guards" meets "guard"). */
function keywords(text) {
  const stop = new Set(['with', 'when', 'each', 'that', 'this', 'from', 'their', 'shows', 'show', 'every', 'after', 'into', 'than', 'then', 'they', 'have', 'there']);
  return [...new Set((String(text).toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !stop.has(w)).map((w) => w.slice(0, 5)))];
}

/**
 * Checks each answer against its item and the code. An answer is `verified` when its "about"
 * shares a word with the item (otherwise it's `misaligned`: it was written about another item),
 * and, unless it says missing, it cites lines that exist with a word from the item or the note
 * (or a camelCase part of one) on or near them.
 */
export function verify(checklist, items, source) {
  const code = String(source).split('\n');
  const near = (lines) =>
    lines
      .flatMap((n) => code.slice(Math.max(0, n - 3), n + 2))
      .join('\n')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase();
  return checklist.map((it) => {
    const got = items.find((x) => x.id === it.id) ?? { id: it.id, about: it.text, status: 'missing', lines: [], note: '(the reviewer skipped it)' };
    const words = keywords(it.text);
    const misaligned = words.length > 0 && !keywords(got.about).some((w) => words.includes(w));
    const lines = (got.lines ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= code.length);
    const text = near(lines);
    const cited = got.status === 'missing' || (lines.length > 0 && keywords(`${it.text} ${got.note}`).some((w) => text.includes(w)));
    return { ...got, area: it.area, text: it.text, misaligned, verified: !misaligned && cited };
  });
}

/** A review's score: implemented 1, partial ½, only when verified (of every item, or one area's). */
export function score(items, area) {
  const of = items.filter((i) => !area || i.area === area);
  const points = of.reduce((n, i) => n + (!i.verified ? 0 : i.status === 'implemented' ? 1 : i.status === 'partial' ? 0.5 : 0), 0);
  return { points, of: of.length, unverified: of.filter((i) => !i.verified).length };
}

/**
 * The change request that asks the builder to fix a review's critical bugs: as many as fit in
 * a change request (`max` characters), most important first. `left` is how many didn't fit.
 */
export function fixRequest(bugs, max = MAX_REQUEST_LENGTH) {
  const head = 'A review of the code found these bugs. Fix each one, and change nothing else:';
  const lines = [];
  for (const b of bugs) {
    const line = `- ${b.what}${b.lines.length ? ` (around line ${b.lines.join(', ')})` : ''}`;
    if ([head, ...lines, line].join('\n').length > max) break;
    lines.push(line);
  }
  return { request: [head, ...lines].join('\n'), included: lines.length, left: bugs.length - lines.length };
}

/**
 * The review round's review (plan §47, critical-only since 2026-10-21): only the crashes and dead
 * ends, from the design (and the changes since) and the code, with the stopping rule. Tried twice.
 * @returns {Promise<{ ok: true, bugs: object[] } | { ok: false, error: string }>}
 */
export async function reviewFinished({ idea, design, changes = [], source }, model, { chatFn = chat, onStep = () => {} } = {}) {
  let res;
  for (let i = 0; i < 2; i++) {
    res = await reviewCritical({ design: design ?? idea, changes, source, stopRule: true }, model, { chatFn, onStep }).catch((err) => ({ ok: false, error: err.message }));
    if (res.ok) break;
  }
  if (!res.ok) return { ok: false, error: `no review: ${res.error}` };
  const bugs = (Array.isArray(res.review.bugs) ? res.review.bugs : []).filter((b) => CRITICAL.includes(b.severity));
  return { ok: true, bugs };
}

/**
 * What a game's creator is told (stored with the version): every crash and dead end found, with
 * whether it was fixed. (Reviews from before 2026-10-21 also have a score and the design's
 * missing items; the pages still show those.)
 * @typedef {{ bugs: { severity: string, what: string, fixed: boolean }[],
 *   fix: { ok: boolean, changelog?: string | null, error?: string } | null }} CreatorReview
 * @returns {CreatorReview}
 */
export function forCreator({ bugs }, fixed = []) {
  return {
    bugs: bugs.map((b) => ({ severity: SEVERITIES.includes(b.severity) ? b.severity : 'minor', what: String(b.what), fixed: fixed.includes(b) })),
    fix: null,
  };
}
