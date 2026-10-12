// Reading and writing the login cookie, without a cookie library.

export const SESSION_COOKIE = 'sid';

/**
 * Parses a Cookie header ("a=1; sid=abc") into an object.
 * If a name appears twice, the first one wins (browsers send the most specific first).
 * The result has no prototype, so a cookie named "__proto__" or "constructor" is just
 * an ordinary key.
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  const cookies = Object.create(null);
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && !(name in cookies)) cookies[name] = value;
  }
  return cookies;
}

/**
 * The Set-Cookie header value for a new login.
 *  - HttpOnly: page JavaScript can't read it, so an XSS bug can't steal the session
 *  - SameSite=Lax: other websites can't make the browser send it with their requests
 *    (protects against CSRF, decision D16)
 *  - Secure: only sent over HTTPS (on in production)
 *  - Max-Age: how long the browser keeps it
 */
export function sessionCookie(token, { maxAgeSeconds, secure }) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** The Set-Cookie header value that deletes the login cookie. */
export function clearedSessionCookie({ secure }) {
  return sessionCookie('', { maxAgeSeconds: 0, secure });
}
