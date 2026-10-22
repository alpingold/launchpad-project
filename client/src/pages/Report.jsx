import { useEffect, useRef, useState } from 'react';
import { usePageTitle } from '../usePageTitle.js';
import { useCurrentUser } from '../net/auth.js';
import { describeDevice } from '../components/device.js';

// The site-wide report form (plan §31c), opened from the footer or the "(demo)" badge. Anyone
// may send one. It says what's sent along (the page it came from, the device, the username),
// and afterwards thanks you and goes back to the home page by itself.

const KINDS = [
  ['bug', "Something's broken"],
  ['idea', 'An idea'],
  ['content', 'A game is offensive or harmful'],
  ['other', 'Something else'],
];
const MIN = 10;
const MAX = 2000;
const COUNTDOWN = 3; // seconds before going back to the home page

/** The page the form was opened from, if it's one of ours ("/games/punchline"). */
function fromPage() {
  const from = new URLSearchParams(window.location.search).get('from');
  return from && /^\/(?!\/)/.test(from) ? from : null;
}

export default function Report() {
  usePageTitle('Report an issue');
  const user = useCurrentUser();
  const [page] = useState(fromPage);
  const [device] = useState(() => describeDevice());
  // "Report this game" on a game's page opens it as a content report (plan §57).
  const [kind, setKind] = useState(() => (new URLSearchParams(window.location.search).get('kind') === 'content' ? 'content' : 'bug'));
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState(''); // the hidden field only bots fill in
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function send(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, body, page, device, website }),
      });
      if (res.ok) return setSent(true);
      setError((await res.json().catch(() => ({}))).message ?? 'Something went wrong. Try again?');
    } catch {
      setError("Couldn't reach the server. Try again?");
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <Thanks />;
  const length = body.trim().length;
  return (
    <main className="page report-page">
      <h1>Report an issue</h1>
      <p className="muted">Something broken, confusing or just odd? An idea? Tell me: every report gets read.</p>
      <GameNudge page={page} />
      <form className="admin-form report-form" onSubmit={send}>
        <fieldset>
          <legend>What kind?</legend>
          {KINDS.map(([value, label]) => (
            <label key={value} className="radio-option">
              <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <label>
          What happened?
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={MAX}
            required
            placeholder="What you did, what you expected, and what happened instead."
          />
          <span className="muted small">
            {length}/{MAX} characters{length > 0 && length < MIN && ` (at least ${MIN})`}
          </span>
        </label>
        {/* People never see this field; bots fill in every field they find (the server ignores those reports). */}
        <label className="visually-hidden" aria-hidden="true">
          Website
          <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />
        </label>
        <p className="muted small">
          Sent with it: {page ? <>the page <span className="mono">{page}</span>, </> : ''}your device ({device})
          {user ? `, and your username (${user.username})` : ''}.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={busy || length < MIN}>
          Send report
        </button>
      </form>
    </main>
  );
}

/** Opened from a game's page: reporting it there lets others vote on it. */
function GameNudge({ page }) {
  const id = page?.match(/^\/games\/([^/]+)$/)?.[1];
  const [name, setName] = useState(null);
  useEffect(() => {
    if (!id) return;
    fetch(`/api/games/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setName(data?.game?.name ?? null))
      .catch(() => {});
  }, [id]);
  if (!name) return null;
  return (
    <p className="banner">
      About {name}? <a href={`${page}#reports`}>Reporting it on its page</a> lets others vote on it, so the problems
      most people hit get fixed first.
    </p>
  );
}

/** After sending: thanks, then back to the home page in 3, 2, 1. */
function Thanks() {
  const [left, setLeft] = useState(COUNTDOWN);
  const heading = useRef(null);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    if (left === 0) {
      window.location.href = '/';
      return undefined;
    }
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return (
    <main className="page report-page report-thanks">
      <h1 ref={heading} tabIndex={-1}>
        Thanks! Your feedback is very, very, very much appreciated!
      </h1>
      <p className="muted">
        Redirecting back to the main site in {left}… <a href="/">Go now</a>
      </p>
    </main>
  );
}
