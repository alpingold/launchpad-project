/**
 * The worker's bootstrap: the start of the one script the Game frame runs in a worker. The frame
 * builds that script as `"use strict";` + this file (built, with the Engine in it) + the Game's
 * bundle, so by the time the first message arrives the bundle has run and left its Game on the
 * global {@link GAME_GLOBAL}.
 *
 * Built as one closure, so the Game's code can't reach the Engine's variables. It shares the global
 * scope, though: it can patch built-ins or post messages of its own. That can only spoil its own
 * Match, and the Screen checks every reply as untrusted (`readFrameReply`).
 *
 * Before anything else, it takes away the parts of the worker that let one Game leave something for
 * another (see {@link REMOVED}). The browser's own walls stop the rest; this one is ours.
 */
import { GAME_GLOBAL, resumeMatch, startMatch, type AnyGame, type Begun, type FrameReply, type Match } from "@boilergames/sdk/v1/engine";

/** The little of a worker's global scope this file uses. Typed by hand: the client's types are for pages. */
interface WorkerScope {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope & Record<string, unknown>;

/**
 * What the Game's code must not find in its worker, and why:
 *
 * - `caches`, `CacheStorage`, `Cache`: WebKit gives a sandboxed worker a working cache store, and in
 *   a saved profile every Game on the site shares it, across Matches and browser restarts. Chromium
 *   has none here and Firefox throws, but a Game must not depend on which browser it runs in.
 * - `Worker`: a worker the Game starts itself has a fresh global, with everything above back in it.
 * - `BroadcastChannel`: it opens in all three browsers. In the tests it reached no other Game,
 *   because every sandboxed frame has an origin of its own; it is removed so that stays true even
 *   where a browser keys it the way WebKit keys the cache store.
 *
 * The rest (indexedDB, the origin private file system, locks, service workers, cookies, storage)
 * is refused by the browsers themselves; the walls test checks every one of them in each browser.
 */
const REMOVED = ["caches", "CacheStorage", "Cache", "Worker", "BroadcastChannel"] as const;

for (const name of REMOVED) remove(name);

/**
 * Deletes `name` from every object on the global's prototype chain, where the browser defines it
 * (`caches` is a getter on WorkerGlobalScope.prototype, `Worker` a value on the global itself), and
 * then fixes it on the global as `undefined`, unwritable and unconfigurable. With the browser's
 * getter gone there is nothing to call or put back, and the fixed property can't be redefined.
 * If any step fails, the script stops here, before the Game's code runs: the frame then says the
 * Game couldn't load, which is safer than running it with the wall missing.
 */
function remove(name: string): void {
  for (let o: object | null = globalThis; o !== null; o = Object.getPrototypeOf(o) as object | null) {
    if (Object.getOwnPropertyDescriptor(o, name) !== undefined && !Reflect.deleteProperty(o, name)) {
      throw new Error(`this browser wouldn't let the frame remove ${name}, so no Game can run in it`);
    }
  }
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, enumerable: false, configurable: false });
}
// Taken now, before the Game's code runs and could replace them.
const post = scope.postMessage.bind(scope);
const stringify = JSON.stringify;

let match: Match | undefined;

scope.addEventListener("message", (event) => post(answer(event.data)));

function answer(message: unknown): FrameReply {
  if (typeof message !== "object" || message === null) return couldNotStart("the frame sent something that isn't a message");
  const m = message as Record<string, unknown>;
  switch (m["type"]) {
    case "start":
      return begin(() => startMatch(game(), { players: m["players"], seed: Number(m["seed"]) }));
    case "resume":
      return begin(() => resumeMatch(game(), m["snapshot"]));
    case "act":
      return result(match?.act(String(m["playerId"]), m["action"]));
    case "timerFired":
      return result(match?.timerFired());
    case "setPlayers":
      return result(match?.setPlayers(m["players"]));
    default:
      return couldNotStart(`the frame sent an unknown message: ${stringify(m["type"])}`);
  }
}

/** The Game the bundle left on the global, or throws saying what the bundle did wrong. */
function game(): AnyGame {
  const found = scope[GAME_GLOBAL];
  if (typeof found !== "object" || found === null) {
    throw new Error(`the Game's code didn't set ${GAME_GLOBAL} to a Game (it is ${found === null ? "null" : typeof found})`);
  }
  return found as AnyGame;
}

function begin(make: () => Begun): FrameReply {
  if (match !== undefined) return couldNotStart("a Match is already running in this frame");
  let begun: Begun;
  try {
    begun = make();
  } catch (error) {
    // The Engine never throws; reading the Game off the global can.
    return couldNotStart(error instanceof Error ? error.message : String(error));
  }
  if (!begun.ok) return couldNotStart(begun.why);
  match = begun.match;
  return result(begun.outcome);
}

function result(outcome: ReturnType<Match["act"]> | undefined): FrameReply {
  if (match === undefined || outcome === undefined) return couldNotStart("no Match has started in this frame");
  return { type: "result", outcome, views: match.views(), snapshot: match.snapshot() };
}

function couldNotStart(why: string): FrameReply {
  return { type: "couldNotStart", why };
}
