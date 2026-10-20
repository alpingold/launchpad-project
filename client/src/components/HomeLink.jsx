/**
 * The site's name, top left on every page (plan §42): the gold B token (the favicon) and
 * "BoilerGames". On the home page it's bigger, not a link, the page's h1, and says "(demo)"
 * (elsewhere the corner badge does); everywhere else it's the link home. A plain link: it does a full page load (decision D12).
 *
 * Leaving a room page this way is safe to undo: the room tokens stay in sessionStorage,
 * so going back to /host or /join reconnects within the grace period.
 *
 * @param {{ home?: boolean }} props
 */
export default function HomeLink({ home = false }) {
  // Its B is drawn by CSS, so the name reads "BoilerGames" (not "BBoilerGames") to search
  // engines, in the link and in the home page's h1.
  const token = <span className="wordmark-token" aria-hidden="true" />;
  return (
    <div className={`wordmark${home ? ' wordmark-home' : ''}`}>
      {home ? (
        // The home page's main heading is the site's name (plan §33: search engines read it).
        <div className="wordmark-mark">
          {token}
          <h1 className="wordmark-name">BoilerGames</h1>
        </div>
      ) : (
        <nav aria-label="Site">
          <a href="/" className="wordmark-mark home-link">
            {token}
            <span className="wordmark-name">BoilerGames</span>
          </a>
        </nav>
      )}
      {home && <span className="demo-tag">(demo)</span>}
    </div>
  );
}
