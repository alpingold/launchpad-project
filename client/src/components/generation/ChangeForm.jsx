import { useState } from 'react';

// "Ask for changes" (plan §12e): each change makes a new version from a version that passed,
// with a plan first, or straight to code for a small fix. The creator's page (/create/<id>) and
// the admin page share it; only the words differ.

const WORDS = {
  creator: {
    heading: 'Want it different?',
    label: 'What should change',
    smallFix: (
      <>
        It's a small fix: skip the plan <span className="muted">(go straight to building)</span>
      </>
    ),
    base: 'Change version',
    version: (v, game) => `${v}${v === game.publishedVersion ? ' (everyone plays this one)' : v === game.playtestVersion ? ' (the one you play)' : ''}`,
  },
  admin: {
    heading: null,
    label: 'Ask for changes',
    smallFix: 'Small fix: skip the plan',
    base: 'Start from',
    version: (v, game) => `v${v}${v === game.publishedVersion ? ' (published)' : v === game.playtestVersion ? ' (playtest)' : ''}`,
  },
};

/**
 * @param {{ game: object, info: object, disabled: boolean, admin?: boolean,
 *   onAsk: (text: string, basedOn: number, smallFix: boolean) => Promise<boolean> }} props
 *   disabled: generating is off, the page is busy, or another version is being made
 *   onAsk: sends it; true if it was accepted (the form then empties)
 */
export default function ChangeForm({ game, info, disabled, admin = false, onAsk }) {
  const words = admin ? WORDS.admin : WORDS.creator;
  const ready = game.versions.filter((v) => v.status === 'ready');
  // Same default as the server: the playtest version, else the published one, else the newest ready one.
  const fallback = game.playtestVersion ?? game.publishedVersion ?? ready.at(-1)?.version ?? null;
  const [text, setText] = useState('');
  const [basedOn, setBasedOn] = useState(fallback);
  const [smallFix, setSmallFix] = useState(false);
  if (ready.length === 0) return null;
  const base = ready.some((v) => v.version === basedOn) ? basedOn : fallback;

  async function handleSubmit(event) {
    event.preventDefault();
    if (await onAsk(text, base, smallFix)) {
      setText('');
      setSmallFix(false);
    }
  }

  return (
    <form className={`admin-form ${admin ? 'gen-change' : 'create-change'}`} onSubmit={handleSubmit}>
      {words.heading && <h3>{words.heading}</h3>}
      <label>
        {words.label}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={info.maxRequestLength}
          placeholder="e.g. Rounds are too long: make them 20 seconds. Show the scores after each round."
          disabled={disabled}
        />
      </label>
      <label className="create-check">
        <input type="checkbox" checked={smallFix} onChange={(e) => setSmallFix(e.target.checked)} disabled={disabled} />
        <span>{words.smallFix}</span>
      </label>
      {ready.length > 1 && (
        <label className="create-base">
          {words.base}
          <select value={base} onChange={(e) => setBasedOn(Number(e.target.value))} disabled={disabled}>
            {[...ready].reverse().map((v) => (
              <option key={v.version} value={v.version}>
                {words.version(v.version, game)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="primary-button" disabled={disabled || text.trim().length < info.minIdeaLength}>
        {smallFix ? 'Make the fix' : 'Write a plan'}
      </button>
    </form>
  );
}
