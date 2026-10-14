import { text, number, oneOf, boolean, asset, playerId, action, list, object, children, custom } from './schema.js';
import { PALETTE, checkStrokes, botScribble } from './drawing.js';
import { isPlainObject } from '../../protocol/validate.js';

// THE BLOCKS (plan §12b): everything a game can put on a screen.
//
// Each block is defined ONCE here: its group, what it's for, its fields, and an example.
// The screen checks (screen.js) use these definitions now; the kit reference for the AI
// and the /kit page (K4) will be generated from them, so they can't drift apart.
//
// Each block has a hand-written React component in client/src/game/blocks/ (a test checks
// that every block here has one). Adding a block = a definition here + a component there.
//
// Styling is a few fixed words, never CSS: every screen stays readable on a phone and a TV,
// and works in dark mode.

export const SIZES = ['small', 'normal', 'big', 'huge'];
export const TONES = ['normal', 'muted', 'good', 'bad', 'accent'];
export const ALIGNS = ['start', 'center', 'end'];

const tone = oneOf(TONES, { optional: true });
const align = oneOf(ALIGNS, { optional: true });

/**
 * @typedef {Object} BlockDefinition
 * @property {'layout' | 'display' | 'input' | 'widget'} group
 * @property {string} purpose        one line: what it's for
 * @property {Record<string, ReturnType<typeof text>>} fields
 * @property {(block: object) => string | null} [check]   rules between fields
 * @property {(block: object) => object[]} [actions]     what a player can send from it
 * @property {InputRules} [input]     for blocks that send a value with their action
 * @property {object} example        a valid block (tests check every example)
 *
 * @typedef {Object} InputRules
 * @property {string} doc            what onAction receives as `input` (for the kit reference)
 * @property {(block: object, input: unknown, context: { now?: number }) => { value: unknown } | { problem: string }} read
 *   checks a player's input against this block; `value` is what the game receives (cleaned up).
 *   `context.now` is the server time it arrived (widgets use it to spot impossible timing)
 * @property {(block: object, rand: () => number) => unknown} bot
 *   a random valid input, for the test harness's bots
 */

/** Words the test bots type. */
const BOT_WORDS = ['pizza', 'robot', 'banana', 'Purdue', 'moon', 'sock', 'dragon', 'taco', 'spaceship', 'grandma'];

const pickInt = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));
const shuffled = (items, rand) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
/** Control characters and invisible formatting; newlines are allowed separately. */
const CONTROL_RE = /[\p{Cc}\p{Cf}]/u;

/** An object with exactly these keys, each a whole number in its range; or a problem. */
function readCounts(input, ranges) {
  if (!isPlainObject(input) || Object.keys(input).length !== Object.keys(ranges).length) {
    return { problem: `must be { ${Object.keys(ranges).join(', ')} }` };
  }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const v = input[key];
    if (!Number.isInteger(v) || v < min || v > max) return { problem: `"${key}" must be a whole number from ${min} to ${max}` };
  }
  return { value: { ...input } };
}

/** Strokes for a drawing, checked by drawing.js. */
const strokes = custom('list of { color, points: [x1, y1, x2, y2, ...] } (see drawPad)', checkStrokes);

/** The submit button's label on the input blocks below. */
const submitLabel = text({ max: 20, optional: true });

