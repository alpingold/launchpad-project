import { Blocks } from './index.jsx';

// Layout blocks: they only arrange their children. Styling comes from fixed class names,
// one per allowed word (align-center, gap-big, tone-good…), never from the game.

export function Column({ block }) {
  return (
    <div className={`blk-column align-${block.align ?? 'center'} gap-${block.gap ?? 'normal'}`}>
      <Blocks blocks={block.children} />
    </div>
  );
}

export function Row({ block }) {
  return (
    <div className={`blk-row align-${block.align ?? 'center'} gap-${block.gap ?? 'normal'}`}>
      <Blocks blocks={block.children} />
    </div>
  );
}

export function Grid({ block }) {
  const columns = Math.min(6, Math.max(2, block.columns)); // the server checked; clamp anyway
  return (
    <div className="blk-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      <Blocks blocks={block.children} />
    </div>
  );
}

export function Card({ block }) {
  return (
    <div className={`blk-card tone-${block.tone ?? 'normal'}`}>
      <Blocks blocks={block.children} />
    </div>
  );
}
