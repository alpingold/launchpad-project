import { readFileSync } from 'node:fs';

// The game kit guide for the /kit page (plan §13l, F5): how frame games work and how a
// design is written. It's the same text the AI reads in its prompts (generator/spec/), so
// the page and the AI can never disagree. Read once, the first time it's asked for.

const SECTIONS = [
  { id: 'games', title: 'How games work', file: '../../../generator/spec/GAME_SPEC.md' },
  { id: 'designs', title: 'Writing a design', file: '../../../generator/spec/DESIGN.md' },
];

let cached = null;

/** @returns {{ sections: { id: string, title: string, markdown: string }[] }} */
export function kitGuide() {
  cached ??= {
    sections: SECTIONS.map(({ id, title, file }) => ({ id, title, markdown: readFileSync(new URL(file, import.meta.url), 'utf8') })),
  };
  return cached;
}