/** @type {Record<string, BlockDefinition>} */
export const BLOCKS = {
  // --- Layout: blocks that hold other blocks ---------------------------------------------
  column: {
    group: 'layout',
    purpose: 'Stacks blocks top to bottom. A screen is already a column, so use this inside rows, grids and cards.',
    fields: {
      children: children({ max: 30 }),
      align,
      gap: oneOf(['small', 'normal', 'big'], { optional: true }),
    },
    example: { type: 'column', children: [{ type: 'text', text: 'Alex' }, { type: 'text', text: '3 points', tone: 'muted' }] },
  },
  row: {
    group: 'layout',
    purpose: 'Puts blocks side by side; wraps onto the next line when the screen is too narrow.',
    fields: {
      children: children({ max: 12 }),
      align,
      gap: oneOf(['small', 'normal', 'big'], { optional: true }),
    },
    example: { type: 'row', children: [{ type: 'image', asset: 'trophy', size: 'small' }, { type: 'text', text: 'Alex leads!', size: 'big' }] },
  },
  grid: {
    group: 'layout',
    purpose: 'Lays blocks out in equal columns (e.g. a board, a gallery of answers).',
    fields: {
      columns: number({ min: 2, max: 6, integer: true }),
      children: children({ max: 36 }),
    },
    example: {
      type: 'grid',
      columns: 3,
      children: [
        { type: 'text', text: 'X', size: 'huge' },
        { type: 'text', text: 'O', size: 'huge' },
        { type: 'text', text: 'X', size: 'huge' },
      ],
    },
  },
  card: {
    group: 'layout',
    purpose: 'A box around blocks, to group them (an answer, a player, a round summary). `tone` colors its border.',
    fields: { children: children({ max: 20 }), tone },
    example: { type: 'card', tone: 'good', children: [{ type: 'text', text: 'Correct!', size: 'big' }] },
  },

  // --- Display: things to look at ----------------------------------------------------------
  text: {
    group: 'display',
    purpose: 'Words. `huge` is for one or two words on the big screen (GO!, a winner name).',
    fields: {
      text: text({ max: 500 }),
      size: oneOf(SIZES, { optional: true }),
      tone,
      align,
      bold: boolean({ optional: true }),
    },
    example: { type: 'text', text: 'Round 2 of 5', size: 'big', bold: true },
  },
  image: {
    group: 'display',
    purpose: 'A picture from the art library, by asset id. Games can never show other images.',
    fields: { asset: asset(), size: oneOf(['small', 'normal', 'big'], { optional: true }) },
    example: { type: 'image', asset: 'go-sign' },
  },
  timer: {
    group: 'display',
    purpose: 'Counts down to `endsAt` (server time from ctx.now()). As a bar, it empties from `startedAt` to `endsAt`. It only shows time: the game still needs its own ctx.setTimeout to act when time is up.',
    fields: {
      endsAt: number(),
      startedAt: number({ optional: true }),
      style: oneOf(['number', 'bar'], { optional: true }),
      label: text({ max: 60, optional: true }),
    },
    check(block) {
      if (block.style === 'bar' && block.startedAt === undefined) return 'a "bar" timer needs "startedAt" (when the bar is full)';
      if (block.startedAt !== undefined && block.startedAt >= block.endsAt) return '"startedAt" must be before "endsAt"';
      return null;
    },
    example: { type: 'timer', startedAt: 1_700_000_000_000, endsAt: 1_700_000_020_000, style: 'bar', label: 'Time left' },
  },
  progress: {
    group: 'display',
    purpose: 'A bar filled to value/max (answers in, health, how close to winning).',
    fields: {
      value: number({ min: 0 }),
      max: number({ min: 1 }),
      label: text({ max: 60, optional: true }),
      tone,
    },
    check: (block) => (block.value > block.max ? '"value" must not be more than "max"' : null),
    example: { type: 'progress', value: 3, max: 5, label: '3 of 5 answered' },
  },
  scoreboard: {
    group: 'display',
    purpose: "Scores in the order given. Names come from the room, so send player ids, not names. Each phone highlights its own row.",
    fields: {
      rows: list(object({ playerId: playerId(), score: number() }), { max: 12 }),
    },
    example: {
      type: 'scoreboard',
      rows: [
        { playerId: 'p_alex', score: 3 },
        { playerId: 'p_blake', score: 1 },
      ],
    },
  },
  playerName: {
    group: 'display',
    purpose: "A player's name, looked up from the room (names are never sent by games). Shows \"(you)\" on that player's own phone.",
    fields: { playerId: playerId(), size: oneOf(SIZES, { optional: true }), tone },
    example: { type: 'playerName', playerId: 'p_alex', size: 'big' },
  },
  divider: {
    group: 'display',
    purpose: 'A thin line between parts of a screen.',
    fields: {},
    example: { type: 'divider' },
  },

  // --- Input: things players use (on phones; the big screen shows them, not usable) ------
  // A tap sends the block's `action` to the game's onAction. Only actions on the player's
  // screen right now get through (GameRunner checks).
  button: {
    group: 'input',
    purpose: 'A button. Tapping sends `action` to onAction. `big` makes it fill most of a phone screen (easy to hit without looking).',
    fields: {
      label: text({ max: 40 }),
      action: action(),
      asset: asset({ optional: true }),
      size: oneOf(['normal', 'big'], { optional: true }),
      tone,
    },
    actions: (block) => [block.action],
    example: { type: 'button', label: 'TAP!', action: { tap: true, round: 1 }, size: 'big' },
  },
  choice: {
    group: 'input',
    purpose: "Several buttons; the player taps one and that option's `action` is sent to onAction. Put the question in a text block above it.",
    fields: {
      options: list(object({ label: text({ max: 60 }), action: action(), asset: asset({ optional: true }) }), { min: 1, max: 8 }),
      columns: number({ min: 1, max: 2, integer: true, optional: true }),
    },
    actions: (block) => block.options.map((option) => option.action),
    example: {
      type: 'choice',
      options: [
        { label: 'Pizza', action: { answer: 0 } },
        { label: 'Tacos', action: { answer: 1 } },
      ],
    },
  },

  // --- Input with a value: the player fills it in, then presses the submit button. The
  // platform checks the value against the block before the game ever sees it.
  textInput: {
    group: 'input',
    purpose: 'A text box with a submit button: answers, captions, guesses, lies. The platform trims the text and checks its length.',
    fields: {
      label: text({ max: 100, optional: true }),
      placeholder: text({ max: 60, optional: true }),
      maxLength: number({ min: 1, max: 200, integer: true, optional: true }),
      multiline: boolean({ optional: true }),
      submitLabel,
      action: action(),
    },
    actions: (block) => [block.action],
    input: {
      doc: 'the text, trimmed, 1 to maxLength (default 100) characters',
      read(block, input) {
        if (typeof input !== 'string') return { problem: 'must be text' };
        const value = input.normalize('NFC').trim();
        const max = block.maxLength ?? 100;
        if (value.length === 0 || value.length > max) return { problem: `must be 1–${max} characters` };
        const withoutNewlines = block.multiline ? value.replace(/\r?\n/g, '') : value;
        if (CONTROL_RE.test(withoutNewlines)) return { problem: 'has control characters' };
        return { value };
      },
      bot(block, rand) {
        const words = Array.from({ length: pickInt(rand, 1, 3) }, () => BOT_WORDS[Math.floor(rand() * BOT_WORDS.length)]);
        return words.join(' ').slice(0, block.maxLength ?? 100);
      },
    },
    example: { type: 'textInput', label: 'Finish the sentence: The worst pizza topping is…', maxLength: 80, action: { answer: true, round: 1 } },
  },
  multiChoice: {
    group: 'input',
    purpose: 'Options the player can tick (between `min` and `max` of them), then submit. For a single pick, use `choice` instead.',
    fields: {
      options: list(object({ label: text({ max: 60 }), asset: asset({ optional: true }) }), { min: 2, max: 8 }),
      min: number({ min: 0, max: 8, integer: true, optional: true }),
      max: number({ min: 1, max: 8, integer: true, optional: true }),
      submitLabel,
      action: action(),
    },
    check(block) {
      const min = block.min ?? 1;
      const max = block.max ?? block.options.length;
      if (max > block.options.length) return '"max" must not be more than the number of options';
      if (min > max) return '"min" must not be more than "max"';
      return null;
    },
    actions: (block) => [block.action],
    input: {
      doc: 'the indexes of the ticked options, smallest first, e.g. [0, 2]',
      read(block, input) {
        const min = block.min ?? 1;
        const max = block.max ?? block.options.length;
        if (!Array.isArray(input) || !input.every((i) => Number.isInteger(i) && i >= 0 && i < block.options.length)) {
          return { problem: 'must be a list of option indexes' };
        }
        const value = [...new Set(input)].sort((a, b) => a - b);
        if (value.length !== input.length) return { problem: 'has the same option twice' };
        if (value.length < min || value.length > max) return { problem: `must pick ${min}–${max} options` };
        return { value };
      },
      bot(block, rand) {
        const count = pickInt(rand, block.min ?? 1, block.max ?? block.options.length);
        return shuffled(block.options.map((_, i) => i), rand).slice(0, count).sort((a, b) => a - b);
      },
    },
    example: {
      type: 'multiChoice',
      options: [{ label: 'Cheese' }, { label: 'Pineapple' }, { label: 'Anchovies' }, { label: 'Olives' }],
      min: 1,
      max: 2,
      action: { toppings: true },
    },
  },
  slider: {
    group: 'input',
    purpose: 'Pick a number by sliding, then submit: guesses (how many jellybeans?), ratings, bids.',
    fields: {
      min: number(),
      max: number(),
      step: number({ min: 0.001, optional: true }),
      initial: number({ optional: true }),
      label: text({ max: 100, optional: true }),
      unit: text({ max: 10, optional: true }),
      submitLabel,
      action: action(),
    },
    check(block) {
      if (block.min >= block.max) return '"min" must be less than "max"';
      if ((block.max - block.min) / (block.step ?? 1) > 10_000) return 'too many steps: at most 10000 between "min" and "max"';
      if (block.initial !== undefined && (block.initial < block.min || block.initial > block.max)) return '"initial" must be between "min" and "max"';
      return null;
    },
    actions: (block) => [block.action],
    input: {
      doc: 'the number, between min and max, on a step',
      read(block, input) {
        if (typeof input !== 'number' || !Number.isFinite(input) || input < block.min || input > block.max) {
          return { problem: `must be a number from ${block.min} to ${block.max}` };
        }
        const step = block.step ?? 1;
        const steps = Math.round((input - block.min) / step);
        // Snap to the step (and round away float noise like 0.30000000000000004).
        const value = Number((block.min + steps * step).toFixed(6));
        if (Math.abs(value - input) > step / 1000) return { problem: `must be on a step of ${step}` };
        return { value: Math.min(block.max, value) };
      },
      bot(block, rand) {
        const step = block.step ?? 1;
        const steps = Math.floor((block.max - block.min) / step);
        return Number((block.min + pickInt(rand, 0, steps) * step).toFixed(6));
      },
    },
    example: { type: 'slider', label: 'How many jellybeans are in the jar?', min: 0, max: 500, step: 5, initial: 250, action: { guess: true } },
  },
  rank: {
    group: 'input',
    purpose: 'The player puts items in order (best first) with up/down buttons, then submits.',
    fields: {
      items: list(object({ label: text({ max: 60 }), asset: asset({ optional: true }) }), { min: 2, max: 8 }),
      submitLabel,
      action: action(),
    },
    actions: (block) => [block.action],
    input: {
      doc: 'the item indexes in the order the player chose, first = top, e.g. [2, 0, 1]',
      read(block, input) {
        const n = block.items.length;
        const isOrder =
          Array.isArray(input) && input.length === n && input.every((i) => Number.isInteger(i) && i >= 0 && i < n) && new Set(input).size === n;
        return isOrder ? { value: [...input] } : { problem: `must list every item index (0–${n - 1}) once` };
      },
      bot: (block, rand) => shuffled(block.items.map((_, i) => i), rand),
    },
    example: {
      type: 'rank',
      items: [{ label: 'Breakfast' }, { label: 'Lunch' }, { label: 'Dinner' }],
      action: { ranked: true },
    },
  },

  // --- Widgets: the phone does the fast part itself (timing, counting taps, drawing) and
  // sends ONE result. That's what makes reflex games fair on slow Wi-Fi: the time is
  // measured on the phone, not by when a message reaches the server. A modified phone
  // could lie, so the platform rejects impossible results; fine for a party game.
  reaction: {
    group: 'widget',
    purpose:
      'A reflex test. The phone shows a waiting button until `goAt` (server time from ctx.now()), then GO; the player taps as fast as they can. One tap per screen.',
    fields: {
      goAt: number(),
      waitLabel: text({ max: 30, optional: true }),
      goLabel: text({ max: 20, optional: true }),
      action: action(),
    },
    actions: (block) => [block.action],
    input: {
      doc: '{ ms } = their reaction time in milliseconds (80–10000), measured on the phone; or { early: true } if they tapped before GO',
      read(block, input, { now } = {}) {
        if (isPlainObject(input) && input.early === true && Object.keys(input).length === 1) return { value: { early: true } };
        const result = readCounts(input, { ms: [80, 10_000] });
        if ('problem' in result) return { problem: 'must be { ms } (80–10000) or { early: true }' };
        // GO hasn't happened yet on the server's clock, so this "reaction" is made up.
        if (now !== undefined && now < block.goAt - 500) return { problem: 'arrived before GO' };
        return result;
      },
      bot: (block, rand) => (rand() < 0.1 ? { early: true } : { ms: 150 + Math.floor(rand() * 700) }),
    },
    example: { type: 'reaction', goAt: 1_700_000_003_000, action: { tap: true, round: 1 } },
  },
  mash: {
    group: 'widget',
    purpose:
      'Tap as many times as you can. Counting starts at `startsAt` (server time) and lasts `durationMs`; then the phone sends the count by itself.',
    fields: {
      startsAt: number(),
      durationMs: number({ min: 1000, max: 30_000, integer: true }),
      label: text({ max: 20, optional: true }),
      action: action(),
    },
    actions: (block) => [block.action],
    input: {
      doc: '{ taps } = how many times they tapped in time (at most 20 per second)',
      read: (block, input) => readCounts(input, { taps: [0, Math.ceil((block.durationMs / 1000) * 20)] }),
      bot: (block, rand) => ({ taps: Math.floor(rand() * (block.durationMs / 1000) * 8) }),
    },
    example: { type: 'mash', startsAt: 1_700_000_003_000, durationMs: 5000, label: 'MASH!', action: { mash: true, round: 1 } },
  },
  timingBar: {
    group: 'widget',
    purpose:
      'A marker slides back and forth across a bar (one sweep every `periodMs`); the player taps to stop it, ideally inside the `target` zone. One tap per screen.',
    fields: {
      periodMs: number({ min: 500, max: 5000, integer: true, optional: true }),
      target: object({ from: number({ min: 0, max: 1000, integer: true }), to: number({ min: 0, max: 1000, integer: true }) }),
      label: text({ max: 60, optional: true }),
      stopLabel: text({ max: 20, optional: true }),
      action: action(),
    },
    check: (block) => (block.target.from >= block.target.to ? '"target.from" must be less than "target.to"' : null),
    actions: (block) => [block.action],
    input: {
      doc: '{ position } = where the marker stopped, 0 (left) to 1000 (right); inside the target if target.from ≤ position ≤ target.to',
      read: (block, input) => readCounts(input, { position: [0, 1000] }),
      bot: (block, rand) => ({ position: Math.floor(rand() * 1001) }),
    },
    example: { type: 'timingBar', target: { from: 450, to: 550 }, periodMs: 1200, label: 'Stop it in the green!', action: { stop: true, round: 1 } },
  },
  tapTargets: {
    group: 'widget',
    purpose:
      'Targets pop up one at a time at random spots (from `seed`: give each round a new one with ctx.random()); the player taps each. Starts at `startsAt` (server time); ends when all `count` are hit or after `durationMs`, then the phone sends the result by itself.',
    fields: {
      startsAt: number(),
      durationMs: number({ min: 3000, max: 30_000, integer: true }),
      count: number({ min: 1, max: 20, integer: true }),
      seed: number({ min: 0, max: 2_147_483_647, integer: true }),
      action: action(),
    },
    actions: (block) => [block.action],
    input: {
      doc: '{ hits, ms } = how many targets they hit, and how long it took in milliseconds (durationMs if they ran out of time)',
      read: (block, input) => readCounts(input, { hits: [0, block.count], ms: [0, block.durationMs] }),
      bot: (block, rand) => ({ hits: Math.floor(rand() * (block.count + 1)), ms: Math.floor(rand() * block.durationMs) }),
    },
    example: { type: 'tapTargets', startsAt: 1_700_000_003_000, durationMs: 10_000, count: 8, seed: 12345, action: { done: true, round: 1 } },
  },
  drawPad: {
    group: 'widget',
    purpose:
      'A drawing canvas with the given pen `colors`, undo and clear buttons, and a submit button. Show drawings to everyone with the `drawing` block.',
    fields: {
      colors: list(oneOf(PALETTE), { min: 1, max: 8, optional: true }),
      label: text({ max: 100, optional: true }),
      submitLabel,
      action: action(),
    },
    actions: (block) => [block.action],
    input: {
      doc: '{ strokes } = the drawing, in the format the `drawing` block shows: [{ color, points: [x1, y1, x2, y2, ...] }], x 0–1000, y 0–750',
      read(block, input) {
        if (!isPlainObject(input) || Object.keys(input).length !== 1 || !('strokes' in input)) return { problem: 'must be { strokes }' };
        const problem = checkStrokes(input.strokes);
        if (problem) return { problem: `strokes ${problem}` };
        const colors = block.colors ?? ['black'];
        if (input.strokes.some((stroke) => !colors.includes(stroke.color))) return { problem: "uses a color that isn't on this drawPad" };
        if (input.strokes.length === 0) return { problem: 'is an empty drawing' };
        return { value: { strokes: input.strokes } };
      },
      bot: (block, rand) => ({ strokes: botScribble(rand, block.colors ?? ['black']) }),
    },
    example: { type: 'drawPad', label: 'Draw: a cat on a skateboard', colors: ['black', 'red', 'blue'], action: { drawing: true, round: 1 } },
  },
  drawing: {
    group: 'display',
    purpose: "Shows a drawing (from a player's drawPad: pass its `strokes` on). Put several in a `grid` for a gallery.",
    fields: {
      strokes,
      caption: text({ max: 60, optional: true }),
      size: oneOf(['small', 'normal', 'big'], { optional: true }),
    },
    example: {
      type: 'drawing',
      strokes: [
        { color: 'black', points: [100, 600, 500, 150, 900, 600, 100, 600] },
        { color: 'red', points: [450, 450, 550, 450] },
      ],
      caption: 'A mountain (by Alex)',
    },
  },
};

export const BLOCK_TYPES = Object.freeze(Object.keys(BLOCKS));
