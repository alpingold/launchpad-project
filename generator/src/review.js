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
// The script checks the cited lines afterwards: a model can claim what it didn't see.

import { chat } from './llm.js';
import { reasoningEffortFor } from './models.js';

export const AREAS = ['rules', 'big screen', 'phones', 'art', 'sound', 'ending', 'edge cases'];
export const STATUSES = ['implemented', 'partial', 'missing', 'wrong'];

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
            properties: { id: { type: 'string' }, status: { type: 'string', enum: STATUSES }, lines, note: { type: 'string' } },
            required: ['id', 'status', 'lines', 'note'],
            additionalProperties: false,
          },
        },
        bugs: {
          type: 'array',
          items: { type: 'object', properties: { lines, what: { type: 'string' } }, required: ['lines', 'what'], additionalProperties: false },
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

For EVERY checklist item, decide:
- implemented: the code does it as the item says (the numbers match)
- partial: it does some of it, or with different numbers or a simpler version (say what differs)
- missing: nothing in the code does it
- wrong: the code does something that contradicts it
Cite the line numbers that show it (for missing: []). Be strict: a comment, a constant that is never used, a function that is never called, or a variable named after the feature is not an implementation. Something drawn as an emoji or a plain shape when the item describes a character with features is partial.

Then list:
- bugs: things in the code that would break or spoil play that the item list doesn't cover (an undefined name, a phase that can never be reached, a button that does nothing), with lines
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
