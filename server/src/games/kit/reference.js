import { BLOCKS, BLOCK_TYPES } from './blocks.js';
import { MAX_BLOCKS, MAX_DEPTH, MAX_TOP_LEVEL } from './screen.js';
import { config } from '../../config.js';
import { PALETTE } from './drawing.js';

// The kit reference: every block, written out from the definitions in blocks.js (plan §12d).
// Two forms of the same thing, so they can't disagree:
//  - kitCatalog(): data, served at GET /api/kit for the public /kit page
//  - kitReference(): markdown, in the AI generator's prompt

/** [id, title, note?]: the note is shown above the group's blocks. */
export const GROUPS = [
  ['layout', 'Layout: blocks that hold other blocks'],
  ['display', 'Display: things to look at'],
  ['input', 'Input: things players use on their phones (the big screen shows them, not usable)'],
  [
    'widget',
    'Widgets: fast games on the phone (the phone does the timing, counting or drawing, then sends ONE result)',
    'A widget starts over whenever that phone gets a new screen. So while a widget is running, send that phone nothing: ' +
      'update only the big screen, and give each phone its next screen once its own result is in (or the round is over).',
  ],
];

/**
 * Every block as plain data (no functions), grouped, plus the screen-wide limits.
 * @returns {{ limits: object, palette: string[], groups: { id: string, title: string, note: string | null, blocks: object[] }[] }}
 */
export function kitCatalog() {
  return {
    limits: { maxDepth: MAX_DEPTH, maxBlocks: MAX_BLOCKS, maxScreenBytes: config.GAME_MAX_PAYLOAD_BYTES },
    palette: PALETTE,
    groups: GROUPS.map(([id, title, note = null]) => ({
      id,
      title,
      note,
      blocks: BLOCK_TYPES.filter((type) => BLOCKS[type].group === id).map((type) => {
        const def = BLOCKS[type];
        return {
          type,
          purpose: def.purpose,
          fields: Object.entries(def.fields).map(([name, field]) => ({ name, type: field.type, optional: field.optional })),
          sends: def.input?.doc ?? null,
          example: def.example,
        };
      }),
    })),
  };
}

/** @returns {string} markdown */
export function kitReference() {
  const lines = [
    '## Screens and blocks: the ONLY things a screen can show',
    '',
    `A screen is \`{ blocks: [ ...blocks ] }\` (1–${MAX_TOP_LEVEL} blocks), drawn top to bottom. Each block is \`{ type, ...fields }\`.`,
    `Layout blocks hold more blocks in \`children\` (at most ${MAX_DEPTH} levels deep; at most ${MAX_BLOCKS} blocks per screen, counting nested ones).`,
    `A screen must be at most ${config.GAME_MAX_PAYLOAD_BYTES / 1024} KB as JSON. Unknown fields are errors. Optional fields are left out, never \`undefined\` or \`null\`.`,
    'Text is shown as plain text, not HTML. Styling is only the words listed below, never CSS.',
  ];
  for (const group of kitCatalog().groups) {
    lines.push('', `### ${group.title}`);
    if (group.note) lines.push('', group.note);
    for (const block of group.blocks) {
      lines.push('', `#### \`${block.type}\``, '', block.purpose);
      if (block.fields.length) {
        lines.push('');
        for (const field of block.fields) lines.push(`- \`${field.name}\`${field.optional ? ' (optional)' : ''}: ${field.type}`);
      }
      if (block.sends) lines.push('', `Sends to onAction: \`action\`, plus \`input\` = ${block.sends}.`);
      lines.push('', `Example: \`${JSON.stringify(block.example)}\``);
    }
  }
  return lines.join('\n');
}
