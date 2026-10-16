/**
 * The "← BoilerGames" link in the top-left corner of every page except the home page,
 * opposite the site's links and the ⚙ settings button (App.jsx's header). A plain link: it does a full page load (decision D12).
 *
 * Leaving a room page this way is safe to undo: the room tokens stay in sessionStorage,
 * so going back to /host or /join reconnects within the grace period.
 */
export default function HomeLink() {
  return (
    <nav className="home-nav" aria-label="Site">
      <a href="/" className="home-link">
        <span aria-hidden="true">←</span>
        <span className="home-link-text">BoilerGames</span>
      </a>
    </nav>
  );
}
