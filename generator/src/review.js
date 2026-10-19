// THE REVIEWER (plan §47): scores how much of its design a built game actually does, to compare
// build variants on more than "did it pass the checks". Not used on the site: experiments run it
// (server/scripts/review-builds.js). Two steps, each one model call:
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

Split sentences that hold several things into several items. Keep the design's numbers. Never add what the design doesn't say. Usually 30-60 items. Ids are "R1", "R2"… for rules, "S1"… big screen, "P1"… phones, "A1"… art, "N1"… sound, "E1"… ending, "X1"… edge cases.`;

const REVIEW_SYSTEM = `You review the code of a party game (one HTML file: the big screen and every phone run it) against a checklist made from its design. Read the code carefully; each line starts with its number.

For EVERY checklist item, in order: its id, then "about": the item's own words, shortened (so it's clear which item you're judging), then decide:
- implemented: the code does it as the item says (the numbers match)
- partial: it does some of it, or with different numbers or a simpler version (say what differs)
- missing: nothing in the code does it
- wrong: the code does something that contradicts it
Cite the line numbers that show it (for missing: []). Be strict: a comment, a constant that is never used, a function that is never called, or a variable named after the feature is not an implementation. Something drawn as an emoji or a plain shape when the item describes a character with features is partial.

Then list:
- bugs: things in the code that would break or spoil play that the item list doesn't cover (an undefined name, a phase that can never be reached, a button that does nothing), with lines and a severity:
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

/** @returns {import('./llm.js').Message[]} */
export function checklistMessages(design) {
  return [
    { role: 'system', content: CHECKLIST_SYSTEM },
    { role: 'user', content: `The design:\n\n<design>\n${String(design).trim()}\n</design>\n\nReply with the checklist as JSON.` },
  ];
}

/** @returns {import('./llm.js').Message[]} */
export function reviewMessages(checklist, source) {
  const list = checklist.map((it) => `${it.id} [${it.area}] ${it.text}`).join('\n');
  return [
    { role: 'system', content: REVIEW_SYSTEM },
    {
      role: 'user',
      content: `The checklist:\n\n<checklist>\n${list}\n</checklist>\n\nThe code:\n\n<code>\n${numberLines(source)}\n</code>\n\nReply with the review as JSON, one entry for every checklist id, in order.`,
    },
  ];
}

const parse = (text) => {
  try {
    return JSON.parse(String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim());
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
  const reply = await chatFn(checklistMessages(job.design), { model, reasoningEffort: job.reasoningEffort ?? reasoningEffortFor(model, 'design'), responseFormat: CHECKLIST_FORMAT });
  const items = parse(reply.content)?.items;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, model, error: 'the model wrote no checklist' };
  return { ok: true, model, checklist: items, usage: reply.usage, seconds: reply.seconds };
}

/**
 * The "review" job step: job.checklist (from makeChecklist) and job.source (the game file).
 * @returns {Promise<{ ok: boolean, model: string, review?: object, usage?: object, seconds?: number, error?: string }>}
 */
export async function reviewGame(job, model, { chatFn = chat, onStep = () => {} } = {}) {
  onStep(`review: asking ${model}`);
  const reply = await chatFn(reviewMessages(job.checklist, job.source), { model, reasoningEffort: job.reasoningEffort ?? reasoningEffortFor(model, 'fix'), responseFormat: REVIEW_FORMAT });
  const review = parse(reply.content);
  if (!review || !Array.isArray(review.items)) return { ok: false, model, error: 'the model wrote no review' };
  return { ok: true, model, review, usage: reply.usage, seconds: reply.seconds };
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
