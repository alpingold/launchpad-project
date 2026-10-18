import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../net/auth.js';

/**
 * The links at the top right of every page (plan §16): the game catalogue, making
 * a game with AI (in gold: what the site is for, §42), the docs, and Sign up (logged out) or Account (logged in). Plain links: full
 * page loads (D12). On narrow screens (phones) they fold into a ☰ menu, so the header stays one
 * line. Hidden while a game is on screen (styles.css: body.in-game).
 */
export default function SiteNav() {
  const user = useCurrentUser(); // undefined while checking: show nothing for that slot yet
  const [open, setOpen] = useState(false); // the ☰ menu (phones)
  const menuRef = useRef(null);

  // The menu closes on Escape or a click anywhere else.
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);
  const here = window.location.pathname.replace(/\/+$/, '') || '/';
  const links = () => {
    const link = (href, text, className) => (
      <a href={href} className={className} aria-current={here === href || here.startsWith(`${href}/`) ? 'page' : undefined}>
        {text}
      </a>
    );
    return (
      <>
        {link('/games', 'Games')}
        {link('/create', 'Make a game', 'site-nav-make')}
        {link('/kit', 'Docs')}
        {user && link('/account', 'Account')}
        {user === null && link(`/login?mode=signup&next=${encodeURIComponent(here === '/login' ? '/' : here)}`, 'Sign up')}
      </>
    );
  };
  return (
    <>
      <nav className="site-nav" aria-label="Pages">
        {links()}
      </nav>
      {/* Phones: the same links behind a ☰ button. */}
      <div className="site-menu" ref={menuRef}>
        <button type="button" className="site-menu-button" aria-label="Menu" title="Menu" aria-expanded={open} aria-controls="site-menu-links" onClick={() => setOpen((o) => !o)}>
          ☰
        </button>
        {open && (
          <nav id="site-menu-links" className="site-menu-links" aria-label="Pages">
            {links()}
          </nav>
        )}
      </div>
    </>
  );
}
