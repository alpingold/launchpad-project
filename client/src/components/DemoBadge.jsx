import { reportHref } from './report.js';

/**
 * "(demo)" in the bottom-left corner of every page (plan §31a): the site is still being tested.
 * It's also a way to report a problem. Hidden while a game is on screen (styles.css: body.in-game).
 */
export default function DemoBadge() {
  return (
    <a className="demo-badge" href={reportHref()} title="BoilerGames is a demo. Found a problem? Report it here.">
      (demo)
    </a>
  );
}
