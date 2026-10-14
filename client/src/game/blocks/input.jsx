import { useId, useState } from 'react';
import { AssetImage } from '../assets.jsx';
import { useScreen } from './context.js';

// Input blocks: using one sends the block's `action` back to the game, unchanged, plus a
// value for the blocks the player fills in (textInput, multiChoice, slider, rank).
// The server checks every value again (plan §12c); the checks here are only for comfort.
// On the big screen (no onAction) they're shown but not usable.
//
// After submitting, a block shows "Sent ✓" and locks. A new screen from the game replaces
// it (GameScreen remounts everything per screen), so there's nothing to unlock by hand.

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

/** The submit button shared by the input blocks below. */
function Submit({ block, sent, disabled }) {
  return (
    <button type="submit" className="game-button tone-accent" disabled={disabled || sent}>
      {sent ? 'Sent ✓' : (block.submitLabel ?? 'Send')}
    </button>
  );
}

/** Local state for a fill-in-then-submit block: whether it was sent, and a submit helper. */
function useSubmit(block) {
  const { onAction } = useScreen();
  const [sent, setSent] = useState(false);
  const submit = (input) => {
    if (!onAction || sent) return;
    onAction(block.action, input);
    setSent(true);
  };
  return { sent, locked: !onAction || sent, submit };
}

export function TextInput({ block }) {
  const { sent, locked, submit } = useSubmit(block);
  const [text, setText] = useState('');
  const id = useId();
  const Field = block.multiline ? 'textarea' : 'input';
  return (
    <form
      className="blk-input"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) submit(text);
      }}
    >
      {block.label && (
        <label htmlFor={id} className="blk-input-label">
          {block.label}
        </label>
      )}
      <Field
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={block.maxLength ?? 100}
        placeholder={block.placeholder}
        aria-label={block.label ? undefined : (block.placeholder ?? 'Your answer')}
        rows={block.multiline ? 3 : undefined}
        autoComplete="off"
        disabled={locked}
      />
      <Submit block={block} sent={sent} disabled={locked || !text.trim()} />
    </form>
  );
}

export function MultiChoice({ block }) {
  const { sent, locked, submit } = useSubmit(block);
  const [picked, setPicked] = useState([]); // option indexes
  const min = block.min ?? 1;
  const max = block.max ?? block.options.length;
  const toggle = (i) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  return (
    <form
      className="blk-input"
      onSubmit={(e) => {
        e.preventDefault();
        submit([...picked].sort((a, b) => a - b));
      }}
    >
      <p className="blk-input-label">{min === max ? `Pick ${min}` : `Pick ${min}–${max}`}</p>
      <div className="choice-options">
        {block.options.map((option, i) => {
          const on = picked.includes(i);
          return (
            <button
              key={i}
              type="button"
              className={`game-button toggle${on ? ' on' : ''}`}
              aria-pressed={on}
              disabled={locked || (!on && picked.length >= max)}
              onClick={() => toggle(i)}
            >
              <AssetImage id={option.asset} />
              <span>
                {on ? '✓ ' : ''}
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
      <Submit block={block} sent={sent} disabled={locked || picked.length < min || picked.length > max} />
    </form>
  );
}

export function Slider({ block }) {
  const { sent, locked, submit } = useSubmit(block);
  const step = block.step ?? 1;
  const middle = block.min + Math.floor((block.max - block.min) / step / 2) * step;
  const [value, setValue] = useState(block.initial ?? middle);
  const id = useId();
  return (
    <form
      className="blk-input"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      {block.label && (
        <label htmlFor={id} className="blk-input-label">
          {block.label}
        </label>
      )}
      <output htmlFor={id} className="blk-slider-value">
        {value}
        {block.unit && ` ${block.unit}`}
      </output>
      <input
        id={id}
        type="range"
        className="blk-slider"
        min={block.min}
        max={block.max}
        step={step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        aria-label={block.label ? undefined : 'Your number'}
        disabled={locked}
      />
      <Submit block={block} sent={sent} disabled={locked} />
    </form>
  );
}

export function Rank({ block }) {
  const { sent, locked, submit } = useSubmit(block);
  const [order, setOrder] = useState(() => block.items.map((_, i) => i)); // item indexes, top first
  const move = (position, by) =>
    setOrder((o) => {
      const next = [...o];
      [next[position], next[position + by]] = [next[position + by], next[position]];
      return next;
    });
  return (
    <form
      className="blk-input"
      onSubmit={(e) => {
        e.preventDefault();
        submit(order);
      }}
    >
      <ol className="rank-list">
        {order.map((item, position) => {
          const { label, asset } = block.items[item];
          return (
            <li key={item}>
              <span className="rank-position">{position + 1}</span>
              <AssetImage id={asset} />
              <span className="rank-label">{label}</span>
              <button type="button" aria-label={`Move ${label} up`} disabled={locked || position === 0} onClick={() => move(position, -1)}>
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${label} down`}
                disabled={locked || position === order.length - 1}
                onClick={() => move(position, 1)}
              >
                ▼
              </button>
            </li>
          );
        })}
      </ol>
      <Submit block={block} sent={sent} disabled={locked} />
    </form>
  );
}
