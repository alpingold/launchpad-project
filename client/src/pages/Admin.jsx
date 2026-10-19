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
  redesignVersion,
  saveDesign,
  buildVersion,
  discardVersion,
  reviewAgain,
} from '../net/admin.js';
import { usePageTitle } from '../usePageTitle.js';
import Markdown from '../components/Markdown.jsx';
import CodeReview from '../components/CodeReview.jsx';
import AdminReports from './AdminReports.jsx';
import AdminApprove from './AdminApprove.jsx';

// The admin page (plan §11 A6, versions §12e K6, designs §13i F5): make games with AI. The AI
// writes a design first; you read it, ask for a new draft or edit it, and click "Build it".
// Then read the code and the checks, ask for changes (each makes a new version, with a plan
// first), and choose which version is live. The server does all
// the checking (admin only, valid input, allowed moves); this page only shows what it says.
//
// Progress: while a game is being made, the page asks the server for the list every 2 s.
// That's simpler than new WebSocket messages, and only one admin is ever watching.

export const POLL_MS = 2000;
const LOGIN_URL = '/login?next=/admin';

/** A game's status, in words (the server works it out from its versions). */
const STATUS_TEXT = {
  designing: 'Writing the design',
  design: 'Design to read',
  generating: 'Building',
  failed: 'Failed',
  review: 'Ready for review',
  playtest: 'Playtest (only its maker)',
  published: 'Published',
};

/** A version's status, in words. */
export const VERSION_STATUS_TEXT = {
  designing: 'Writing the design',
  design_ready: 'Design ready',
  generating: 'Building',
  failed: 'Failed',
  ready: 'Passed the checks',
};
/** A change's design is a plan; the words follow. */
export const PLAN_STATUS_TEXT = { ...VERSION_STATUS_TEXT, designing: 'Writing the plan', design_ready: 'Plan ready' };

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
  const asked = new URLSearchParams(window.location.search).get('tab');
  const tab = ['reports', 'approve'].includes(asked) ? asked : 'games';
  return (
    <>
      <AdminTabs tab={tab} />
      {tab === 'reports' ? <AdminReports /> : tab === 'approve' ? <AdminApprove /> : <GameMaker />}
    </>
  );
}

