import express from 'express';
import { catalogList } from '../games/catalog.js';

/**
 * For search engines (plan §33):
 *   GET /robots.txt   what crawlers may visit, and where the sitemap is
 *   GET /sitemap.xml  every public page worth finding: home, games, the kit, each public game
 *
 * The site's address comes from the request: behind Caddy (TRUST_PROXY) that's
 * https://boilergames.party, and locally http://localhost:3000.
 *
 * @param {{ db: import('better-sqlite3').Database, games: import('../games/registry.js').GameRegistry }} deps
 */
export function createSeoRouter({ db, games }) {
  const router = express.Router();
  const origin = (req) => `${req.protocol}://${req.get('host')}`;

  router.get('/robots.txt', (req, res) => {
    // Pages that are only for one person (your account, your games, the admin's) or for a
    // room in progress: nothing there for a search result.
    const lines = ['User-agent: *', ...['/api/', '/admin', '/account', '/create', '/host', '/login', '/report'].map((p) => `Disallow: ${p}`), '', `Sitemap: ${origin(req)}/sitemap.xml`];
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(`${lines.join('\n')}\n`);
  });

  router.get('/sitemap.xml', (req, res) => {
    // What a logged-out visitor (a search engine) can see: playtest games stay out.
    const everyone = { userId: null, isAdmin: false };
    const paths = ['/', '/games', '/kit', ...catalogList(db, games, everyone).map((g) => `/games/${encodeURIComponent(g.id)}`)];
    const urls = paths.map((p) => `  <url><loc>${escapeXml(origin(req) + p)}</loc></url>`);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
  });

  return router;
}

const escapeXml = (text) => text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
