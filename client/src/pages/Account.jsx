import { useEffect, useState } from 'react';
import { useCurrentUser } from '../net/auth.js';
import { usePageTitle } from '../usePageTitle.js';

// Your account (plan §15): your Purdue GenAI Studio API key, which lets you make games with
// AI on /create, and a guide to getting one. The key goes to the server once; it's checked,
// stored encrypted, and never shown again (only its last 4 characters).

const LOGIN_URL = '/login?next=/account';
const KEY_URL = '/api/account/genai-key';

/** Never throws: a network failure is { ok: false, message }. */
async function call(method, body) {
  try {
    const res = await fetch(KEY_URL, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch {
    return { ok: false, message: "Couldn't reach the server." };
  }
}

export default function Account() {
  usePageTitle('Your account');
  const user = useCurrentUser();

  useEffect(() => {
    if (user === null) window.location.replace(LOGIN_URL);
  }, [user]);

  if (!user) {
    return (
      <main className="page">
        <h1>Checking your login…</h1>
      </main>
    );
  }
  return (
    <main className="page account-page">
      <h1>Your account</h1>
      <p className="muted">Logged in as {user.username}.</p>
      <KeySection />
      <KeyGuide />
    </main>
  );
}

function KeySection() {
  const [status, setStatus] = useState(null); // { saved, last4, savedAt }
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    call('GET').then((res) => (res.ok ? setStatus(res) : setError(res.message ?? "Couldn't load your key.")));
  }, []);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await call('PUT', { key });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Something went wrong.');
    setKey(''); // don't keep it on the page
    setStatus(res);
    setNotice('Saved. You can make games now.');
  }

  async function remove() {
    if (!window.confirm('Remove your key? You can save one again any time.')) return;
    setBusy(true);
    const res = await call('DELETE');
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Something went wrong.');
    setStatus({ saved: false, last4: null, savedAt: null });
    setNotice('Removed.');
  }

  return (
    <section className="card" aria-labelledby="key-heading">
      <h2 id="key-heading">Your GenAI Studio API key</h2>
      <p>
        Making games with AI runs on Purdue's GenAI Studio, with <strong>your own</strong> key (so it uses your account,
        not anyone else's). Once it's saved, go to <a href="/create">Make a game</a>.
      </p>
      {status?.saved && (
        <p className="banner" role="status">
          A key ending in <span className="mono">…{status.last4}</span> is saved.{' '}
          <button type="button" className="link-button" onClick={remove} disabled={busy}>
            Remove it
          </button>
        </p>
      )}
      <form className="admin-form" onSubmit={save}>
        <label>
          {status?.saved ? 'Replace it with a new key' : 'API key'}
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key here"
            disabled={busy}
          />
        </label>
        <p className="muted small">
          We check it with GenAI Studio, then store it encrypted. It's never shown again, and only used for games you make.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button type="submit" className="primary-button" disabled={busy || key.trim().length === 0}>
          {busy ? 'Checking…' : 'Save key'}
        </button>
      </form>
    </section>
  );
}

const STEPS = [
  {
    img: '/help/genai-key/1.png',
    alt: 'The GenAI Studio menu that opens from your picture, with Settings near the bottom',
    text: (
      <>
        Go to{' '}
        <a href="https://genai.rcac.purdue.edu/" target="_blank" rel="noreferrer">
          genai.rcac.purdue.edu
        </a>{' '}
        and log in with your Purdue account. Click your picture at the bottom left, then <strong>Settings</strong>.
      </>
    ),
  },
  {
    img: '/help/genai-key/2.png',
    alt: 'GenAI Studio settings: Account in the list on the left, and API keys on the Account page',
    text: (
      <>
        In the settings, open <strong>Account</strong>. Near the bottom you'll see <strong>API keys</strong>.
      </>
    ),
  },
  {
    img: '/help/genai-key/3.png',
    alt: 'The API Key box, with buttons to show, copy, or make a new key',
    text: (
      <>
        Click <strong>Show</strong>, make a new API key, and copy it into the box above.{' '}
        <strong>Don't share your key with anyone:</strong> it acts as you.
      </>
    ),
  },
];

function KeyGuide() {
  return (
    <section aria-labelledby="guide-heading">
      <h2 id="guide-heading">How to get a key</h2>
      <ol className="key-guide">
        {STEPS.map((step) => (
          <li key={step.img}>
            <p>{step.text}</p>
            <a href={step.img} target="_blank" rel="noreferrer" title="Open full size">
              <img src={step.img} alt={step.alt} loading="lazy" />
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
