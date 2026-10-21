// What the AI's code review of a version found (plan §47), for the game's creator: every build
// is reviewed for crashes and dead ends, which are fixed right away; any it couldn't fix are
// listed here, with a button that asks the AI to fix them (a small fix: a new version). "Review
// again" runs one more review round. Shown on the creator's page and the admin page. (Reviews
// from before 2026-10-21 also listed smaller bugs and the design's missing items: still shown.)

/** What each kind of bug is called here. */
const SEVERITY_TEXT = { crash: 'Crash', stuck: 'Dead end', spoils: 'Plays wrong', minor: 'Minor' };

/**
 * The change request for the bugs still open (a small fix). Cut to fit the request limit:
 * the worst come first.
 */
export function fixFindingsRequest(bugs, maxLength) {
  const head = 'A code review found these problems. Fix each one, and change nothing else:';
  const lines = [];
  for (const b of bugs) {
    const line = `- ${b.what}`;
    if ([head, ...lines, line].join('\n').length > maxLength) {
      // Always at least one, cut to fit.
      if (lines.length === 0) lines.push(line.slice(0, maxLength - head.length - 1));
      break;
    }
    lines.push(line);
  }
  return [head, ...lines].join('\n');
}

/**
 * @param {{ review: object, busy: boolean, canAct: boolean, maxRequestLength: number,
 *   onFix: (request: string) => void, onReviewAgain: () => void }} props
 *   canAct: false while another version is being made (the buttons would be refused)
 */
export default function CodeReview({ review, busy, canAct, maxRequestLength, onFix, onReviewAgain }) {
  const fixed = review.bugs?.filter((b) => b.fixed) ?? [];
  const order = Object.keys(SEVERITY_TEXT);
  const open = (review.bugs?.filter((b) => !b.fixed) ?? []).sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const missing = review.missing ?? [];
  const critical = open.filter((b) => b.severity === 'crash' || b.severity === 'stuck');

  return (
    <section className="code-review" aria-label="The AI's code review">
      <h3>The AI's code review</h3>
      {review.error ? (
        <p className="muted">
          The review couldn't finish this time. The game passed its checks; you can ask for another review below.
        </p>
      ) : (
        <>
          <p className="muted small">An AI read the code looking for crashes and dead ends the automatic checks can miss.</p>
          {fixed.length > 0 && (
            <div className="code-review-fixed">
              <p>It found and fixed:</p>
              <ul>
                {fixed.map((b, i) => (
                  <li key={i}>
                    <span className={`severity-chip severity-${b.severity}`}>{SEVERITY_TEXT[b.severity]}</span> {b.what}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.fix && !review.fix.ok && critical.length > 0 && (
            <p className="banner small" role="status">
              It tried to fix the {critical.length === 1 ? 'crash or dead end' : 'crashes and dead ends'} below, but the fixed game
              didn't pass the checks, so this version is the game as it was.
            </p>
          )}
          {open.length > 0 ? (
            <div className="code-review-open">
              <p>Worth a look:</p>
              <ul>
                {open.map((b, i) => (
                  <li key={i}>
                    <span className={`severity-chip severity-${b.severity}`}>{SEVERITY_TEXT[b.severity]}</span> {b.what}
                  </li>
                ))}
              </ul>
              <p className="muted small">The reviewer can be wrong: play the game to see.</p>
            </div>
          ) : (
            fixed.length === 0 && <p>It found no crashes or dead ends.</p>
          )}
          {missing.length > 0 && (
            <details className="code-review-missing">
              <summary>
                {missing.length} thing{missing.length === 1 ? '' : 's'} from the design it couldn't find in the game
              </summary>
              <ul>
                {missing.map((m, i) => (
                  <li key={i}>
                    {m.text}
                    {m.status === 'wrong' && m.note && <span className="muted"> (it does this instead: {m.note})</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <div className="gen-actions">
        {open.length > 0 && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !canAct}
            onClick={() => onFix(fixFindingsRequest(open, maxRequestLength))}
          >
            Ask the AI to fix {open.length === 1 ? 'it' : 'these'}
          </button>
        )}
        <button type="button" className="secondary-button" disabled={busy || !canAct} onClick={onReviewAgain}>
          Review again
        </button>
      </div>
    </section>
  );
}
