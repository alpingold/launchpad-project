import { AssetImage } from '../assets.jsx';

/** { view: 'choice', prompt, options: [{ label, action, asset? }] }: a list of buttons. */
export default function ChoiceView({ view, onAction }) {
  return (
    <div className="view view-choice">
      <h2>{view.prompt}</h2>
      <div className="choice-options">
        {view.options.map((option, i) => (
          // Options have no ids; their position is stable for the life of this view.
          <button key={i} type="button" className="game-button" disabled={!onAction} onClick={() => onAction?.(option.action)}>
            <AssetImage id={option.asset} />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
