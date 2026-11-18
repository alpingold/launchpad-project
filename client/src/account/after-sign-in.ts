/**
 * Where to go once signed in: a page that needs an account sends a signed-out visitor to sign in,
 * and back to it after. Kept in localStorage, not in the address: the emailed link opens in a new
 * tab, often a new window, and only storage the whole browser shares reaches it there.
 */
import { forget, load, save } from "../net/saved.js";

const KEY = "boilergames.after-sign-in";

/** Only the site's own Creator pages: never an address someone else could put in a link. */
const allowed = (path: string) => /^\/my\/[A-Za-z0-9/_-]*$/.test(path) || path === "/my";

/** Sends a signed-out visitor to sign in, to come back to `path` after. */
export function signInFirst(path: string): void {
  location.assign(`/sign-in?next=${encodeURIComponent(path)}`);
}

/** The sign-in page keeps where the visitor was going, if it is one of the site's own pages. */
export function rememberWhereTo(path: string | null): void {
  if (path !== null && allowed(path)) save(KEY, path);
}

/** Where to go now that the visitor is signed in (and named): where they were going, once, or the home page. */
export function takeWhereTo(): string {
  const path = load<unknown>(KEY);
  forget(KEY);
  return typeof path === "string" && allowed(path) ? path : "/";
}
