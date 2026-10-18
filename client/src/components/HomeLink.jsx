/**
 * The site's name, top left on every page (plan §42): the gold B token (the favicon) and
 * "BoilerGames". On the home page it's bigger, not a link, and says "(demo)" (elsewhere the
 * corner badge does); everywhere else it's the link home. A plain link: it does a full page load (decision D12).
 *
 * Leaving a room page this way is safe to undo: the room tokens stay in sessionStorage,
 * so going back to /host or /join reconnects within the grace period.
 *
 * @param {{ home?: boolean }} props
 */
export default function HomeLink({ home = false }) {
  const mark = (
    <>
      <span className="wordmark-token" aria-hidden="true">
        B
      </span>
      <span className="wordmark-name">BoilerGames</span>
    </>
  );
  return (
    <div className={`wordmark${home ? ' wordmark-home' : ''}`}>
      {home ? (
        <span className="wordmark-mark">{mark}</span>
      ) : (
        <nav aria-label="Site">
          <a href="/" className="wordmark-mark home-link">
            {mark}
          </a>
        </nav>
      )}
      {home && <span className="demo-tag">(demo)</span>}
    </div>
  );
}
