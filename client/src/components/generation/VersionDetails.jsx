// How a version of an AI-made game was made, for the curious (/create/<id>) and for admins:
// the checks' report, every build attempt, the lines that changed, and the code itself.

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
