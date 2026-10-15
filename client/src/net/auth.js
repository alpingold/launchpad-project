import { useEffect, useState } from 'react';

// Talking to the account API. The login itself lives in an HttpOnly cookie that page
// JavaScript can't read; the browser sends it automatically with same-site requests
// (and with the WebSocket connection), so these helpers never handle the token.

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    // JSON is required by the server (part of its CSRF protection).
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...data };
}

/**
 * A logged-in account, as GET /api/me and the login routes return it.
 * @typedef {{ id: number, username: string, isAdmin: boolean }} User
 */

/** @returns {Promise<{ ok: boolean, user?: User, error?: string, message?: string }>} */
export const signUp = (username, password) => postJson('/api/signup', { username, password });
export const logIn = (username, password) => postJson('/api/login', { username, password });
export const logOut = () => postJson('/api/logout', {});

/**
 * Who is logged in. `undefined` while checking, then the user or null.
 * @returns {User | null | undefined}
 */
export function useCurrentUser() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    let current = true;
    fetch('/api/me')
      .then((res) => res.json())
      .then((data) => current && setUser(data.user ?? null))
      .catch(() => current && setUser(null));
    return () => {
      current = false;
    };
  }, []);
  return user;
}

/**
 * Where to go after logging in, from ?next=. Only paths on THIS site are allowed:
 * otherwise a link like /login?next=https://evil.example would send people to another
 * site right after they typed their password ("open redirect").
 */
export function safeNextPath(raw, fallback = '/host') {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return fallback;
  }
  return raw;
}
