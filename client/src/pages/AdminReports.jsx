import { useCallback, useEffect, useState } from 'react';
import { formatTime } from './Admin.jsx';

// The admin's "Reports" tab (plan §31c): what people sent from the /report form, newest first.
// "Done" marks one dealt with (it stays, faded); "Delete" removes it for good. Below them, the
// newest reports from game pages (§31b), which are dealt with on those pages.

const KIND_TEXT = { bug: 'Broken', idea: 'Idea', other: 'Other' };

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

export default function AdminReports() {
  const [reports, setReports] = useState(null);
  const [gameReports, setGameReports] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const res = await call('/api/admin/reports');
    if (res.ok) {
      setReports(res.reports);
      setGameReports(res.gameReports);
    }
    else setError(res.message ?? 'Could not load the reports.');
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(path, method, body) {
    setError(null);
    const res = await call(path, { method, body });
    if (!res.ok) setError(res.message ?? 'Something went wrong.');
    refresh();
  }

  const open = reports?.filter((r) => r.doneAt === null).length ?? 0;
  return (
    <main className="page admin">
      <h1>Reports</h1>
      <p className="muted">
        From the <a href="/report">report form</a>, newest first{reports && ` · ${open} not done yet`}. Reports about
        one game are on that game's page.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {reports === null && !error && <p className="muted">Loading…</p>}
      {reports?.length === 0 && <p className="muted">No reports yet.</p>}
      <ul className="report-list">
        {reports?.map((r) => (
          <li key={r.id} className={`card site-report${r.doneAt ? ' is-done' : ''}`}>
            <p className="report-meta muted small">
              <span className={`report-kind kind-${r.kind}`}>{KIND_TEXT[r.kind]}</span>
              {formatTime(r.createdAt)} · {r.username ? <a href={`/u/${encodeURIComponent(r.username)}`}>{r.username}</a> : 'logged out'}
              {r.page && (
                <>
                  {' · '}
                  <a href={r.page} className="mono">
                    {r.page}
                  </a>
                </>
              )}
              {r.device && ` · ${r.device}`}
            </p>
            <p className="report-body">{r.body}</p>
            <div className="report-actions">
              <button type="button" className="secondary-button" onClick={() => act(`/api/admin/reports/${r.id}/done`, 'POST', { done: !r.doneAt })}>
                {r.doneAt ? 'Not done' : 'Done'}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => window.confirm('Delete this report for good?') && act(`/api/admin/reports/${r.id}`, 'DELETE')}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {gameReports.length > 0 && (
        <section aria-labelledby="game-reports-heading">
          <h2 id="game-reports-heading">On game pages</h2>
          <p className="muted">The newest {gameReports.length}. Vote, mark fixed or delete them on the game's page.</p>
          <ul className="report-list">
            {gameReports.map((r) => (
              <li key={r.id} className={`card site-report${r.fixed ? ' is-done' : ''}`}>
                <p className="report-meta muted small">
                  <a href={`/games/${encodeURIComponent(r.gameId)}#reports`}>{r.gameName ?? r.gameId}</a> · total {r.score} ·{' '}
                  {formatTime(r.createdAt)} · {r.author}
                  {r.device && ` · ${r.device}`}
                  {r.fixed && ' · fixed'}
                </p>
                <p className="report-body">{r.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
