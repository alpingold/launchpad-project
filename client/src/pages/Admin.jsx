import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '../net/auth.js';
import {
  listGenerations,
  getGeneration,
  startGeneration,
  requestChanges,
  playtestVersion,
  actOnGeneration,
  deleteGeneration,
} from '../net/admin.js';
import { usePageTitle } from '../usePageTitle.js';

// The admin page (plan §11 A6, versions §12e K6): make games with AI, read them, ask for
// changes (each makes a new version), and choose which version is live. The server does all
// the checking (admin only, valid input, allowed moves); this page only shows what it says.
//
// Progress: while a game is being made, the page asks the server for the list every 2 s.
// That's simpler than new WebSocket messages, and only one admin is ever watching.

const POLL_MS = 2000;
const LOGIN_URL = '/login?next=/admin';

/** A game's status, in words (the server works it out from its versions). */
const STATUS_TEXT = {
  generating: 'Generating',
  failed: 'Failed',
  review: 'Ready for review',
  playtest: 'Playtest (only you)',
  published: 'Published',
};

/** A version's status, in words. */
const VERSION_STATUS_TEXT = {
  generating: 'Generating',
  failed: 'Failed',
  ready: 'Passed the tests',
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
        Describe a game; the AI writes it and tests it in a sandbox. A game is a web page that runs in a locked-down frame
        on the big screen and the phones, never on this server. Nobody can play it until you read the code and press
        Playtest.
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
                  {liveText(game) ?? `v${game.latestVersion}`} · {formatTime(game.createdAt)}
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
          info={info}
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
          {info.disabledReason} You can still manage the games below.
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
        {info.models.length > 1 ? (
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
        ) : (
          // One model: nothing to choose, just say which one (and how long it takes).
          <p className="muted small">
            Model: <span className="mono">{info.models[0].id}</span> ({info.models[0].note})
          </p>
        )}
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
 * One game: what's live, its progress, "ask for changes", and every version (newest first)
 * with its request, list of changes, test report, changed lines and code. The versions come
 * from the detail endpoint, fetched again whenever the game changes.
 */
function GameDetail({ summary, info, onChanged, onDeleted }) {
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

  /** Runs one admin move; on success shows the game as the server now has it. */
  async function run(send, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true);
    setError(null);
    const res = await send();
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? 'Something went wrong.');
      return false;
    }
    if (res.game?.versions) setGame(res.game);
    onChanged();
    return true;
  }

  async function remove() {
    const waiting = summary.status === 'generating';
    if (!window.confirm(waiting ? 'Cancel making this game?' : 'Delete this game and all its versions for good?')) return;
    setBusy(true);
    const res = await deleteGeneration(summary.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? 'Something went wrong.');
      return;
    }
    onDeleted();
  }

  const running = summary.progress?.queuePosition === 0;
  const { publishedVersion: published, playtestVersion: playtest } = summary;
  const versions = game ? [...game.versions].reverse() : [];

  return (
    <section className="card gen-detail" aria-labelledby="detail-heading">
      <h2 id="detail-heading">{summary.name ?? shorten(summary.prompt)}</h2>
      <p className="gen-live">
        <StatusChip status={summary.status} />
        {published !== null && <span className="muted small">Everyone plays v{published}.</span>}
        {playtest !== null && <span className="muted small">You're playtesting v{playtest}.</span>}
      </p>
      {summary.description && <p>{summary.description}</p>}
      <p className="muted small">
        Idea: <q>{summary.prompt}</q>
        <br />
        started {formatTime(summary.createdAt)} · id <span className="mono">{summary.id}</span>
      </p>

      {summary.progress && <Progress progress={summary.progress} />}
      {playtest !== null && (
        <p className="banner" role="status">
          Only you can start v{playtest}: it's in your game picker on the <a href="/host">host page</a>
          {published !== null && <>, next to v{published}, which everyone else keeps playing</>}. Try it with real
          phones, then publish it.
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="gen-actions">
        {playtest !== null && (
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() =>
              run(
                () => actOnGeneration(summary.id, 'publish'),
                `Publish v${playtest}? Every host will be able to start it${published !== null ? `, instead of v${published}` : ''}.`,
              )
            }
          >
            Publish v{playtest}
          </button>
        )}
        {playtest !== null && (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => run(() => actOnGeneration(summary.id, 'stop-playtest'))}>
            Stop playtest
          </button>
        )}
        {published !== null && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => run(() => actOnGeneration(summary.id, 'unpublish'), 'Unpublish it? Other hosts will no longer see this game.')}
          >
            Unpublish
          </button>
        )}
        {!running && (
          <button type="button" className="secondary-button danger-button" onClick={remove} disabled={busy}>
            {summary.status === 'generating' ? 'Cancel' : 'Delete game'}
          </button>
        )}
      </div>

      {game && (
        <ChangeForm
          game={game}
          enabled={info.enabled && summary.status !== 'generating'}
          onAsk={(text, basedOn) => run(() => requestChanges(summary.id, text, basedOn))}
          info={info}
        />
      )}

      <h3>Versions</h3>
      {versions.map((v, i) => (
        <Version
          key={v.version}
          version={v}
          open={i === 0}
          live={v.version === published ? 'published' : v.version === playtest ? 'playtest' : null}
          busy={busy}
          onPlaytest={() => run(() => playtestVersion(summary.id, v.version))}
        />
      ))}
    </section>
  );
}

