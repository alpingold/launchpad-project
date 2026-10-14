import { text, number, oneOf, boolean, asset, playerId, action, list, object, children } from './schema.js';

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
 * @property {'layout' | 'display' | 'input'} group
 * @property {string} purpose        one line: what it's for
 * @property {Record<string, ReturnType<typeof text>>} fields
 * @property {(block: object) => string | null} [check]   rules between fields
 * @property {(block: object) => object[]} [actions]     what a player can send from it
 * @property {object} example        a valid block (tests check every example)
 */

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

  // --- Input: things players use (on phones; the big screen shows them, not tappable) -----
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
};

export const BLOCK_TYPES = Object.freeze(Object.keys(BLOCKS));