/** The admin page's parts, as plain links (decision D12). */
function AdminTabs({ tab }) {
  const link = (value, href, label) => (
    <a href={href} aria-current={tab === value ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <nav className="admin-tabs" aria-label="Admin">
      {link('games', '/admin', 'AI games')}
      {link('approve', '/admin?tab=approve', 'To approve')}
      {link('reports', '/admin?tab=reports', 'Reports')}
    </nav>
  );
}

/**
 * Making games with AI: the form, every game, and one game's versions, with every detail.
 * (The /create page, plan §19, is the guided version for your own games: it reuses the
 * exported pieces below.)
 * @param {{ heading?: string, intro?: import('react').ReactNode }} props
 */
function GameMaker({ heading = 'AI games', intro }) {
  const [info, setInfo] = useState(null); // what the server allows (models, idea length, switched on?)
  const [games, setGames] = useState(null); // summaries, newest first
  const [loadError, setLoadError] = useState(null);
  // /admin?game=<id> (from "To approve") opens that game.
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('game'));

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

  // Keep asking while something is being made (or waits in line), and stop once nothing is.
  const anyGenerating = games?.some((g) => g.progress !== null || g.status === 'designing' || g.status === 'generating') ?? false;
  useEffect(() => {
    if (!anyGenerating) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [anyGenerating, refresh]);

  const selected = games?.find((g) => g.id === selectedId) ?? null;

  return (
    <main className="page admin">
      <h1>{heading}</h1>
      {intro ?? (
        <p className="muted">
          Describe a game. The AI writes a short design first: read it, ask for changes or edit it, then press Build it.
          The AI then writes the game and checks it in a sandbox, playing it in a hidden browser. A game is a web page that
          runs in a locked-down frame on the big screen and the phones, never on this server. Nobody can play it until you
          read the code and press Playtest. The AI follows the <a href="/kit">game kit</a> guide.
        </p>
      )}
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
                {game.waitingForApproval && <span className="status-chip status-waiting">Waiting for approval</span>}
                <span className="muted small gen-meta">
                  {game.ownerName && `by ${game.ownerName} · `}
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
  // Switched on here, and this person's jobs can run (their own key, or an admin: plan §15).
  const ready = info.enabled && info.canGenerate !== false;
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
      {info.enabled && info.canGenerate === false && (
        <div className="banner" role="status">
          <p>
            <strong>Add your API key first.</strong> Making games runs on your own Purdue GenAI Studio API key. It takes a
            minute, and the account page shows how to get one.
          </p>
          <a className="primary-button" href="/account">
            Add your API key
          </a>
        </div>
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
            disabled={!ready || busy}
          />
          <span className="muted small">
            {length}/{info.maxIdeaLength} characters (at least {info.minIdeaLength})
          </span>
        </label>
        {info.models.length > 1 ? (
          <fieldset className="model-options" disabled={!ready}>
            <legend>Model</legend>
            {info.models.map((m) => (
              <label key={m.id} className="radio-option">
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
        <button type="submit" className="primary-button" disabled={!ready || !fits || busy}>
          Write the design
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
    const waiting = summary.progress !== null;
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
          Only you can start v{playtest}: <a href={`/host?game=${encodeURIComponent(`${summary.id}-v${playtest}`)}`}>host it</a>
          {published !== null && <>, next to v{published}, which everyone else keeps playing</>}. Try it with real
          phones, then {info.isAdmin ? 'publish it' : 'ask the site admin if it can be published for everyone'}.
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="gen-actions">
        {playtest !== null && info.isAdmin && (
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
        {published !== null && info.isAdmin && (
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
            {summary.progress !== null ? 'Cancel' : 'Delete game'}
          </button>
        )}
      </div>

      {game && (
        <ChangeForm
          game={game}
          enabled={info.enabled && !summary.progress && !game.versions.some((v) => ['designing', 'design_ready', 'generating'].includes(v.status))}
          onAsk={(text, basedOn, skipDesign) => run(() => requestChanges(summary.id, text, basedOn, skipDesign))}
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
          busy={busy || Boolean(summary.progress)}
          info={info}
          canDiscard={i === 0 && v.version > 1 && ['design_ready', 'failed'].includes(v.status)}
          onPlaytest={() => run(() => playtestVersion(summary.id, v.version))}
          onRedesign={(feedback) => run(() => redesignVersion(summary.id, v.version, feedback))}
          onSaveDesign={(design) => run(() => saveDesign(summary.id, v.version, design))}
          onBuild={() => run(() => buildVersion(summary.id, v.version))}
          onDiscard={() => run(() => discardVersion(summary.id, v.version), `Throw away v${v.version}? Its ${v.basedOn === null ? 'design' : 'plan'} and request are deleted.`)}
          canChange={info.enabled && !summary.progress && !game?.versions.some((x) => ['designing', 'design_ready', 'generating'].includes(x.status))}
          onFixFindings={(text) => run(() => requestChanges(summary.id, text, v.version, true), `Ask the AI to fix these in a new version, from v${v.version}?`)}
          onReviewAgain={() => run(() => reviewAgain(summary.id, v.version), `Review v${v.version}'s code again? It makes a new version.`)}
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
  const [smallFix, setSmallFix] = useState(false);
  const length = text.trim().length;
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
    <form className="admin-form gen-change" onSubmit={handleSubmit}>
      <label>
        Ask for changes
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={info.maxRequestLength}
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
        <label className="gen-small-fix">
          <input type="checkbox" checked={smallFix} onChange={(e) => setSmallFix(e.target.checked)} disabled={!enabled} /> Small fix: skip
          the plan
        </label>
        <button type="submit" className="primary-button" disabled={!enabled || length < info.minIdeaLength}>
          {smallFix ? 'Make the fix' : 'Write a plan'}
        </button>
      </div>
    </form>
  );
}

/** One version: what was asked, its design or plan, what the AI says it changed, its checks, changed lines and code. */
function Version({ version: v, open, live, busy, info, canDiscard, canChange, onPlaytest, onRedesign, onSaveDesign, onBuild, onDiscard, onFixFindings, onReviewAgain }) {
  const isPlan = v.basedOn !== null;
  const statusText = (isPlan ? PLAN_STATUS_TEXT : VERSION_STATUS_TEXT)[v.status];
  // The design is open to work on while it waits for you, or after a failed build.
  const designOpen = v.design !== null && (v.status === 'design_ready' || v.status === 'failed');
  return (
    <article className="gen-version" aria-label={`Version ${v.version}`}>
      <details open={open}>
        <summary>
          <strong>v{v.version}</strong> {v.name && <span>{v.name}</span>}{' '}
          <span className={`status-chip status-${v.status}`}>{statusText}</span>
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
        {v.codeReview && v.status === 'ready' && (
          <CodeReview
            review={v.codeReview}
            busy={busy}
            canAct={canChange}
            maxRequestLength={info.maxRequestLength}
            onFix={onFixFindings}
            onReviewAgain={onReviewAgain}
          />
        )}
        {v.status === 'failed' && v.error && (
          <p className="error">
            <strong>Failed:</strong> {v.error}
          </p>
        )}
        {v.status === 'design_ready' && v.error && (
          <p className="error">
            <strong>The new draft failed:</strong> {v.error} The last draft is below.
          </p>
        )}
        {v.status === 'designing' && v.designFeedback && (
          <p className="muted small">
            Writing a new draft: <q>{v.designFeedback}</q>
          </p>
        )}
        {v.design !== null &&
          (designOpen ? (
            <DesignEditor
              key={v.drafts.length}
              version={v}
              isPlan={isPlan}
              busy={busy}
              info={info}
              canDiscard={canDiscard}
              onRedesign={onRedesign}
              onSaveDesign={onSaveDesign}
              onBuild={onBuild}
              onDiscard={onDiscard}
            />
          ) : (
            <details className="gen-design">
              <summary>{isPlan ? 'The plan it was built from' : 'The design it was built from'}</summary>
              <Markdown text={v.design} headingOffset={3} />
            </details>
          ))}
        {canDiscard && !designOpen && (
          <div className="gen-actions">
            <button type="button" className="secondary-button danger-button" disabled={busy} onClick={onDiscard}>
              Discard v{v.version}
            </button>
          </div>
        )}
        {v.status === 'ready' && !live && (
          <div className="gen-actions">
            <button type="button" className="primary-button" disabled={busy} onClick={onPlaytest}>
              Playtest v{v.version}
            </button>
          </div>
        )}
        {v.report && <Report report={v.report} />}
        {v.attempts?.length > 0 && <Attempts attempts={v.attempts} />}
        {v.changes && <ChangedLines changes={v.changes} basedOn={v.basedOn} />}
        {v.source && (
          <details className="gen-source" open={v.status === 'ready' && !live && !v.changes}>
            <summary>
              Code ({v.source.split('\n').length} lines){v.status === 'ready' && !live && !v.changes && ': read it before playtesting'}
            </summary>
            {/* Shown as text only. The browser never runs it. */}
            <SourceCode source={v.source} report={v.report} />
          </details>
        )}
      </details>
    </article>
  );
}

/** The changed lines compared with the version it was made from, git-diff style. */
/**
 * Changed lines between two files (server/src/generation/lineDiff.js's changedLines).
 * @param {{ changes: { added: number, removed: number, hunks: { type: 'same' | 'add' | 'del', text: string, oldLine?: number, newLine?: number }[][] },
 *   basedOn?: number, label?: string, open?: boolean }} props
 *   basedOn: the version compared with (for the default label); label replaces that label
 */
export function ChangedLines({ changes, basedOn, label = `Changed lines since v${basedOn}`, open = true }) {
  return (
    <details className="gen-source gen-diff" open={open}>
      <summary>
        {label}: <span className="diff-add-count">+{changes.added}</span>{' '}
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

/**
 * How a version was built (plan §13n): every attempt, what the checks found in it, and what
 * the model changed to fix it. The last passing attempt is the version's own code.
 */
export function Attempts({ attempts }) {
  const builds = new Set(attempts.map((a) => a.build)).size;
  const failed = attempts.filter((a) => !a.ok).length;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return (
    <details className="gen-source gen-attempts">
      <summary>
        How it was built: {plural(attempts.length, 'attempt')}
        {failed > 0 && ` (${failed} failed)`}
        {builds > 1 && `, in ${builds} builds`}
      </summary>
      <ol className="gen-attempt-list">
        {attempts.map((a) => {
          const name = builds > 1 ? `Build ${a.build}, attempt ${a.attempt}` : `Attempt ${a.attempt}`;
          const problems = a.report?.problems ?? [];
          const tokens = a.promptTokens ? ` · ${a.promptTokens.toLocaleString()} tokens in, ${(a.completionTokens ?? 0).toLocaleString()} out` : '';
          return (
            <li key={`${a.build}-${a.attempt}`} aria-label={name}>
              <p>
                <strong>{name}</strong>: {a.ok ? '✓ passed' : plural(problems.length, 'problem')}
                <span className="muted small">
                  {a.mode === 'edits' && ' · edits'}
                  {a.seconds !== null && ` · ${a.seconds} s`}
                  {tokens}
                </span>
              </p>
              {!a.ok && problems.length > 0 && <Findings items={problems} />}
              {a.changes && <ChangedLines changes={a.changes} label={`Changed lines since attempt ${a.attempt - 1}`} open={false} />}
              {a.source && (
                <details className="gen-source">
                  <summary>Code ({a.source.split('\n').length} lines)</summary>
                  <SourceCode source={a.source} report={a.report} />
                </details>
              )}
            </li>
          );
        })}
      </ol>
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
/**
 * A design (or a change's plan) waiting for you: read it, then Build it, ask the AI for a new
 * draft, or edit it yourself. Earlier drafts are kept below.
 */
export function DesignEditor({ version: v, isPlan, busy, info, canDiscard, onRedesign, onSaveDesign, onBuild, onDiscard, banner = true }) {
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v.design);
  const what = isPlan ? 'plan' : 'design';
  const feedbackLength = feedback.trim().length;

  return (
    <div className="gen-design-editor">
      {banner && (
        <p className="banner" role="status">
          {v.status === 'failed'
            ? `The build failed. Change the ${what} and build again, or just build again.`
            : `Read the ${what}. Nothing is built until you press Build it.`}
        </p>
      )}
      {v.drafts.length > 0 && v.drafts.at(-1).feedback && (
        <p className="muted small">
          This draft was written after: <q>{v.drafts.at(-1).feedback}</q>
        </p>
      )}
      {editing ? (
        <label className="admin-form">
          Edit the {what} (Markdown)
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(30, draft.split('\n').length + 2)} maxLength={info.maxDesignLength} />
        </label>
      ) : (
        <div className="card gen-design-text" aria-label={`The ${what}`}>
          <Markdown text={v.design} headingOffset={3} />
        </div>
      )}
      <div className="gen-actions">
        {editing ? (
          <>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={async () => {
                if (await onSaveDesign(draft)) setEditing(false);
              }}
            >
              Save my edit
            </button>
            <button type="button" className="secondary-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="primary-button" disabled={busy || !info.enabled} onClick={onBuild}>
              {v.status === 'failed' ? 'Build it again' : 'Build it'}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(true)}>
              Edit it myself
            </button>
            {canDiscard && (
              <button type="button" className="secondary-button danger-button" disabled={busy} onClick={onDiscard}>
                Discard v{v.version}
              </button>
            )}
          </>
        )}
      </div>
      {!editing && (
        <form
          className="admin-form gen-change"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onRedesign(feedback)) setFeedback('');
          }}
        >
          <label>
            Ask the AI for a new draft
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              maxLength={info.maxIdeaLength}
              placeholder={isPlan ? 'e.g. Keep the old levels; only add the new one at the end.' : 'e.g. Make it 2 rounds, and let the phones pick a colour.'}
              disabled={!info.enabled}
            />
          </label>
          <button type="submit" className="secondary-button" disabled={busy || !info.enabled || feedbackLength < info.minFeedbackLength}>
            Write a new draft
          </button>
        </form>
      )}
      {v.drafts.length > 1 && (
        <details className="gen-drafts">
          <summary>Earlier drafts ({v.drafts.length - 1})</summary>
          <ol>
            {v.drafts.slice(0, -1).map((d, i) => (
              <li key={i}>
                <p className="muted small">
                  {d.by === 'admin' ? 'Your edit' : 'By the AI'}
                  {d.feedback && (
                    <>
                      , after: <q>{d.feedback}</q>
                    </>
                  )}{' '}
                  · {formatTime(d.at)}
                </p>
                <Markdown text={d.text} headingOffset={4} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** The checks' results (plan §13i, F4): problems, lines worth a look, and the playtest. */
export function Report({ report }) {
  const problems = report.problems ?? [];
  const warnings = report.warnings ?? [];
  return (
    <div className="gen-report">
      {report.ok ? (
        <p className="gen-report-ok">✓ Passed every check: {report.checked ?? 'the game file'}.</p>
      ) : (
        <p>
          <strong>
            The checks found {problems.length} problem{problems.length === 1 ? '' : 's'}
          </strong>
          {report.checked && <span className="muted small"> (checked {report.checked})</span>}:
        </p>
      )}
      {problems.length > 0 && <Findings items={problems} />}
      {warnings.length > 0 && (
        <>
          <p className="small">
            <strong>Worth a look</strong> (these don't fail it):
          </p>
          <Findings items={warnings} />
        </>
      )}
      {report.playtest && <PlaytestResult playtest={report.playtest} />}
    </div>
  );
}

/** A list of findings: a sentence, or { message, screen?, line?, code?, count?, where? }. */
function Findings({ items }) {
  return (
    <ol className="gen-findings">
      {items.map((f, i) => {
        if (typeof f === 'string') return <li key={i}>{withCode(f)}</li>;
        const about = [f.screen, f.line && f.code ? `line ${f.line}` : null, f.count > 1 ? `${f.count} times` : null].filter(Boolean);
        return (
          <li key={i}>
            {withCode(f.message)}
            {about.length > 0 && <span className="muted small"> ({about.join(' · ')})</span>}
            {f.where && <span className="muted small"> (first seen with {f.where})</span>}
            {f.code && <code className="gen-finding-code">{f.code}</code>}
          </li>
        );
      })}
    </ol>
  );
}

/** Text with `code` in backticks, as React elements (never as HTML). */
function withCode(text) {
  return String(text)
    .split('`')
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/** What happened in the headless-browser playtest, with its screenshots. */
function PlaytestResult({ playtest: t }) {
  return (
    <div className="gen-playtest">
      <p className="small">
        In the playtest, {t.players} simulated phone{t.players === 1 ? '' : 's'} sent {t.eventsFromPhones} events and the big screen sent{' '}
        {t.updatesToPhones} updates. {t.ended ? `The game ended after ${t.endedAfterSeconds} s.` : `It was still going after ${t.seconds} s.`}
      </p>
      {t.screenshots && (
        <div className="gen-shots">
          {t.screenshots.host && (
            <figure>
              <img src={t.screenshots.host} alt="The big screen during the playtest" />
              <figcaption className="small muted">Big screen</figcaption>
            </figure>
          )}
          {t.screenshots.phone && (
            <figure className="gen-shot-phone">
              <img src={t.screenshots.phone} alt="A phone during the playtest" />
              <figcaption className="small muted">Phone</figcaption>
            </figure>
          )}
        </div>
      )}
    </div>
  );
}

/** A game's code as text, with line numbers; lines the checks flagged are marked. */
export function SourceCode({ source, report }) {
  const flagged = new Map();
  for (const f of [...(report?.problems ?? []), ...(report?.warnings ?? [])]) {
    if (typeof f === 'object' && f.line && f.code) flagged.set(f.line, [...(flagged.get(f.line) ?? []), f.message]);
  }
  return (
    <pre className="gen-code">
      <code>
        {source.split('\n').map((text, i) => {
          const notes = flagged.get(i + 1);
          return (
            <span key={i} className={notes ? 'code-line flagged' : 'code-line'} data-line={i + 1} title={notes?.join('\n')}>
              {text}
              {'\n'}
            </span>
          );
        })}
      </code>
    </pre>
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

export function formatTime(ms) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
