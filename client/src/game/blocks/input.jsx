import { AssetImage } from '../assets.jsx';
import { useScreen } from './context.js';

// Input blocks: tapping sends the block's `action` back to the game, unchanged.
// On the big screen (no onAction) they're shown but not tappable.

export function Button({ block }) {
  const { onAction } = useScreen();
  return (
    <button
      type="button"
      className={`game-button size-${block.size ?? 'normal'} tone-${block.tone ?? 'accent'}`}
      disabled={!onAction}
      onClick={() => onAction?.(block.action)}
    >
      <AssetImage id={block.asset} />
      <span>{block.label}</span>
    </button>
  );
}

export function Choice({ block }) {
  const { onAction } = useScreen();
  return (
    <div className={`choice-options columns-${block.columns ?? 1}`}>
      {block.options.map((option, i) => (
        <button key={i} type="button" className="game-button tone-accent" disabled={!onAction} onClick={() => onAction?.(option.action)}>
          <AssetImage id={option.asset} />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
