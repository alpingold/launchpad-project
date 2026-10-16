import { useCurrentUser } from '../net/auth.js';

/**
 * The links at the top right of every page (plan §16), next to ⚙: the game catalogue, the
 * docs, and Sign up (logged out) or Account (logged in). Plain links: full page loads (D12).
 * Hidden while a game is on screen (styles.css: body.in-game).
 */
export default function SiteNav() {
  const user = useCurrentUser(); // undefined while checking: show nothing for that slot yet
  const here = window.location.pathname.replace(/\/+$/, '') || '/';
  const link = (href, text) => (
    <a href={href} aria-current={here === href || here.startsWith(`${href}/`) ? 'page' : undefined}>
      {text}
    </a>
  );
  return (
    <nav className="site-nav" aria-label="Pages">
      {link('/games', 'Games')}
      {link('/kit', 'Docs')}
      {user && link('/account', 'Account')}
      {user === null && link(`/login?mode=signup&next=${encodeURIComponent(here === '/login' ? '/' : here)}`, 'Sign up')}
    </nav>
  );
}
