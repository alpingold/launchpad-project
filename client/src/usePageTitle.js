import { useEffect } from 'react';

const SITE_NAME = 'BoilerGames';

/** Sets the browser tab title, e.g. "Join · BoilerGames". Pass nothing for just the site name. */
export function usePageTitle(page) {
  useEffect(() => {
    document.title = page ? `${page} · ${SITE_NAME}` : SITE_NAME;
  }, [page]);
}
