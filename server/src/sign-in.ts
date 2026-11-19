/**
 * Accounts and signing in: an emailed link, then a session cookie (BUILD-PLAN Step 11).
 *
 * 1. POST /api/sign-in with an email. Only @purdue.edu addresses (SPEC, Accounts). The server makes a
 *    random token, keeps only its SHA-256 hash, and emails <site>/sign-in/confirm#<token>. The token
 *    is after the #, so it never reaches a server log or a Referer header.
 * 2. Opening that page uses nothing up: Purdue's mail is scanned by a service that opens every
 *    link. Only pressing its button sends the token, in POST /api/sign-in/confirm.
 * 3. That makes the account if the address is new, and a session: another random token, sent as a
 *    cookie the page's scripts can't read, kept on the server only as a hash.
 * 4. A new account has no display name until it picks one (POST /api/me/display-name).
 * 5. POST /api/sign-out ends the session. GET /api/me says who is signed in, or nobody.
 *
 * A copy of the database can't sign anyone in: it holds hashes, never a token.
 */
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { blockedWordIn, refusals } from "./blocked-words.js";
import { accountByEmail, createAccount, createSession, createSignInLink, deleteExpired, deleteSession, deleteSignInLink, sessionAccount, setDisplayName, touchSession, useSignInLink, type Account } from "./db/accounts.js";
import { transaction, type Database } from "./db/database.js";
import { WindowLimit } from "./limits.js";
import type { Mail } from "./mail.js";
import type { Clock } from "./rooms.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long a sign-in link works. */
export const SIGN_IN_LINK_MS = 15 * MINUTE_MS;
/** How long a session lasts after it was last used. */
export const SESSION_MS = 90 * DAY_MS;
/** A session's use is written down at most this often, not on every request. */
export const SESSION_TOUCH_MS = HOUR_MS;
/** Sign-in emails to one address in SIGN_IN_LINK_MS. */
export const EMAILS_PER_ADDRESS = 3;
/**
 * Sign-in emails asked for from one visitor's network address in an hour. A campus shares a few
 * addresses, so this must let a club meeting of 30 people on one address all sign in.
 */
export const EMAILS_PER_VISITOR_PER_HOUR = 50;
/**
 * Sign-in emails in a day, from the whole site. The site must never be a way to flood Purdue inboxes,
 * and SES judges the sender by its complaints.
 */
export const EMAILS_PER_DAY = 300;
/** Links that didn't work (unknown, used or run out) from one visitor's address in a minute. */
export const WRONG_LINKS_PER_MINUTE = 10;
/** How often links and sessions that have run out are deleted. */
export const SWEEP_MS = 10 * MINUTE_MS;
/** Bytes of randomness in a sign-in link's token and a session's. */
export const TOKEN_BYTES = 32;
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 30;
export const PURDUE = "@purdue.edu";

/** What the server says about a signed-in account to that account itself. Its email goes to nobody else. */
export interface Me {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
}

export interface SignInOptions {
  readonly database: Database;
  readonly mail: Mail;
  readonly clock: Clock;
  /** The site's own origin: the start of each emailed link, and whether the cookie can be Secure. */
  readonly siteOrigin: string;
  /** The visitor's network address, for the per-visitor limits. */
  readonly addressOf: (request: IncomingMessage) => string;
}

export interface SignIn {
  readonly router: Router;
  /** The signed-in account behind a request, or undefined. Counts as a use of its session. */
  readonly signedIn: (request: Request, response: Response) => Account | undefined;
  /** Stops the timer that deletes old links and sessions. */
  readonly stop: () => void;
}

/** An email address that may sign in, in the form it is kept, or why not. */
export function purdueEmail(typed: string): { readonly ok: true; readonly email: string } | { readonly ok: false; readonly error: string } {
  const email = typed.trim().toLowerCase();
  if (!email.endsWith(PURDUE)) return { ok: false, error: "Only Purdue email addresses (ending in @purdue.edu) can sign in for now." };
  const local = email.slice(0, -PURDUE.length);
  // Purdue's mail delivers ada+anything@ to ada@: one person could make many accounts, and slip
  // past the limit on emails to one address.
  if (local.includes("+")) return { ok: false, error: "Use your Purdue address without a +tag." };
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(local)) return { ok: false, error: "That doesn't look like a Purdue email address." };
  return { ok: true, email };
}

