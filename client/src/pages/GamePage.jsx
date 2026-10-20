import { useEffect, useState } from 'react';
import { usePageTitle, NoIndex } from '../usePageTitle.js';
import { useCurrentUser } from '../net/auth.js';
import AiBadge from '../components/AiBadge.jsx';
import GameReports from '../components/GameReports.jsx';
import BlockedWords from '../components/generation/BlockedWords.jsx';
import { Creator, playersText, minutesText } from '../components/GameCard.jsx';

// One game's page (plan §16): its screenshots, description, who made it, votes, Host this
// game, and its bug reports (§31b). Its creator (or an admin) can change how it's shown here and in the catalogue: never
// the game itself. Everything typed is shown as plain text.

const SHOT_NAMES = { host: 'The big screen', phone: 'A phone' };

/** Never throws: a network failure is { ok: false, message }. */
async function call(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, ...(await res.json().catch(() => ({}))) };
  } catch {
    return { ok: false, status: 0, message: "Couldn't reach the server." };
  }
}

/** @param {{ id: string }} props  the game's id, from the address */
export default function GamePage({ id }) {
  const [game, setGame] = useState(undefined); // undefined: loading; null: not found
  const [error, setError] = useState(null);
  const user = useCurrentUser();
  usePageTitle(game?.name ?? 'Game');

  useEffect(() => {
    call(`/api/games/${encodeURIComponent(id)}`).then((res) => {
      if (res.ok) setGame(res.game);
      else if (res.status === 404) setGame(null);
      else setError(res.message ?? "Couldn't load this game.");
    });
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <p className="error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (game === undefined) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (game === null) {
    return (
      <main className="page">
        <NoIndex />
        <h1>Game not found</h1>
        <p>
          There's no such game, or it isn't shared with you. See <a href="/games">all the games</a>.
        </p>
      </main>
    );
  }

  const lobby = `/host?game=${encodeURIComponent(game.id)}`;
  const length = minutesText(game.minutes);
  return (
    <main className="page game-page">
      <h1>
        {game.name}
        <AiBadge game={game} />
      </h1>
      <p className="muted game-page-by">
        <Creator game={game} />
      </p>
      <Shots game={game} />
      <p className="game-page-description">{game.description}</p>
      <p className="muted">
        {playersText(game)}
        {length && ` · ${length}`}
      </p>
      {game.tags.length > 0 && (
        <ul className="game-tags" aria-label="Tags">
          {game.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      <div className="game-page-actions">
        <a className="primary-button" href={user ? lobby : `/login?next=${encodeURIComponent(lobby)}`}>
          Host this game
        </a>
        <Votes game={game} loggedIn={Boolean(user)} onVoted={setGame} />
      </div>
      {game.about && (
        <section className="page-section" aria-labelledby="about-heading">
          <h2 id="about-heading">About this game</h2>
          <p className="game-page-about">{game.about}</p>
        </section>
      )}
      {game.canEdit && <PageEditor game={game} onSaved={setGame} />}
      <GameReports game={game} />
    </main>
  );
}

/** The main screenshot, big; the other one beside it to switch to. */
function Shots({ game }) {
  const [shown, setShown] = useState(game.shots[0] ?? null);
  if (!shown) return null;
  const src = (which) => `/api/games/${encodeURIComponent(game.id)}/shot/${which}`;
  return (
    <div className="game-page-shots">
      <img className={`game-page-shot shot-${shown}`} src={src(shown)} alt={`${SHOT_NAMES[shown]} during a game of ${game.name}`} />
      {game.shots.length > 1 && (
        <div className="game-page-shot-choices" role="group" aria-label="Screenshots">
          {game.shots.map((which) => (
            <button key={which} type="button" aria-pressed={which === shown} onClick={() => setShown(which)}>
              <img src={src(which)} alt="" />
              <span>{SHOT_NAMES[which]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** ▲ / ▼ (upvote, downvote): press again to take your vote back. Logged out: a link to log in. Your own game: just the counts. */
function Votes({ game, loggedIn, onVoted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const vote = async (value) => {
    setBusy(true);
    setError(null);
    const res = await call(`/api/games/${encodeURIComponent(game.id)}/vote`, { method: 'PUT', body: { value: game.myVote === value ? 0 : value } });
    setBusy(false);
    if (res.ok) onVoted({ ...game, ...res.game });
    else setError(res.message ?? 'Something went wrong.');
  };
  const button = (value, emoji, count, label) => (
    <button
      type="button"
      className="vote-button"
      aria-pressed={game.myVote === value}
      aria-label={`${label} (${count})`}
      disabled={busy || !game.canVote}
      onClick={() => vote(value)}
    >
      {emoji} {count}
    </button>
  );
  return (
    <div className="game-page-votes">
      {button(1, '▲', game.votes.up, 'I like it')}
      {button(-1, '▼', game.votes.down, "I don't like it")}
      {!loggedIn && (
        <a className="small" href={`/login?next=${encodeURIComponent(window.location.pathname)}`}>
          Log in to vote
        </a>
      )}
      {loggedIn && !game.canVote && <span className="muted small">Your game: others vote on it.</span>}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** "Edit this page": for its creator or an admin. Empty fields fall back to what the game file says. */
function PageEditor({ game, onSaved }) {
  const file = game.fromFile;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => ({
    name: game.name === file.name ? '' : game.name,
    description: game.description === file.description ? '' : game.description,
    about: game.about,
    tags: game.tags,
    minLow: game.minutes?.[0] ?? '',
    minHigh: game.minutes?.[1] ?? '',
    mainShot: game.shots[0] ?? null,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(null); // words the name or description can't have (plan §49)
  const [notice, setNotice] = useState(null);
  const set = (change) => setForm((f) => ({ ...f, ...change }));

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setBlocked(null);
    setNotice(null);
    const minutes = form.minLow === '' && form.minHigh === '' ? null : [Number(form.minLow), Number(form.minHigh || form.minLow)];
    const res = await call(`/api/games/${encodeURIComponent(game.id)}/page`, {
      method: 'PUT',
      body: { name: form.name, description: form.description, about: form.about, tags: form.tags, minutes, mainShot: form.mainShot },
    });
    setBusy(false);
    if (res.blocked) return setBlocked(res.blocked);
    if (!res.ok) return setError(res.message ?? 'Something went wrong.');
    onSaved(res.game);
    setNotice('Saved. Everyone sees the new page now.');
  }

  if (!open) {
    return (
      <p>
        <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
          Edit this page
        </button>
      </p>
    );
  }
  const toggleTag = (tag) => set({ tags: form.tags.includes(tag) ? form.tags.filter((t) => t !== tag) : [...form.tags, tag] });
  return (
    <section className="card" aria-labelledby="edit-heading">
      <h2 id="edit-heading">Edit this page</h2>
      <p className="muted small">
        This changes how the game is shown here and in the catalogue, not the game itself. Leave a field empty to use what
        the game says.
      </p>
      <form className="admin-form game-page-form" onSubmit={save}>
        <label>
          Name
          <input value={form.name} maxLength={40} placeholder={file.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          Short description (on the cards)
          <textarea value={form.description} maxLength={200} rows={2} placeholder={file.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label>
          About this game
          <textarea value={form.about} maxLength={1500} rows={6} onChange={(e) => set({ about: e.target.value })} />
          <span className="muted small">{form.about.length}/1500 characters</span>
        </label>
        <fieldset>
          <legend>Tags (up to {game.maxTags})</legend>
          <div className="catalogue-tags">
            {game.tagChoices.map((tag) => (
              <button
                key={tag}
                type="button"
                className="tag-chip"
                aria-pressed={form.tags.includes(tag)}
                disabled={!form.tags.includes(tag) && form.tags.length >= game.maxTags}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="game-page-minutes">
          <legend>How long a game takes (minutes)</legend>
          <label>
            From
            <input type="number" min={1} max={180} value={form.minLow} onChange={(e) => set({ minLow: e.target.value })} />
          </label>
          <label>
            to
            <input type="number" min={1} max={180} value={form.minHigh} onChange={(e) => set({ minHigh: e.target.value })} />
          </label>
        </fieldset>
        {game.shots.length > 1 && (
          <fieldset>
            <legend>Main screenshot</legend>
            {game.shots.map((which) => (
              <label key={which} className="radio-option">
                <input type="radio" name="main-shot" checked={form.mainShot === which} onChange={() => set({ mainShot: which })} />
                {SHOT_NAMES[which]}
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {blocked && <BlockedWords blocked={blocked} />}
        {notice && <p role="status">{notice}</p>}
        <button type="submit" className="primary-button" disabled={busy}>
          Save
        </button>
      </form>
    </section>
  );
}
