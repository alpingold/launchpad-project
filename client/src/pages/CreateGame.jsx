import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../net/auth.js';
import {
  useOwnGamesApi,
  listGenerations,
  getGeneration,
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
import CodeReview from '../components/generation/CodeReview.jsx';
import { timeAgo } from '../components/timeAgo.js';
import ChangeForm from '../components/generation/ChangeForm.jsx';
import { DesignEditor } from '../components/generation/DesignEditor.jsx';
import { ChangedLines, Attempts, Report, SourceCode } from '../components/generation/VersionDetails.jsx';
import { POLL_MS, VERSION_STATUS_TEXT, PLAN_STATUS_TEXT } from '../components/generation/text.js';

// One game you're making with AI, /create/<id> (plan §19): a board-game track shows the four
// steps (Idea → Design → Build → Play, or Change → Plan → Build → Play for a change), and
// the panel below shows only what this step needs from you. Everything else (versions,
// checks, code) is folded away under "For the curious".
//
// Same API and rules as the admin page (the server checks everything); this page only
// decides what to show. While something is being made it asks for the (small) list every
// 2 s, and fetches the full game (with its code) only when it changed.

const STEPS_NEW = ['Idea', 'Design', 'Build', 'Play'];
const STEPS_CHANGE = ['Change', 'Plan', 'Build', 'Play'];

/**
 * Where a game is, from its newest version: which space of the track (0–3) and what's
 * happening there. `working`: the AI is on it; `yours`: waiting for you; `failed`.
 * @returns {{ at: number, state: 'working' | 'yours' | 'failed' }}
 */
export function whereIs(version) {
  switch (version.status) {
    case 'designing':
      return { at: 1, state: 'working' };
    case 'design_ready':
      return { at: 1, state: 'yours' };
    case 'generating':
      return { at: 2, state: 'working' };
    case 'failed':
      return { at: version.design === null ? 1 : 2, state: 'failed' };
    default:
      return { at: 3, state: 'yours' };
  }
}

/** The same, from a list summary (it has no versions): close enough for the list's small track. */
export function whereIsSummary(game) {
  const at = { designing: 1, design: 1, generating: 2, failed: 2 }[game.status] ?? 3;
  const state = game.status === 'failed' ? 'failed' : game.progress ? 'working' : 'yours';
  return { at, state };
}

/** The first letter of a game's name, for its token. */
const initialOf = (text) => (text?.trim()[0] ?? '?').toUpperCase();

/**
 * The board track: four spaces joined by a path, with the game's token on the space it's at.
 * When the game moves on, the token hops to the new space (unless reduced motion is on).
 * @param {{ labels: string[], at: number, state: string, initial: string }} props
 */
export function Track({ labels, at, state, initial }) {
  // Hop only when the game moved while you watched, not when the page first draws.
  const first = useRef(at);
  const moved = first.current !== at;
  return (
    <ol className={`track track-${state}`} aria-label={`Step ${at + 1} of ${labels.length}: ${labels[at]}`}>
      {labels.map((label, i) => (
        <li key={label} className={`track-space ${i < at ? 'passed' : i === at ? 'here' : 'ahead'}`} aria-current={i === at ? 'step' : undefined}>
          <span className="track-dot">
            {i === at ? (
              <span key={at} className={`track-token${moved ? ' hop' : ''}`} aria-hidden="true">
                {initial}
              </span>
            ) : (
              <span aria-hidden="true">{i + 1}</span>
            )}
          </span>
          <span className="track-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** The list's version of the track: four dots, no words (the row says the status). */
export function MiniTrack({ at, state }) {
  return (
    <span className={`mini-track track-${state}`} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={i < at ? 'passed' : i === at ? 'here' : 'ahead'} />
      ))}
    </span>
  );
}

export default function CreateGame({ id }) {
  useOwnGamesApi(); // /api/generations: your own games
  const user = useCurrentUser();
  const [info, setInfo] = useState(null);
  const [summary, setSummary] = useState(null);
  const [game, setGame] = useState(null); // the full game: versions with designs, reports, code
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  usePageTitle(summary?.name ?? 'Make a game');

  useEffect(() => {
    if (user === null) window.location.replace(`/login?next=${encodeURIComponent(`/create/${id}`)}`);
  }, [user, id]);

  const refresh = useCallback(async () => {
    const res = await listGenerations();
    if (!res.ok) return setError(res.message ?? 'Could not load your game.');
    setInfo(res.info);
    const found = res.games.find((g) => g.id === id) ?? null;
    setMissing(found === null);
    setSummary(found);
  }, [id]);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  // The full game, again whenever it changed.
  const updatedAt = summary?.updatedAt;
  useEffect(() => {
    if (updatedAt === undefined) return undefined;
    let current = true;
    getGeneration(id).then((res) => {
      if (!current) return;
      if (res.ok) setGame(res.game);
      else setError(res.message ?? 'Could not load your game.');
    });
    return () => {
      current = false;
    };
  }, [id, updatedAt]);

  // Keep asking while the AI is on it (or it waits in line).
  const working = Boolean(summary?.progress) || ['designing', 'generating'].includes(summary?.status);
  useEffect(() => {
    if (!working) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [working, refresh]);

  /** Sends one move; on success shows the game as the server now has it. */
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
    await refresh();
    return true;
  }

  async function remove() {
    const queued = summary.progress !== null;
    if (!window.confirm(queued ? 'Stop making this game? It is deleted.' : 'Delete this game and every version of it for good?')) return;
    setBusy(true);
    const res = await deleteGeneration(id);
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Something went wrong.');
    window.location.assign('/create');
  }

  if (missing) {
    return (
      <main className="page create">
        <BackLink />
        <h1 className="create-title">No such game</h1>
        <p>It may have been deleted, or it belongs to another account.</p>
      </main>
    );
  }
  if (!summary || !game || !info) {
    return (
      <main className="page create">
        <BackLink />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">Loading your game…</p>
        )}
      </main>
    );
  }

  const latest = game.versions.at(-1);
  const isChange = latest.basedOn !== null;
  const where = whereIs(latest);
  const name = summary.name ?? latest.name ?? 'Your new game';
  const running = summary.progress?.queuePosition === 0;
  const canDiscard = latest.version > 1 && ['design_ready', 'failed'].includes(latest.status);

  return (
    <main className="page create">
      <BackLink />
      <header className="create-hero">
        <h1 className="create-title">{name}</h1>
        <p className="create-idea">
          {isChange ? 'Your change: ' : 'Your idea: '}
          <q>{isChange ? latest.request : summary.prompt}</q>
        </p>
      </header>

      <Track labels={isChange ? STEPS_CHANGE : STEPS_NEW} at={where.at} state={where.state} initial={initialOf(name === 'Your new game' ? summary.prompt : name)} />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="create-panel" aria-live="polite">
        {where.state === 'working' && <Working progress={summary.progress} version={latest} isChange={isChange} />}

        {where.state === 'failed' && latest.design === null && (
          <>
            <h2>The AI couldn't write {isChange ? 'a plan' : 'a design'}</h2>
            <p>{sentence(latest.error ?? 'It stopped without saying why')}</p>
            <p>
              {canDiscard
                ? 'Throw this change away and ask again, maybe in different words.'
                : 'Delete this game and try again, maybe with a few more words about how it plays.'}
            </p>
            <div className="gen-actions">
              {canDiscard ? (
                <button type="button" className="primary-button" disabled={busy} onClick={() => run(() => discardVersion(id, latest.version))}>
                  Throw this change away
                </button>
              ) : (
                <button type="button" className="primary-button" disabled={busy} onClick={remove}>
                  Delete and start over
                </button>
              )}
            </div>
          </>
        )}

        {latest.design !== null && (latest.status === 'design_ready' || latest.status === 'failed') && (
          <>
            <h2>
              {latest.status === 'failed'
                ? "The build didn't pass the checks"
                : isChange
                  ? 'Read the plan'
                  : 'Read the design'}
            </h2>
            {latest.status === 'failed' && latest.error && <p className="error">{sentence(latest.error)}</p>}
            <p className="muted">
              {latest.status === 'failed'
                ? `Change the ${isChange ? 'plan' : 'design'} and build again, or just build again: the AI often gets it the second time.`
                : 'Nothing is built until you press Build it. Change anything you like first: edit it yourself, or tell the AI what to change.'}
            </p>
            {latest.status === 'design_ready' && latest.error && (
              <p className="error">The new draft failed: {latest.error} Here's the last one.</p>
            )}
            <DesignEditor
              key={latest.drafts.length}
              banner={false}
              version={latest}
              isPlan={isChange}
              busy={busy}
              info={info}
              canDiscard={canDiscard}
              onRedesign={(feedback) => run(() => redesignVersion(id, latest.version, feedback))}
              onSaveDesign={(design) => run(() => saveDesign(id, latest.version, design))}
              onBuild={() => run(() => buildVersion(id, latest.version))}
              onDiscard={() =>
                run(() => discardVersion(id, latest.version), `Throw away this change? Its plan and request are deleted.`)
              }
            />
          </>
        )}

        {latest.status === 'ready' && <ReadyToPlay summary={summary} game={game} version={latest} info={info} busy={busy} run={run} />}
      </section>

      <StillPlayable summary={summary} latest={latest} />

      <History game={game} summary={summary} />

      {!running && (
        <p className="create-delete">
          <button type="button" className="link-button danger-link" onClick={remove} disabled={busy}>
            {summary.progress !== null ? 'Stop and delete this game' : 'Delete this game'}
          </button>
        </p>
      )}
    </main>
  );
}

function BackLink() {
  return (
    <p className="create-back">
      <a href="/create">← Your games</a>
    </p>
  );
}

/** The AI is on it: what it's doing now, how long it's been, and that you can leave. */
function Working({ progress, version, isChange }) {
  const what = version.kind === 'recheck' ? 'Reviewing the code' : version.status === 'generating' ? 'Building your game' : isChange ? 'Writing the plan' : 'Writing the design';
  if (progress?.queuePosition > 0) {
    return (
      <>
        <h2>Waiting in line</h2>
        <p>
          Your game is number {progress.queuePosition} in line. It starts by itself; you can close this page and come back.
        </p>
      </>
    );
  }
  const steps = progress?.steps ?? [];
  const now = steps.at(-1);
  return (
    <>
      <h2>{what}…</h2>
      <p className="create-now" role="status">
        {now ? capitalize(now.text) : 'Starting up'}
        {now && <span className="muted"> ({formatSeconds(now.seconds)} in)</span>}
      </p>
      <p className="muted">
        {version.status === 'generating'
          ? version.kind === 'recheck'
            ? 'An AI reads the code against the design, looking for bugs. If it finds a crash or a dead end, it fixes it, and the fixed game goes through the checks again. This usually takes about ten minutes.'
            : 'The AI writes the game, then plays it in a hidden browser with pretend phones. If the checks find a problem, it fixes it and tries again. Then another AI reads the code, looking for bugs the checks can miss, and fixes any crash or dead end it finds. This usually takes 15–25 minutes.'
          : 'This usually takes a minute or two.'}{' '}
        You can close this page and come back: it keeps going.
      </p>
      {version.designFeedback && version.status === 'designing' && (
        <p className="muted small">
          You asked for: <q>{version.designFeedback}</q>
        </p>
      )}
      {steps.length > 1 && (
        <details className="create-log">
          <summary>What it's done so far</summary>
          <ol>
            {steps.map((step, i) => (
              <li key={i}>
                <span className="muted">{formatSeconds(step.seconds)}</span> {step.text}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The server's short messages as a sentence: "no passing game" → "No passing game." */
const sentence = (text) => capitalize(/[.!?]$/.test(text) ? text : `${text}.`);

const formatSeconds = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/** The newest version passed the checks: its screenshots, Play it now, and ask for changes. */
function ReadyToPlay({ summary, game, version: v, info, busy, run }) {
  const shots = v.report?.playtest?.screenshots;
  const hostUrl = `/host?game=${encodeURIComponent(`${summary.id}-v${v.version}`)}`;
  const isPlaytest = summary.playtestVersion === v.version;
  const isPublished = summary.publishedVersion === v.version;

  async function play() {
    // Only the playtest version can be started (by you); make this one it, then open a room.
    if (!isPlaytest && !(await run(() => playtestVersion(summary.id, v.version)))) return;
    window.location.assign(hostUrl);
  }

  return (
    <>
      <h2>{v.basedOn === null ? 'Your game is ready' : `Version ${v.version} is ready`}</h2>
      {v.description && <p>{v.description}</p>}
      {shots && (
        <div className="create-shots">
          {shots.host && <img src={shots.host} alt="The big screen while the AI tested the game" />}
          {shots.phone && <img className="create-shot-phone" src={shots.phone} alt="A phone while the AI tested the game" />}
        </div>
      )}
      {v.changelog && (
        <div className="create-changelog">
          <p>What changed:</p>
          <ul>
            {v.changelog.split('\n').map((line, i) => (
              <li key={i}>{line.replace(/^- /, '')}</li>
            ))}
          </ul>
        </div>
      )}
      {v.codeReview && (
        <CodeReview
          review={v.codeReview}
          busy={busy}
          canAct={info.enabled && !game.versions.some((x) => ['designing', 'design_ready', 'generating'].includes(x.status))}
          maxRequestLength={info.maxRequestLength}
          onFix={(text) => run(() => requestChanges(summary.id, text, v.version, true), 'Ask the AI to fix these? It makes a new version with the fix.')}
          onReviewAgain={() => run(() => reviewAgain(summary.id, v.version), 'Review the code again? It takes about ten minutes, and makes a new version if it fixes anything.')}
        />
      )}
      {!info.isAdmin && !isPublished && summary.reviewNote && !summary.waitingForApproval && (
        <div className="banner create-review-note" role="status">
          <p>
            <strong>Not published yet.</strong> The site admin's note:
          </p>
          <p className="create-review-note-text">{summary.reviewNote}</p>
          <p className="small">Ask for changes below, then submit it again.</p>
        </div>
      )}
      {!info.isAdmin && isPlaytest && summary.waitingForApproval && (
        <div className="banner create-waiting" role="status">
          <p>
            <strong>Waiting for approval.</strong> The site admin will play it, then publish it for everyone or send it back
            with a note.
          </p>
          <button type="button" className="link-button" disabled={busy} onClick={() => run(() => actOnGeneration(summary.id, 'withdraw'))}>
            Take back the request
          </button>
        </div>
      )}
      <div className="gen-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={play}>
          Play it now
        </button>
        {!info.isAdmin && !isPublished && !(isPlaytest && summary.waitingForApproval) && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={async () => {
              // The request is for the version you're playtesting: make this one it first.
              if (!isPlaytest && !(await run(() => playtestVersion(summary.id, v.version)))) return;
              await run(() => actOnGeneration(summary.id, 'submit'), 'Submit it for publishing? The site admin will play it and decide.');
            }}
          >
            Submit for publishing
          </button>
        )}
        {info.isAdmin && !isPublished && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={async () => {
              if (!isPlaytest && !(await run(() => playtestVersion(summary.id, v.version)))) return;
              await run(() => actOnGeneration(summary.id, 'publish'), 'Publish it? Every host will be able to start it.');
            }}
          >
            Publish for everyone
          </button>
        )}
      </div>
      <p className="muted small">
        {isPublished
          ? 'Everyone can play this version.'
          : "Only you can start it for now. Open it on a big screen (a laptop or TV) and your friends join on their phones. When you're happy with it, submit it: the site admin plays it and decides whether everyone gets it."}
      </p>
      <ChangeForm
        game={game}
        info={info}
        disabled={!info.enabled || busy}
        onAsk={(text, basedOn, smallFix) => run(() => requestChanges(summary.id, text, basedOn, smallFix))}
      />
    </>
  );
}

/** While a change is in the works (or failed), an older version you can still play. */
function StillPlayable({ summary, latest }) {
  const playable = summary.playtestVersion ?? summary.publishedVersion;
  if (playable === null || playable === latest.version) return null;
  return (
    <p className="create-still">
      Version {playable} still works while you change it:{' '}
      <a href={`/host?game=${encodeURIComponent(`${summary.id}-v${playable}`)}`}>play version {playable}</a>.
    </p>
  );
}

/** For the curious: every version, what was asked, the checks' report, how it was built, and the code. */
function History({ game, summary }) {
  return (
    <details className="create-curious">
      <summary>For the curious: every version, the checks and the code</summary>
      <p className="muted small">
        Game id <code>{summary.id}</code>, made with <code>{summary.model}</code>. A game is one web page that runs in a
        locked-down frame on the big screen and the phones; the AI follows the <a href="/kit">docs</a>.
      </p>
      {[...game.versions].reverse().map((v) => {
        const statusText = (v.basedOn === null ? VERSION_STATUS_TEXT : PLAN_STATUS_TEXT)[v.status];
        return (
          <article key={v.version} className="create-version" aria-label={`Version ${v.version}`}>
            <h3>
              Version {v.version} <span className={`status-chip status-${v.status}`}>{statusText}</span>
            </h3>
            <p className="small">
              {v.basedOn === null ? (
                'Made from your idea'
              ) : (
                <>
                  Changed from version {v.basedOn}: <q>{v.request}</q>
                </>
              )}
              , {timeAgo(v.createdAt)}.
            </p>
            {v.design !== null && (
              <details className="gen-source">
                <summary>{v.basedOn === null ? 'The design' : 'The plan'}</summary>
                <Markdown text={v.design} headingOffset={3} />
              </details>
            )}
            {v.report && <Report report={v.report} />}
            {v.attempts?.length > 0 && <Attempts attempts={v.attempts} />}
            {v.changes && <ChangedLines changes={v.changes} basedOn={v.basedOn} label={`Changed lines since version ${v.basedOn}`} open={false} />}
            {v.source && (
              <details className="gen-source">
                <summary>The code ({v.source.split('\n').length} lines)</summary>
                <SourceCode source={v.source} report={v.report} />
              </details>
            )}
          </article>
        );
      })}
    </details>
  );
}