/**
 * A display name as it is kept, and its key (what must be unique), or why it can't be one. Trimmed;
 * 2 to 30 characters; nothing invisible (control characters, the format characters that can hide
 * text or turn it backwards, and the characters Unicode says to draw as nothing, such as the
 * Hangul filler U+3164, which counts as a letter); and at least one letter or digit, so a name of
 * blank-looking symbols (U+2800, the blank Braille pattern) can't pass for no name. The key folds
 * case and look-alike forms (NFKC), so "Ada", "ADA" and a full-width "Ａｄａ" are one name.
 */
export function displayName(typed: string): { readonly ok: true; readonly name: string; readonly key: string } | { readonly ok: false; readonly error: string } {
  const name = typed.normalize("NFC").trim();
  if (/[\p{C}\p{Default_Ignorable_Code_Point}]/u.test(name)) return { ok: false, error: "A display name can't hold invisible or control characters." };
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN || length > DISPLAY_NAME_MAX) return { ok: false, error: `A display name is ${DISPLAY_NAME_MIN} to ${DISPLAY_NAME_MAX} characters.` };
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, error: "A display name needs at least one letter or digit." };
  return { ok: true, name, key: name.normalize("NFKC").toLowerCase() };
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** "3 minutes", "2 hours": how long to wait, rounded up. */
export function waitWords(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  if (minutes < 120) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `${Math.ceil(minutes / 60)} hours`;
}

function signInEmail(link: string): { subject: string; text: string } {
  return {
    subject: "Your BoilerGames sign-in link",
    text: [
      "Someone asked to sign in to BoilerGames with this email address.",
      "",
      "To sign in, open this link and press the button on the page:",
      link,
      "",
      `The link works once, for ${SIGN_IN_LINK_MS / MINUTE_MS} minutes.`,
      "If you didn't ask to sign in, ignore this email: nothing happens unless the link is used.",
    ].join("\n"),
  };
}

