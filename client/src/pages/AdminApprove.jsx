import { useCallback, useEffect, useState } from 'react';
import { listGenerations, actOnGeneration, sendBack } from '../net/admin.js';
import { timeAgo } from '../components/timeAgo.js';

// The admin page's "To approve" tab (plan §44): games whose creators asked for them to be
// published, oldest request first. Play one (admins may host a submitted game), then publish
// it for everyone or send it back with a note its creator sees on their game's page.

export default function AdminApprove() {
  const [games, setGames] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const refresh = useCallback(async () => {
    const res = await listGenerations();
    if (!res.ok) return setLoadError(res.message ?? 'Could not load the games.');
    setLoadError(null);
    setGames(res.games.filter((g) => g.waitingForApproval).sort((a, b) => a.submittedAt - b.submittedAt));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <main className="page admin admin-approve">
      <h1>To approve</h1>
      <p className="muted">
        Games their makers asked to publish, oldest first. Play each one first: you can host it while it waits here. Then
        publish it for everyone, or send it back with a note the maker sees on their game's page.
      </p>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {games === null && !loadError && <p className="muted">Loading…</p>}
      {games?.length === 0 && <p className="empty-invite">Nothing to approve. When someone submits a game, it shows up here.</p>}
      <ul className="approve-list">
        {games?.map((game) => (
          <ApproveItem key={game.id} game={game} onDone={refresh} />
        ))}
      </ul>
    </main>
  );
}

/** One submitted game: who, what, and the three things to do with it. */
function ApproveItem({ game, onDone }) {
  const [note, setNote] = useState(null); // null: the "send back" box is closed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const name = game.name ?? 'Untitled game';

  async function act(send) {
    setBusy(true);
    setError(null);
    const res = await send();
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Something went wrong.');
    await onDone();
  }

  return (
    <li className="card approve-item">
      <div className="approve-head">
        <h2>{name}</h2>
        <span className="muted small">
          by <a href={`/u/${encodeURIComponent(game.ownerName ?? '')}`}>{game.ownerName ?? 'someone'}</a> · asked{' '}
          {timeAgo(game.submittedAt)} · version {game.playtestVersion} ·{' '}
          {game.testsPassed === false ? <span className="error">the newest version failed its checks</span> : 'checks passed'}
        </span>
      </div>
      {game.description && <p>{game.description}</p>}
      <p className="muted small approve-idea">
        Idea: <q>{game.prompt}</q>
      </p>
      <div className="gen-actions">
        <a className="primary-button" href={`/host?game=${encodeURIComponent(`${game.id}-v${game.playtestVersion}`)}`}>
          Play it
        </a>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => window.confirm(`Publish ${name}? Every host will be able to start it.`) && act(() => actOnGeneration(game.id, 'publish'))}
        >
          Publish
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setNote(note === null ? '' : null)} aria-expanded={note !== null}>
          Send back…
        </button>
        <a className="approve-details" href={`/admin?game=${encodeURIComponent(game.id)}`}>
          Design, code and checks
        </a>
      </div>
      {note !== null && (
        <form
          className="admin-form approve-note"
          onSubmit={(event) => {
            event.preventDefault();
            act(() => sendBack(game.id, note));
          }}
        >
          <label>
            Note for {game.ownerName ?? 'its maker'}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What to fix first, e.g. The round never ends with 2 players."
              required
            />
          </label>
          <div className="gen-actions">
            <button type="submit" className="primary-button" disabled={busy || note.trim().length < 3}>
              Send it back
            </button>
            <button type="button" className="link-button" onClick={() => setNote(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
