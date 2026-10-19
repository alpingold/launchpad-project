import { readFileSync } from 'node:fs';
import { catalogList } from '../games/catalog.js';
import { getProfile } from '../db/users.js';

/**
 * The website's page (index.html) for one address, as search engines should see it (plan §33):
 *   - its own title and description in the HTML itself, since a crawler or a link preview may
 *     not run the JavaScript that sets them (client/src/usePageTitle.js sets the same titles)
 *   - a canonical link, so /games/ and /games count as one page
 *   - status 404, with noindex, for an address that isn't a page (a "soft 404" otherwise)
 *
 * The page addresses are the same as client/src/App.jsx's: a page added there goes here too.
 */

const SITE_NAME = 'BoilerGames';

/** Pages at a fixed address: their tab title (null: the home page keeps index.html's). */
const FIXED_PAGES = {
  '/': { title: null },
  '/games': { title: 'Games', description: "Every party game on BoilerGames: pick one, put it on a big screen and everyone plays from their phone. No app, just a browser." },
  '/kit': { title: 'Game kit', description: 'How BoilerGames games are made: the rules every game follows and the pieces it can use, for the big screen and the phones.' },
  '/join': { title: 'Join', description: "Join a BoilerGames room: type the code from the big screen and play from your phone." },
  '/host': { title: 'Host' },
  '/login': { title: 'Log in' },
  '/admin': { title: 'Admin' },
  '/create': { title: 'Make a game' },
  '/account': { title: 'Your account' },
  '/report': { title: 'Report an issue' },
};

/**
 * What to put in the page for this address, or null when it isn't a page.
 * @param {string} pagePath  without a trailing slash ('/' for the home page)
 * @param {{ db: import('better-sqlite3').Database, games: import('../games/registry.js').GameRegistry }} deps
 * @returns {{ title: string | null, description?: string } | null}
 */
export function pageInfo(pagePath, { db, games }) {
  if (Object.hasOwn(FIXED_PAGES, pagePath)) return FIXED_PAGES[pagePath];
  const match = /^\/(games|u|create)\/([^/]+)$/.exec(pagePath);
  if (!match) return null;
  let name;
  try {
    name = decodeURIComponent(match[2]);
  } catch {
    return null; // a broken %-escape
  }
  if (match[1] === 'create') return { title: 'Make a game' }; // only its maker's: robots.txt keeps crawlers out
  if (match[1] === 'u') {
    const profile = getProfile(db, name);
    if (!profile) return null;
    return { title: profile.username, description: profile.bio || `${profile.username}'s party games on ${SITE_NAME}.` };
  }
  // A game: what everyone sees on its page. A playtest game is a page too, for its maker, but
  // under the plain title (it isn't public).
  const game = catalogList(db, games, { userId: null, isAdmin: false }).find((g) => g.id === name);
  if (game) return { title: game.name, description: game.description };
  return games.has(name) ? { title: 'Game' } : null;
}

/**
 * index.html with this page's title, description and canonical address.
 * @param {string} html  index.html as built
 * @param {{ title: string | null, description?: string } | null} info  null: not a page
 * @param {string} url  the page's full address
 */
export function pageHtml(html, info, url) {
  let out = html;
  const set = (pattern, value) => {
    out = out.replace(pattern, (_all, before, after) => `${before}${escapeHtml(value)}${after}`);
  };
  const title = info === null ? `Page not found · ${SITE_NAME}` : info.title && `${info.title} · ${SITE_NAME}`;
  if (title) {
    set(/(<title>)[^<]*(<\/title>)/, title);
    set(/(<meta property="og:title" content=")[^"]*(")/, title);
  }
  if (info?.description) {
    set(/(<meta name="description" content=")[^"]*(")/, info.description);
    set(/(<meta property="og:description" content=")[^"]*(")/, info.description);
  }
  const extra = info === null ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${escapeHtml(url)}" />`;
  if (info !== null) set(/(<meta property="og:url" content=")[^"]*(")/, url);
  return out.replace('</head>', `  ${extra}\n  </head>`);
}

/** An Express handler for every page address: index.html made for that page. */
export function sendPage({ db, games, indexPath }) {
  return (req, res) => {
    const pagePath = req.path.replace(/\/+$/, '') || '/';
    const info = pageInfo(pagePath, { db, games });
    // Read each time: it's small, and a test or a rebuild may change it.
    const html = pageHtml(readFileSync(indexPath, 'utf8'), info, `${req.protocol}://${req.get('host')}${pagePath === '/' ? '/' : pagePath}`);
    res.status(info === null ? 404 : 200).set('Cache-Control', 'no-cache').type('html').send(html);
  };
}

const escapeHtml = (text) => text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
