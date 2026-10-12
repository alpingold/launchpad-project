import { parseCookies, SESSION_COOKIE } from './cookies.js';
import { getSessionUser } from '../db/sessions.js';

/**
 * Who is logged in, based on a request's Cookie header.
 * Works for both normal HTTP requests and WebSocket upgrade requests (both have headers).
 * @param {import('better-sqlite3').Database} db
 * @param {string | undefined} cookieHeader
 * @returns {{ user: import('../db/users.js').User | null, token: string | undefined }}
 */
export function currentUser(db, cookieHeader) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  return { user: token ? getSessionUser(db, token) : null, token };
}
