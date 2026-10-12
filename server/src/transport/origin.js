/**
 * Should this WebSocket upgrade be accepted, based on where the page that opened it came from?
 *
 * Why this matters: browsers attach cookies to WebSocket connections no matter which website
 * opened them. Without this check, a page on evil.example could open a socket to our server
 * using a visitor's BoilerGames login cookie and act as them ("cross-site WebSocket hijacking").
 * Browsers always send an Origin header on WebSocket upgrades, and a web page can't fake it.
 *
 * Rule: the Origin's host must equal the Host the request was sent to (same site).
 * Requests with no Origin at all come from non-browser programs (tests, scripts); those
 * can't borrow a visitor's cookies, so they're allowed.
 *
 * @param {import('node:http').IncomingMessage} req
 */
export function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // "null" or garbage
  }
  return originHost === req.headers.host;
}
