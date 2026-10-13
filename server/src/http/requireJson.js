/**
 * CSRF protection, part 2 (part 1 is the SameSite=Lax login cookie).
 *
 * A plain HTML form on another website can submit a POST to us, but it can't send
 * Content-Type: application/json without the browser first asking our permission (CORS),
 * which we never give. So: every POST must be JSON, or it's refused.
 * Used by every router that changes something (accounts, admin).
 */
export function requireJsonPosts(req, res, next) {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ error: 'JSON_REQUIRED', message: 'Requests must be sent as JSON.' });
  }
  next();
}
