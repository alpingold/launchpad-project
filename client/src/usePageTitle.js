import { useEffect } from 'react';

const SITE_NAME = 'LaunchPad Party';

/** Sets the browser tab title, e.g. "Join · LaunchPad Party". Pass nothing for just the site name. */
export function usePageTitle(page) {
  useEffect(() => {
    document.title = page ? `${page} · ${SITE_NAME}` : SITE_NAME;
  }, [page]);
}
