import { useEffect } from 'react';

const SITE_NAME = 'BoilerGames';

/** The home page's title: the name, and what it is (search results show it, plan §33). The same as index.html's. */
const HOME_TITLE = `${SITE_NAME} · Party games for one big screen and everyone's phones`;

/** Sets the browser tab title, e.g. "Join · BoilerGames". Pass nothing for the home page's. */
export function usePageTitle(page) {
  useEffect(() => {
    document.title = page ? `${page} · ${SITE_NAME}` : HOME_TITLE;
  }, [page]);
}

/**
 * Tells search engines not to list this page (plan §33): for "not found" screens. The server
 * already answers a missing page, game or account with 404; this covers the rest (a game
 * that disappears while you're on its page).
 */
export function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.append(meta);
    return () => meta.remove();
  }, []);
}

/** useNoIndex as a component, for a "not found" screen that's one branch of a page. */
export function NoIndex() {
  useNoIndex();
  return null;
}