export function signInRoutes(options: SignInOptions): SignIn {
  const { database, mail, clock } = options;
  const seconds = () => Math.floor(clock.now() / 1000);

  // The session cookie. On the real site (https) it is `__Host-session` and Secure: the browser
  // sends it only over https, only to this exact host, and no subdomain can set one in its place.
  // Over plain http (development, and the browser tests) a browser refuses both, so there it is
  // `session` without Secure. That is the only difference.
  const secure = new URL(options.siteOrigin).protocol === "https:";
  const COOKIE = secure ? "__Host-session" : "session";
  const cookieOptions = { httpOnly: true, secure, sameSite: "lax", path: "/" } as const;

  const perAddress = new WindowLimit(EMAILS_PER_ADDRESS, SIGN_IN_LINK_MS, clock);
  const perVisitor = new WindowLimit(EMAILS_PER_VISITOR_PER_HOUR, HOUR_MS, clock);
  const perDay = new WindowLimit(EMAILS_PER_DAY, DAY_MS, clock);
  const wrongLinks = new WindowLimit(WRONG_LINKS_PER_MINUTE, MINUTE_MS, clock);

  function sweep(): void {
    deleteExpired(database, seconds());
    for (const limit of [perAddress, perVisitor, perDay, wrongLinks]) limit.sweep();
  }
  let cancel = clock.setTimeout(function again() {
    sweep();
    cancel = clock.setTimeout(again, SWEEP_MS);
  }, SWEEP_MS);

  function sessionToken(request: Request): string | undefined {
    for (const part of (request.headers.cookie ?? "").split(";")) {
      const [name, ...value] = part.trim().split("=");
      if (name === COOKIE) return value.join("=");
    }
    return undefined;
  }

  function startSession(response: Response, account: Account): void {
    const token = newToken();
    createSession(database, { tokenHash: hash(token), accountId: account.id, createdAt: seconds(), expiresAt: seconds() + SESSION_MS / 1000 });
    response.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS });
  }

  function signedIn(request: Request, response: Response): Account | undefined {
    const token = sessionToken(request);
    if (token === undefined) return undefined;
    const found = sessionAccount(database, hash(token), seconds());
    if (found === undefined) return undefined;
    // Good for 90 days from its last use: written down at most hourly, and the cookie renewed with it.
    if ((seconds() - found.lastSeenAt) * 1000 >= SESSION_TOUCH_MS) {
      touchSession(database, hash(token), seconds(), seconds() + SESSION_MS / 1000);
      response.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS });
    }
    return found.account;
  }

  const me = (account: Account): Me => ({ id: account.id, email: account.email, displayName: account.displayName });

  function tooMany(response: Response, waitMs: number, what: string): void {
    response.setHeader("Retry-After", String(Math.ceil(waitMs / 1000)));
    response.status(429).json({ error: `${what} Try again in ${waitWords(waitMs)}.` });
  }

  const router = Router();
  // Nothing about who is signed in may be kept by a cache on the way. (A Game's bundle and the
  // Creator's own pages set their own: games.ts.)
  router.use(["/api/sign-in", "/api/sign-out", "/api/me"], (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/api/sign-in", async (request, response) => {
    const body = z.object({ email: z.string().max(320) }).safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: "Send an email address." });
    const checked = purdueEmail(body.data.email);
    if (!checked.ok) return void response.status(400).json({ error: checked.error });
    const { email } = checked;

    const visitor = options.addressOf(request);
    const wait = Math.max(perDay.wait("site"), perVisitor.wait(visitor), perAddress.wait(email));
    if (wait > 0) return void tooMany(response, wait, "Too many sign-in emails have been asked for.");
    perDay.record("site");
    perVisitor.record(visitor);
    perAddress.record(email);
    sweep();

    const token = newToken();
    createSignInLink(database, { tokenHash: hash(token), email, createdAt: seconds(), expiresAt: seconds() + SIGN_IN_LINK_MS / 1000 });
    try {
      await mail.send({ to: email, ...signInEmail(`${options.siteOrigin}/sign-in/confirm#${token}`) });
    } catch (error) {
      deleteSignInLink(database, hash(token));
      // The error's kind only (mail.ts keeps addresses out of it); never the address.
      console.error(`A sign-in email couldn't be sent: ${(error as Error).message}`);
      return void response.status(502).json({ error: "The email couldn't be sent. Try again in a few minutes." });
    }
    response.json({ sent: true });
  });

  router.post("/api/sign-in/confirm", (request, response) => {
    const visitor = options.addressOf(request);
    const wait = wrongLinks.wait(visitor);
    if (wait > 0) return void tooMany(response, wait, "Too many sign-in links that didn't work.");
    const body = z.object({ token: z.string().max(100) }).safeParse(request.body);
    const account =
      body.success &&
      transaction(database, () => {
        const email = useSignInLink(database, hash(body.data.token), seconds());
        if (email === undefined) return undefined;
        return accountByEmail(database, email) ?? createAccount(database, { id: randomBytes(16).toString("base64url"), email, createdAt: seconds() });
      });
    if (!account) {
      wrongLinks.record(visitor);
      return void response.status(400).json({ error: "This sign-in link has been used or has run out. Ask for a new one." });
    }
    startSession(response, account);
    response.json({ account: me(account) });
  });

  router.post("/api/sign-out", (request, response) => {
    const token = sessionToken(request);
    if (token !== undefined) deleteSession(database, hash(token));
    response.clearCookie(COOKIE, cookieOptions);
    response.json({ signedOut: true });
  });

  router.get("/api/me", (request, response) => {
    const account = signedIn(request, response);
    response.json({ account: account === undefined ? null : me(account) });
  });

  router.post("/api/me/display-name", (request, response) => {
    const account = signedIn(request, response);
    if (account === undefined) return void response.status(401).json({ error: "Sign in first." });
    const body = z.object({ displayName: z.string().max(200) }).safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: "Send a display name." });
    const checked = displayName(body.data.displayName);
    if (!checked.ok) return void response.status(400).json({ error: checked.error });
    // A display name is public: it is shown on every published Game of theirs.
    const blocked = blockedWordIn(checked.name);
    if (blocked !== undefined) return void response.status(400).json({ error: refusals.displayName(blocked) });
    if (setDisplayName(database, account.id, checked.name, checked.key) === "taken") {
      return void response.status(409).json({ error: "That display name is taken. Pick another." });
    }
    response.json({ account: me({ ...account, displayName: checked.name }) });
  });

  return { router, signedIn, stop: () => cancel() };
}
