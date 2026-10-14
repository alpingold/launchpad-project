import { isPlainObject } from '../../protocol/validate.js';
import { BLOCKS, BLOCK_TYPES } from './blocks.js';
import { checkFields } from './schema.js';

// SCREENS (plan §12b): what a game sends to a phone or the big screen.
//
//   { blocks: [ { type: 'text', text: 'Round 1', size: 'big' }, { type: 'button', ... } ] }
//
// A screen is a list of blocks drawn top to bottom; layout blocks hold more blocks.
// Games never send UI code: the client draws each block with a trusted React component.
// Checks are strict, and a problem says exactly where it is (e.g. `blocks[1].children[0]`),
// because the AI reads these messages to fix its games.

/** Nesting limit: a screen's own blocks are depth 1. */
export const MAX_DEPTH = 5;
/** Blocks per screen, counting every nested block. */
export const MAX_BLOCKS = 60;
const MAX_TOP_LEVEL = 30;

/**
 * Walks every block in a (structurally valid) screen, depth first.
 * @param {object[]} blocks
 * @param {(block: object) => void} visit
 */
function walk(blocks, visit) {
  for (const block of blocks) {
    visit(block);
    if (Array.isArray(block.children)) walk(block.children, visit);
  }
}

/**
 * Checks a screen a game wants to send.
 * @param {unknown} screen
 * @param {{ playerIds?: Set<string> }} [opts]  when given, player ids in the screen must be in it
 * @returns {string | null}  what's wrong and where, or null if the screen is valid
 */
export function validateScreen(screen, { playerIds } = {}) {
  if (!isPlainObject(screen)) return 'a screen must be an object like { blocks: [...] }';
  const extra = Object.keys(screen).find((key) => key !== 'blocks');
  if (extra) return `unknown screen field "${extra}" (a screen is { blocks: [...] })`;
  if (!Array.isArray(screen.blocks) || screen.blocks.length === 0 || screen.blocks.length > MAX_TOP_LEVEL) {
    return `"blocks" must be a list of 1–${MAX_TOP_LEVEL} blocks`;
  }

  let count = 0;
  function checkBlocks(blocks, path, depth) {
    for (const [i, block] of blocks.entries()) {
      const here = `${path}[${i}]`;
      count++;
      if (count > MAX_BLOCKS) return `too many blocks: a screen can have at most ${MAX_BLOCKS}, counting nested ones`;
      if (!isPlainObject(block)) return `${here} must be a block object like { type: 'text', text: 'Hi' }`;
      const { type, ...fields } = block;
      if (typeof type !== 'string' || !Object.hasOwn(BLOCKS, type)) {
        return `${here} has unknown block type ${JSON.stringify(type)} (known: ${BLOCK_TYPES.join(', ')})`;
      }
      const def = BLOCKS[type];
      const problem = checkFields(fields, def.fields) ?? def.check?.(block) ?? null;
      if (problem) return `${here} (${type}): ${problem}`;
      if (playerIds) {
        const unknown = playerIdsOf(block).find((id) => !playerIds.has(id));
        if (unknown) return `${here} (${type}): ${JSON.stringify(unknown)} isn't a player in this game (use ids from ctx.players)`;
      }
      if (block.children) {
        if (depth >= MAX_DEPTH) return `${here} (${type}): blocks are nested too deeply (at most ${MAX_DEPTH} levels)`;
        const inner = checkBlocks(block.children, `${here}.children`, depth + 1);
        if (inner) return inner;
      }
    }
    return null;
  }
  return checkBlocks(screen.blocks, 'blocks', 1);
}

/** The player ids a single block refers to. */
function playerIdsOf(block) {
  if (block.type === 'playerName') return [block.playerId];
  if (block.type === 'scoreboard') return block.rows.map((row) => row.playerId);
  return [];
}

/**
 * The actions a (valid) screen lets a player send: from every button and choice option on
 * it. GameRunner drops any action that isn't one of these (plan §11b, "offered actions").
 * @param {{ blocks: object[] } | undefined} screen
 * @returns {object[]}
 */
export function offeredActions(screen) {
  const actions = [];
  if (screen) walk(screen.blocks, (block) => actions.push(...(BLOCKS[block.type].actions?.(block) ?? [])));
  return actions;
}

/** Every asset id a (valid) screen shows (the harness checks they're in the art library). */
export function assetIdsIn(screen) {
  const ids = [];
  walk(screen.blocks, (block) => {
    if (block.asset) ids.push(block.asset);
    for (const option of block.options ?? []) if (option.asset) ids.push(option.asset);
  });
  return ids;
}

/**
 * Whether two JSON values are the same (same keys and values; key order doesn't matter).
 * Actions arrive as parsed JSON, so plain objects, arrays, strings, numbers, booleans and
 * null are all there is to compare.
 */
export function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
