/**
 * The Creator's pages need a signed-in account with a display name. The site answers 401 (signed
 * out) or 403 (no display name yet); either way the visitor is sent where they can fix it, and
 * brought back to this page after.
 */
import { rememberWhereTo, signInFirst } from "../account/after-sign-in.js";

/** Sends the visitor away if `status` says this page isn't theirs yet; returns whether it did. */
export function needsACreator(status: number): boolean {
  if (status === 401) {
    signInFirst(location.pathname);
    return true;
  }
  if (status === 403) {
    rememberWhereTo(location.pathname);
    location.assign("/sign-in/name");
    return true;
  }
  return false;
}
