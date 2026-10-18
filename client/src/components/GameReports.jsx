import { useCallback, useEffect, useRef, useState } from 'react';
import { describeDevice } from './device.js';
import { timeAgo } from './timeAgo.js';

// "Bug reports" on a game's page (plan §31b): like a comment section. Each report has one
// number, its total (▲ minus ▼, can be negative), and the list is sorted by it (the server
// does that), so the problems people agree on rise and unhelpful ones sink. A report voted
// down to −5 or below folds away; fixed ones move to a folded list at the bottom.

const MIN = 10;
const MAX = 1000;
const SINKS_AT = -5; // a total this low folds the report away
const SHOWN = 20; // then "Show more"

/** Never throws: a network failure is { ok: false, message }. */
async function call(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, ...(res.status === 204 ? {} : await res.json().catch(() => ({}))) };
  } catch {
    return { ok: false, status: 0, message: "Couldn't reach the server." };
  }
}

/** @param {{ game: { id: string, name: string } }} props */
export default function GameReports({ game }) {
  const [data, setData] = useState(null); // { reports, canPost, canMarkFixed }
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(SHOWN);
  const base = `/api/games/${encodeURIComponent(game.id)}/reports`;

  const refresh = useCallback(async () => {
    const res = await call(base);
    if (res.ok) setData(res);
    else setError(res.message ?? "Couldn't load the reports.");
  }, [base]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // A link to "…#reports" (from the report form): the browser looked for this section before
  // it existed, so scroll to it once the reports are in.
  const section = useRef(null);
  const loaded = data !== null;
  useEffect(() => {
    if (loaded && window.location.hash === '#reports') section.current?.scrollIntoView();
  }, [loaded]);

  // A change to one report (a vote, fixed): swap it in and sort again, as the server would.
  function replace(report) {
    setData((d) => ({ ...d, reports: sorted(d.reports.map((r) => (r.id === report.id ? report : r))) }));
  }

  async function act(path, opts) {
    setError(null);
    const res = await call(path, opts);
    if (!res.ok) return setError(res.message ?? 'Something went wrong.');
    if (res.report) replace(res.report);
    else refresh();
  }

  const open = data?.reports.filter((r) => !r.fixed) ?? [];
  const fixed = data?.reports.filter((r) => r.fixed) ?? [];
  const item = (r) => (
    <ReportItem
      key={r.id}
      report={r}
      canMarkFixed={data.canMarkFixed}
      onVote={(value) => act(`/api/game-reports/${r.id}/vote`, { method: 'PUT', body: { value } })}
      onFixed={(value) => act(`/api/game-reports/${r.id}/fixed`, { method: 'POST', body: { fixed: value } })}
      onDelete={() => window.confirm('Delete this report?') && act(`/api/game-reports/${r.id}`, { method: 'DELETE' })}
    />
  );
  return (
    <section id="reports" ref={section} className="game-reports page-section" aria-labelledby="reports-heading">
      <h2 id="reports-heading">Bug reports</h2>
      <p className="muted">
        Something wrong with {game.name}? Say what happened. ▲ the reports you've hit too, so the problems most people
        hit rise to the top.
      </p>
      {data?.canPost ? (
        <ReportForm url={base} onPosted={refresh} />
      ) : (
        data && (
          <p>
            <a href={`/login?next=${encodeURIComponent(`${window.location.pathname}#reports`)}`}>Log in</a> to report a
            problem or vote on one.
          </p>
        )
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && open.length === 0 && <p className="muted">No open reports. Found something? You'd be the first!</p>}
      <ol className="report-list">{open.slice(0, shown).map(item)}</ol>
      {open.length > shown && (
        <button type="button" className="secondary-button" onClick={() => setShown(shown + SHOWN)}>
          Show more ({open.length - shown})
        </button>
      )}
      {fixed.length > 0 && (
        <details className="reports-fixed">
          <summary>Fixed ({fixed.length})</summary>
          <ol className="report-list">{fixed.map(item)}</ol>
        </details>
      )}
    </section>
  );
}

/** The server's order: highest total first, then newest. */
function sorted(reports) {
  return [...reports].sort((a, b) => b.score - a.score || b.createdAt - a.createdAt || b.id - a.id);
}

function ReportForm({ url, onPosted }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const length = body.trim().length;

  async function send(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await call(url, { method: 'POST', body: { body, device: describeDevice() } });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Something went wrong.');
    setBody('');
    onPosted();
  }

  return (
    <form className="admin-form report-new" onSubmit={send}>
      <label>
        Report a problem
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={MAX}
          placeholder="What you did, what you expected, and what happened instead."
        />
        <span className="muted small">
          {length}/{MAX} characters{length > 0 && length < MIN && ` (at least ${MIN})`} · your device ({describeDevice()}) is
          sent with it
        </span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary-button" disabled={busy || length < MIN}>
        Report
      </button>
    </form>
  );
}

function ReportItem({ report: r, canMarkFixed, onVote, onFixed, onDelete }) {
  const [unfolded, setUnfolded] = useState(false);
  if (!r.fixed && r.score <= SINKS_AT && !unfolded) {
    return (
      <li className="game-report is-sunk">
        <span className="muted small">Hidden: voted down ({r.score}).</span>{' '}
        <button type="button" className="link-button small" onClick={() => setUnfolded(true)}>
          Show
        </button>
      </li>
    );
  }
  const vote = (value) => onVote(r.myVote === value ? 0 : value); // pressing your vote again takes it back
  return (
    <li className="game-report">
      <div className="report-votes" role="group" aria-label="Votes">
        <button
          type="button"
          className="vote-arrow"
          aria-pressed={r.myVote === 1}
          aria-label="I've hit this too"
          title={r.canVote ? "I've hit this too" : undefined}
          disabled={!r.canVote}
          onClick={() => vote(1)}
        >
          ▲
        </button>
        <span className={`report-score${r.score < 0 ? ' is-negative' : ''}`} aria-label={`Total ${r.score}`}>
          {r.score}
        </span>
        <button
          type="button"
          className="vote-arrow"
          aria-pressed={r.myVote === -1}
          aria-label="Not helpful"
          title={r.canVote ? 'Not helpful' : undefined}
          disabled={!r.canVote}
          onClick={() => vote(-1)}
        >
          ▼
        </button>
      </div>
      <div className="game-report-main">
        <p className="report-body">{r.body}</p>
        <p className="report-meta muted small">
          <a href={`/u/${encodeURIComponent(r.author)}`}>{r.author}</a> · {timeAgo(r.createdAt)}
          {r.device && ` · ${r.device}`}
          {r.fixed && <span className="report-kind kind-fixed">Fixed</span>}
        </p>
        {(canMarkFixed || r.canDelete) && (
          <div className="report-actions small">
            {canMarkFixed && (
              <button type="button" className="link-button" onClick={() => onFixed(!r.fixed)}>
                {r.fixed ? 'Not fixed after all' : 'Mark fixed'}
              </button>
            )}
            {r.canDelete && (
              <button type="button" className="link-button" onClick={onDelete}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
