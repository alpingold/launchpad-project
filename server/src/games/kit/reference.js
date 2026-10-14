import { BLOCKS, BLOCK_TYPES } from './blocks.js';
import { MAX_BLOCKS, MAX_DEPTH } from './screen.js';
import { config } from '../../config.js';

// The kit reference: every block, written out from the definitions in blocks.js (plan §12d).
// The AI generator puts this in its prompt, so the AI always sees exactly the blocks and
// fields the server accepts. (The /kit page will use the same definitions, in K4.)

const GROUPS = [
  ['layout', 'Layout: blocks that hold other blocks'],
  ['display', 'Display: things to look at'],
  ['input', 'Input: things players use on their phones (the big screen shows them, not tappable)'],
];

/** @returns {string} markdown */
export function kitReference() {
  const lines = [
    '## Screens and blocks: the ONLY things a screen can show',
    '',
    'A screen is `{ blocks: [ ...blocks ] }`, drawn top to bottom. Each block is `{ type, ...fields }`.',
    `Layout blocks hold more blocks in \`children\` (at most ${MAX_DEPTH} levels deep; at most ${MAX_BLOCKS} blocks per screen, counting nested ones).`,
    `A screen must be at most ${config.GAME_MAX_PAYLOAD_BYTES / 1024} KB as JSON. Unknown fields are errors. Optional fields are left out, never \`undefined\` or \`null\`.`,
    'Text is shown as plain text, not HTML. Styling is only the words listed below, never CSS.',
  ];
  for (const [group, title] of GROUPS) {
    lines.push('', `### ${title}`);
    for (const type of BLOCK_TYPES.filter((t) => BLOCKS[t].group === group)) {
      const def = BLOCKS[type];
      lines.push('', `#### \`${type}\``, '', def.purpose);
      const fields = Object.entries(def.fields);
      if (fields.length) {
        lines.push('');
        for (const [name, field] of fields) lines.push(`- \`${name}\`${field.optional ? ' (optional)' : ''}: ${field.type}`);
      }
      if (def.input) lines.push('', `Sends to onAction: \`action\`, plus \`input\` = ${def.input.doc}.`);
      lines.push('', `Example: \`${JSON.stringify(def.example)}\``);
    }
  }
  return lines.join('\n');
}
