// Talking to the admin API for AI-generated games (server/src/http/adminRoutes.js).
// Every call needs a logged-in admin; the server checks that on each request.

const BASE = '/api/admin/generations';

/**
 * Sends a request and returns the JSON body plus `ok`/`status`. Never throws: a network
 * failure comes back as { ok: false, message }, so the page can just show the message.
 */
async function request(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      // JSON is required for POSTs (part of the server's CSRF protection).
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, ...data };
  } catch {
    return { ok: false, status: 0, message: "Couldn't reach the server." };
  }
}

/** → { info, games } (newest first; without code) */
export const listGenerations = () => request(BASE);

/** → { game } with its code, test report and progress */
export const getGeneration = (id) => request(`${BASE}/${encodeURIComponent(id)}`);

/** → { game } (202: it's queued; the work happens in the background) */
export const startGeneration = (idea, model) => request(BASE, { method: 'POST', body: { idea, model } });

/** action: 'playtest' | 'publish' | 'reject' → { game } */
export const actOnGeneration = (id, action) =>
  request(`${BASE}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} });

export const deleteGeneration = (id) => request(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
