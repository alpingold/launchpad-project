// Helpers for reading the screens games send (plan §12b), so tests can say
// "the host shows GO!" without spelling out every block.

/** Every block on a screen, nested ones included, top to bottom. */
export function blocksOf(screen) {
  const all = [];
  const walk = (blocks) => {
    for (const block of blocks) {
      all.push(block);
      if (block.children) walk(block.children);
    }
  };
  if (screen) walk(screen.blocks);
  return all;
}

/** The first block of a type, or undefined. */
export const find = (screen, type) => blocksOf(screen).find((b) => b.type === type);

/** The words of every text block. */
export const texts = (screen) => blocksOf(screen).filter((b) => b.type === 'text').map((b) => b.text);

/** The screen's main message: its first big or huge text. */
export const headline = (screen) => blocksOf(screen).find((b) => b.type === 'text' && (b.size === 'big' || b.size === 'huge'))?.text;
