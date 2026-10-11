import express from 'express';
import { config } from '../config.js';

/**
 * Builds the Express app (HTTP routes only).
 *
 * This is a function instead of a module-level `const app` so tests can
 * create a fresh app each time, and so index.js decides when to listen.
 * WebSockets are NOT handled here: Express only does normal HTTP requests.
 * The `ws` library attaches to the same http.Server in index.js (milestone M1).
 */
export function createApp() {
  const app = express();

  // Parse JSON request bodies, rejecting anything over the size limit.
  app.use(express.json({ limit: config.HTTP_JSON_LIMIT }));

  // Health check: the client (and later the VPS) can call this to see if the server is up.
  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  // Any other /api path is a clean JSON 404 instead of Express's HTML page.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  // Last-resort error handler. Express calls this when a route throws or
  // when express.json() gets a malformed or oversized body.
  // We log the details on the server but never send stack traces to clients.
  // (Express recognizes an error handler by its 4 parameters, so `next` must stay.)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error('[http] unexpected error:', err);
    res.status(status).json({ error: status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST' });
  });

  return app;
}
