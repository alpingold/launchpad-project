// Talking to the API for AI-generated games (server/src/http/adminRoutes.js). Two places
// serve it: /api/admin/generations (admins: every game) and /api/generations (any account:
// only your own games, plan §15). The server checks who may do what on each request.

const ADMIN_BASE = '/api/admin/generations';
let BASE = ADMIN_BASE;

/** The /create page uses the per-account routes: it calls this while rendering, before any request. */
export function useOwnGamesApi() {
  BASE = '/api/generations';
}

/**
 * Sends a request and returns the JSON body plus `ok`/`status`. Never throws: a network
 * failure comes back as { ok: false, message }, so the page can just show the message.
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [opts]  body: sent as JSON
 * @returns {Promise<{ ok: boolean, status: number, [field: string]: any }>}
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

/** → { game } with every version: code, test report, changes; plus progress */
export const getGeneration = (id) => request(`${BASE}/${encodeURIComponent(id)}`);

/** → { game } (202: it's queued; the work happens in the background) */
export const startGeneration = (idea, model) => request(BASE, { method: 'POST', body: { idea, model } });

/**
 * Asks for changes: a new version made from version `basedOn`, starting with a plan (or,
 * with skipDesign, a small fix straight to code). → { game } (202: queued)
 */
export const requestChanges = (id, changeRequest, basedOn, skipDesign = false) =>
  request(`${BASE}/${encodeURIComponent(id)}/versions`, { method: 'POST', body: { request: changeRequest, basedOn, skipDesign } });

/** "Make it your own" (plan §45b): a remix's own whole design, then its code rewritten for it. → 202 { game } */
export const remixDesign = (id, remixRequest) => request(`${BASE}/${encodeURIComponent(id)}/remix-design`, { method: 'POST', body: { request: remixRequest } });

const versionPath = (id, version, action) => `${BASE}/${encodeURIComponent(id)}/versions/${version}/${action}`;

/** A new draft of a version's design (or plan), with what to change. → { game } (202: queued) */
export const redesignVersion = (id, version, feedback) => request(versionPath(id, version, 'redesign'), { method: 'POST', body: { feedback } });

/** Saves your own edit of a version's design as a new draft. → { game } */
export const saveDesign = (id, version, design) => request(versionPath(id, version, 'design'), { method: 'POST', body: { design } });

/** "Build it": writes the code from the version's design. → { game } (202: queued) */
export const buildVersion = (id, version) => request(versionPath(id, version, 'build'), { method: 'POST', body: {} });

/** Throws away the newest version while it has no passing code. → { game } */
export const discardVersion = (id, version) => request(versionPath(id, version, 'discard'), { method: 'POST', body: {} });

/** "Review again" (plan §47): one more code review round on this version, as the next version. → { game } (202: queued) */
export const reviewAgain = (id, version) => request(versionPath(id, version, 'review-again'), { method: 'POST', body: {} });

/** Only you can start this version (next to the published one, if any). → { game } */
export const playtestVersion = (id, version) =>
  request(`${BASE}/${encodeURIComponent(id)}/versions/${version}/playtest`, { method: 'POST', body: {} });

/**
 * action: 'publish' (the playtest version goes to everyone) | 'stop-playtest' | 'unpublish' → { game }
 * Publishing may be refused for words its name or description can't have (plan §49):
 * { ok: false, error: 'BLOCKED_WORDS', message, blocked: [{ field, text, words: [{ word, start, end }] }] }.
 */
export const actOnGeneration = (id, action) => request(`${BASE}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} });

export const deleteGeneration = (id) => request(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
