import { AssetImage } from '../assets.jsx';

/**
 * { view: 'button', label, action, asset? }: one big button. Tapping sends `action` back
 * to the game unchanged. On the host screen (no onAction) it's shown but not tappable.
 */
export default function ButtonView({ view, onAction }) {
  return (
    <div className="view view-button">
      <button type="button" className="game-button" disabled={!onAction} onClick={() => onAction?.(view.action)}>
        <AssetImage id={view.asset} />
        <span>{view.label}</span>
      </button>
    </div>
  );
}