/** "Ask for changes": what to change, and which version to start from. */
function ChangeForm({ game, enabled, onAsk, info }) {
  const ready = game.versions.filter((v) => v.status === 'ready');
  // Same default as the server: the playtest version, else the published one, else the newest ready one.
  const fallback = game.playtestVersion ?? game.publishedVersion ?? ready.at(-1)?.version ?? null;
  const [text, setText] = useState('');
  const [basedOn, setBasedOn] = useState(fallback);
  const length = text.trim().length;
  if (ready.length === 0) return null;
  const base = ready.some((v) => v.version === basedOn) ? basedOn : fallback;

  async function handleSubmit(event) {
    event.preventDefault();
    if (await onAsk(text, base)) setText('');
  }

  return (
    <form className="admin-form gen-change" onSubmit={handleSubmit}>
      <label>
        Ask for changes
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={info.maxIdeaLength}
          placeholder="e.g. Rounds are too long: make them 20 seconds. Show the scoreboard after each round."
          disabled={!enabled}
        />
      </label>
      <div className="gen-change-row">
        <label>
          Start from{' '}
          <select value={base} onChange={(e) => setBasedOn(Number(e.target.value))} disabled={!enabled}>
            {[...ready].reverse().map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.version === game.publishedVersion ? ' (published)' : v.version === game.playtestVersion ? ' (playtest)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary-button" disabled={!enabled || length < info.minIdeaLength}>
          Make a new version
        </button>
      </div>
    </form>
  );
}

/** One version: what was asked, what the AI says it changed, its tests, changed lines and code. */
function Version({ version: v, open, live, busy, onPlaytest }) {
  return (
    <article className="gen-version" aria-label={`Version ${v.version}`}>
      <details open={open}>
        <summary>
          <strong>v{v.version}</strong> {v.name && <span>{v.name}</span>}{' '}
          <span className={`status-chip status-${v.status}`}>{VERSION_STATUS_TEXT[v.status]}</span>
          {live && <span className={`status-chip status-${live}`}>{live === 'published' ? 'Published' : 'Playtest'}</span>}
        </summary>
        <p className="small">
          {v.basedOn === null ? (
            <>From the idea.</>
          ) : (
            <>
              Changed from v{v.basedOn}: <q>{v.request}</q>
            </>
          )}
          <span className="muted"> · {formatTime(v.createdAt)}</span>
        </p>
        {v.changelog && (
          <div className="gen-changelog">
            <p className="small muted">What the AI says it changed:</p>
            <ul>
              {v.changelog.split('\n').map((line, i) => (
                <li key={i}>{line.replace(/^- /, '')}</li>
              ))}
            </ul>
          </div>
        )}
        {v.status === 'failed' && v.error && (
          <p className="error">
            <strong>Failed:</strong> {v.error}
          </p>
        )}
        {v.status === 'ready' && !live && (
          <div className="gen-actions">
            <button type="button" className="primary-button" disabled={busy} onClick={onPlaytest}>
              Playtest v{v.version}
            </button>
          </div>
        )}
        {v.report && <Report report={v.report} />}
        {v.changes && <ChangedLines changes={v.changes} basedOn={v.basedOn} />}
        {v.source && (
          <details className="gen-source" open={v.status === 'ready' && !live && !v.changes}>
            <summary>
              Code ({v.source.split('\n').length} lines){v.status === 'ready' && !live && !v.changes && ': read it before playtesting'}
            </summary>
            {/* Shown as text only. The browser never runs it. */}
            <pre>
              <code>{v.source}</code>
            </pre>
          </details>
        )}
      </details>
    </article>
  );
}

/** The changed lines compared with the version it was made from, git-diff style. */
function ChangedLines({ changes, basedOn }) {
  return (
    <details className="gen-source gen-diff" open>
      <summary>
        Changed lines since v{basedOn}: <span className="diff-add-count">+{changes.added}</span>{' '}
        <span className="diff-del-count">−{changes.removed}</span>
      </summary>
      {changes.hunks.length === 0 && <p className="muted small">No lines changed.</p>}
      {changes.hunks.map((hunk, i) => (
        <pre key={i}>
          {hunk.map((line, j) => (
            // Spans, not divs: a <pre> may only hold inline content. CSS makes each line a row.
            <span key={j} className={`diff-line diff-${line.type}`}>
              <span className="diff-num">{line.type === 'add' ? '' : line.oldLine}</span>
              <span className="diff-num">{line.type === 'del' ? '' : line.newLine}</span>
              {/* The + and − are the cue that doesn't depend on color. */}
              <span className="diff-mark">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>
              <code>{line.text}</code>
            </span>
          ))}
        </pre>
      ))}
    </details>
  );
}

function Progress({ progress }) {
  if (progress.queuePosition > 0) {
    return <p className="muted">Waiting: number {progress.queuePosition} in line.</p>;
  }
  return (
    <div role="status">
      <p>
        <strong>Working on it…</strong> <span className="muted small">(usually a few minutes)</span>
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

/** A version's test report: a pass line, or the problems it found. */
function Report({ report }) {
  if (report.ok) {
    return <p className="gen-report-ok">✓ Passed every check: {report.checked ?? 'the game file'}.</p>;
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
            {typeof p === 'string' ? p : p.message}
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

/** "published v2 · playtest v3", or null if nothing is live. */
function liveText(game) {
  const parts = [];
  if (game.publishedVersion !== null) parts.push(`published v${game.publishedVersion}`);
  if (game.playtestVersion !== null) parts.push(`playtest v${game.playtestVersion}`);
  return parts.length ? parts.join(' · ') : null;
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
