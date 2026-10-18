import { reportHref } from './report.js';

/** Pages with no footer: the room screens (shown to a whole room) and the report form itself. */
const NO_FOOTER = ['/host', '/join', '/report'];

/**
 * At the bottom of most pages (plan §31c): the site is being tested, and how to report a problem.
 * Then that it has nothing to do with Purdue University as an institution.
 */
export default function SiteFooter({ path }) {
  // Without the footer, still leave room at the bottom so the "(demo)" badge covers nothing.
  if (NO_FOOTER.includes(path)) return <div className="demo-badge-room" />;
  return (
    <footer className="site-footer">
      <p>
        BoilerGames is still in an early testing phase and I'd love your feedback!{' '}
        <a href={reportHref()}>Report an issue</a>
      </p>
      <p className="site-footer-disclaimer">
        BoilerGames is an independent student project. It is <strong>not</strong> affiliated with, endorsed by, sponsored
        by, or in any way sanctioned by Purdue University. Not even slightly.
      </p>
    </footer>
  );
}
