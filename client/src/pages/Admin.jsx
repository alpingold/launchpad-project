import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '../net/auth.js';
import { listGenerations, getGeneration, startGeneration, actOnGeneration, deleteGeneration } from '../net/admin.js';
import { usePageTitle } from '../usePageTitle.js';

// The admin page (plan §11, A6): make games with AI, read them, and decide what happens to
// them. The server does all the checking (admin only, valid input, allowed status changes);
// this page only shows what the server says.
//
// Progress: while a game is being made, the page asks the server for the list every 2 s.
// That's simpler than new WebSocket messages, and only one admin is ever watching.

const POLL_MS = 2000;
const LOGIN_URL = '/login?next=/admin';

const STATUS_TEXT = {
  generating: 'Generating',
  failed: 'Failed',
  review: 'Ready for review',
  playtest: 'Playtest (only you)',
  published: 'Published',
  rejected: 'Rejected',
};

/** The buttons each status gets: [action, label]. The server allows exactly these moves. */
const ACTIONS = {
  review: [
    ['playtest', 'Playtest'],
    ['reject', 'Reject'],
  ],
  playtest: [
    ['publish', 'Publish'],
    ['reject', 'Reject'],
  ],
  published: [
    ['playtest', 'Back to playtest'],
    ['reject', 'Reject'],
  ],
  rejected: [['playtest', 'Playtest again']],
};

const CONFIRM = {
  publish: 'Publish this game? Every host will be able to start it.',
};

export default function Admin() {
  usePageTitle('Admin');
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
  if (!user.isAdmin) {
    return (
      <main className="page">
        <h1>Admins only</h1>
        <p>This page is for the site's admin. Your account ({user.username}) isn't one.</p>
        <p>
          <a href="/">Go to the home page</a>
        </p>
      </main>
    );
  }
  return <AdminPanel />;
}

