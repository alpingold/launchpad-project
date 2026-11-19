/**
 * A Creator's GenAI Studio key (BUILD-PLAN Step 28): save it (only once GenAI Studio has accepted
 * it), see whether one is saved and its last 4 characters, delete it.
 *
 * Once saved, the key never leaves the server: no answer holds it, only its last 4 characters, and
 * nothing here logs it. Saving needs the AI maker on (a model and a key secret); seeing and deleting
 * don't, so a Creator can always take their key back off the site.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Account } from "../db/accounts.js";
import type { Database } from "../db/database.js";
import { deleteKey, saveKey, storedKey } from "../db/genai-keys.js";
import { WindowLimit } from "../limits.js";
import type { Clock } from "../rooms.js";
import { waitWords } from "../sign-in.js";
import type { KeySecret } from "./key-secret.js";
import type { Model } from "./model.js";
import { KEY_SAVES, KEY_SAVES_WINDOW_MS } from "./numbers.js";

export const KEY_PATH = "/api/my/genai-key";
export const MAKER_OFF = "The site's AI maker isn't available yet.";

export interface KeyRoutesOptions {
  readonly database: Database;
  readonly clock: Clock;
  /** Null when there is none: the AI maker is off. */
  readonly model: Model | null;
  readonly keySecret: KeySecret | null;
  readonly signedIn: (request: Request, response: Response) => Account | undefined;
}

/**
 * What a key may be: printable characters with no spaces, as GenAI Studio's are. Anything else could
 * break the request's header, and is no key anyway.
 */
const keyBody = z.object({ key: z.string().trim().min(8).max(500).regex(/^[\x21-\x7e]+$/) });

const REFUSED = {
  keyRejected: { status: 400, error: "GenAI Studio didn't accept that key. Check you copied all of it, and that it is still valid." },
  rateLimited: { status: 503, error: "GenAI Studio is busy with that key just now. Try saving it again in a minute." },
  unavailable: { status: 503, error: "GenAI Studio can't be reached just now, so the key couldn't be checked. Try again later." },
} as const;

export function keyRoutes(options: KeyRoutesOptions): { readonly router: Router; readonly stop: () => void } {
  const { database, clock } = options;
  const router = Router();
  const saves = new WindowLimit(KEY_SAVES, KEY_SAVES_WINDOW_MS, clock);
  let cancel = clock.setTimeout(function again() {
    saves.sweep();
    cancel = clock.setTimeout(again, KEY_SAVES_WINDOW_MS);
  }, KEY_SAVES_WINDOW_MS);

  function creator(request: Request, response: Response): Account | undefined {
    const account = options.signedIn(request, response);
    if (account === undefined) return void response.status(401).json({ error: "Sign in first." });
    if (account.displayName === null) return void response.status(403).json({ error: "Pick a display name first." });
    return account;
  }

  /** What a page may know about the account's key: whether there is one, and its last 4 characters. */
  function status(accountId: string): object {
    const stored = storedKey(database, accountId);
    return stored === undefined ? { saved: false } : { saved: true, last4: stored.last4, savedAt: stored.savedAt };
  }

  router.get(KEY_PATH, (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    response.json(status(account.id));
  });

  router.put(KEY_PATH, async (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    const { model, keySecret } = options;
    if (model === null || keySecret === null) return void response.status(503).json({ error: MAKER_OFF });
    const wait = saves.wait(account.id);
    if (wait > 0) {
      response.setHeader("Retry-After", String(Math.ceil(wait / 1000)));
      return void response.status(429).json({ error: `You can save a key ${KEY_SAVES} times in 15 minutes. Try again in ${waitWords(wait)}.` });
    }
    saves.record(account.id);
    const body = keyBody.safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: "That doesn't look like a GenAI Studio key. Paste the whole key, with no spaces." });
    const key = body.data.key;
    const checked = await model.checkKey(key);
    if (checked !== "valid") return void response.status(REFUSED[checked].status).json({ error: REFUSED[checked].error });
    saveKey(database, account.id, { sealed: keySecret.seal(account.id, key), last4: key.slice(-4), savedAt: Math.floor(clock.now() / 1000) });
    response.json(status(account.id));
  });

  router.delete(KEY_PATH, (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    deleteKey(database, account.id);
    response.json(status(account.id));
  });

  return { router, stop: () => cancel() };
}
