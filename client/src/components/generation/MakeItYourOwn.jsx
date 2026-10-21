import { useState } from 'react';

/**
 * "Make it your own" (plan §45b): a remix's first change. What should be different becomes the
 * remix's own whole design, which the creator approves like a new game's; then the copy's code
 * is rewritten for it. Shown on a remix until it has a change.
 * @param {{ name: string, info: object, disabled: boolean, onAsk: (text: string) => Promise<boolean> }} props
 *   name: the original's name; onAsk: sends it, true if it was accepted
 */
export default function MakeItYourOwn({ name, info, disabled, onAsk }) {
  const [text, setText] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (await onAsk(text)) setText('');
  }

  return (
    <form className="admin-form create-change" onSubmit={handleSubmit}>
      <h3>Make it your own</h3>
      <p className="muted small">
        Say how your version of {name} should be different: a new rule, a twist, another way to win. The AI writes your
        remix's whole design for you to read first, then rebuilds the game from it, keeping the rest of {name} as it is.
      </p>
      <label>
        What should be different
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={info.maxRequestLength}
          placeholder="e.g. Two teams instead of everyone for themselves, and a power-up that doubles a vote once per game."
          disabled={disabled}
        />
      </label>
      <button type="submit" className="primary-button" disabled={disabled || text.trim().length < info.minIdeaLength}>
        Write my remix's design
      </button>
    </form>
  );
}