function AdminPanel() {
  const [info, setInfo] = useState(null); // what the server allows (models, idea length, switched on?)
  const [games, setGames] = useState(null); // summaries, newest first
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const refresh = useCallback(async () => {
    const res = await listGenerations();
    if (!res.ok) {
      setLoadError(res.message ?? 'Could not load the games.');
      return;
    }
    setLoadError(null);
    setInfo(res.info);
    setGames(res.games);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep asking while something is being made, and stop once nothing is.
  const anyGenerating = games?.some((g) => g.status === 'generating') ?? false;
  useEffect(() => {
    if (!anyGenerating) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [anyGenerating, refresh]);

  const selected = games?.find((g) => g.id === selectedId) ?? null;

  return (
    <main className="page admin">
      <h1>AI games</h1>
      <p className="muted">
        Describe a game; the AI writes it and tests it in a sandbox. Nothing runs on this server until you read the
        code and press Playtest.
      </p>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {info && (
        <NewGameForm
          info={info}
          onStarted={async (game) => {
            await refresh();
            setSelectedId(game.id);
          }}
        />
      )}

      <section aria-labelledby="games-heading">
        <h2 id="games-heading">Games</h2>
        {games === null && !loadError && <p className="muted">Loading…</p>}
        {games?.length === 0 && <p className="muted">No AI games yet.</p>}
        <ul className="gen-list">
          {games?.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                className={`gen-item${game.id === selectedId ? ' selected' : ''}`}
                aria-current={game.id === selectedId ? 'true' : undefined}
                onClick={() => setSelectedId(game.id === selectedId ? null : game.id)}
              >
                <span className="gen-title">{game.name ?? shorten(game.prompt)}</span>
                <StatusChip status={game.status} />
                <span className="muted small gen-meta">
                  {game.model} · {formatTime(game.createdAt)}
                  {game.progress && ` · ${progressText(game.progress)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <GameDetail
          key={selected.id}
          summary={selected}
          onChanged={refresh}
          onDeleted={async () => {
            setSelectedId(null);
            await refresh();
          }}
        />
      )}
    </main>
  );
}

/** The "make a new game" form. */
function NewGameForm({ info, onStarted }) {
  const [idea, setIdea] = useState('');
  const [model, setModel] = useState(info.defaultModel);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const length = idea.trim().length;
  const fits = length >= info.minIdeaLength && length <= info.maxIdeaLength;

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await startGeneration(idea, model);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? 'Something went wrong. Please try again.');
      return;
    }
    setIdea('');
    onStarted(res.game);
  }

  return (
    <section className="card" aria-labelledby="new-game-heading">
      <h2 id="new-game-heading">Make a game</h2>
      {!info.enabled && (
        <p className="banner" role="status">
          Generating games isn't set up on this server (start it with GENERATION_ENABLED=1; see generator/README.md).
          You can still manage the games below.
        </p>
      )}
      <form className="admin-form" onSubmit={handleSubmit}>
        <label>
          Game idea
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={4}
            maxLength={info.maxIdeaLength}
            placeholder="e.g. Everyone secretly votes for who is most likely to…; points for matching the majority."
            // Locked while sending: the reply clears the box, which would wipe anything typed meanwhile.
            disabled={!info.enabled || busy}
          />
          <span className="muted small">
            {length}/{info.maxIdeaLength} characters (at least {info.minIdeaLength})
          </span>
        </label>
        <fieldset className="model-options" disabled={!info.enabled}>
          <legend>Model</legend>
          {info.models.map((m) => (
            <label key={m.id} className="settings-option">
              <input
                type="radio"
                name="model"
                value={m.id}
                checked={model === m.id}
                onChange={() => setModel(m.id)}
              />
              <span>
                <span className="mono">{m.id}</span> <span className="muted small">{m.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={!info.enabled || !fits || busy}>
          Generate
        </button>
      </form>
    </section>
  );
}

/**
 * One game: its progress or result, the test report, the code, and the buttons.
 * The code and report come from the detail endpoint, fetched again whenever the game changes.
 */
function GameDetail({ summary, onChanged, onDeleted }) {
  const [game, setGame] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    getGeneration(summary.id).then((res) => {
      if (!current) return;
      if (res.ok) setGame(res.game);
      else setError(res.message ?? 'Could not load this game.');
    });
    return () => {
      current = false;
    };
  }, [summary.id, summary.updatedAt]);

  async function act(action) {
    if (CONFIRM[action] && !window.confirm(CONFIRM[action])) return;
    setBusy(true);
    setError(null);
    const res = await actOnGeneration(summary.id, action);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? 'Something went wrong.');
      return;
    }
    setGame(res.game);
    onChanged();
  }

  async function remove() {
    const waiting = summary.status === 'generating';
    if (!window.confirm(waiting ? 'Cancel making this game?' : 'Delete this game for good?')) return;
    setBusy(true);
    const res = await deleteGeneration(summary.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? 'Something went wrong.');
      return;
    }
    onDeleted();
  }

  // Generating: show the live progress from the list (it's polled), not the detail.
  const running = summary.progress?.queuePosition === 0;
  const actions = ACTIONS[summary.status] ?? [];

  return (
    <section className="card gen-detail" aria-labelledby="detail-heading">
      <h2 id="detail-heading">{summary.name ?? shorten(summary.prompt)}</h2>
      <p>
        <StatusChip status={summary.status} />
      </p>
      {summary.description && <p>{summary.description}</p>}
      <p className="muted small">
        Idea: <q>{summary.prompt}</q>
        <br />
        {summary.model} · started {formatTime(summary.createdAt)} · id <span className="mono">{summary.id}</span>
      </p>

      {summary.progress && <Progress progress={summary.progress} />}
      {summary.status === 'failed' && summary.error && (
        <p className="error">
          <strong>Failed:</strong> {summary.error}
        </p>
      )}
      {summary.status === 'playtest' && (
        <p className="banner" role="status">
          Only you can start it: it's in your game picker on the <a href="/host">host page</a>. Try it with real
          phones, then publish it or reject it.
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="gen-actions">
        {actions.map(([action, label]) => (
          <button
            key={action}
            type="button"
            className={action === 'reject' ? 'secondary-button' : 'primary-button'}
            onClick={() => act(action)}
            disabled={busy}
          >
            {label}
          </button>
        ))}
        {!running && (
          <button type="button" className="secondary-button danger-button" onClick={remove} disabled={busy}>
            {summary.status === 'generating' ? 'Cancel' : 'Delete'}
          </button>
        )}
      </div>

      {game?.report && <Report report={game.report} />}
      {game?.source && (
        <details className="gen-source" open={summary.status === 'review'}>
          <summary>
            Code ({game.source.split('\n').length} lines){summary.status === 'review' && ': read it before playtesting'}
          </summary>
          {/* Shown as text only. The browser never runs it. */}
          <pre>
            <code>{game.source}</code>
          </pre>
        </details>
      )}
    </section>
  );
}

function Progress({ progress }) {
  if (progress.queuePosition > 0) {
    return <p className="muted">Waiting: number {progress.queuePosition} in line.</p>;
  }
  return (
    <div role="status">
      <p>
        <strong>Working on it…</strong> <span className="muted small">(usually 30 s to a few minutes)</span>
      </p>
      <ol className="gen-steps">
        {progress.steps.map((step, i) => (
          <li key={i}>
            <span className="mono muted">{step.seconds}s</span> {step.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The harness's test report: a pass line, or the problems it found. */
function Report({ report }) {
  if (report.ok) {
    return (
      <p className="gen-report-ok">
        ✓ Passed every check: lint, the game contract, and {report.runs?.length ?? 0} games played by bots.
      </p>
    );
  }
  return (
    <div className="gen-report">
      <p>
        <strong>
          The tests found {report.problems.length} problem{report.problems.length === 1 ? '' : 's'}:
        </strong>
      </p>
      <ol>
        {report.problems.map((p, i) => (
          <li key={i}>
            {p.message}
            {p.where && <span className="muted small"> (first seen with {p.where})</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatusChip({ status }) {
  return <span className={`status-chip status-${status}`}>{STATUS_TEXT[status] ?? status}</span>;
}

function progressText(progress) {
  if (progress.queuePosition > 0) return `waiting (#${progress.queuePosition})`;
  return progress.steps.at(-1)?.text ?? 'starting';
}

function shorten(text, max = 60) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatTime(ms) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
