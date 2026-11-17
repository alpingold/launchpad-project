/**
 * The Game frame's page script: the only script on the game domain's page.
 *
 * It does three things. On load it tells the Screen it is `ready`. On `start` or `resume` it builds
 * one script out of the worker bootstrap (which holds the Engine) and the Game's bundle, and starts
 * a worker from it. After that it only passes messages: each one from the Screen to the worker, and
 * the worker's first reply back. It never evaluates anything itself.
 *
 * Most walls are not in this file. The page is in an iframe sandboxed without `allow-same-origin`,
 * so its origin is opaque: no cookies, and most storage is refused. Its Content-Security-Policy
 * header allows no network at all, and a worker started from a blob: URL inherits that policy. See
 * the frame server. One storage wall is ours: WebKit gives a sandboxed worker a working cache store,
 * shared by every Game on the site. So before each Game loads, this file empties that store, and
 * the worker's bootstrap takes `caches` (and `Worker`) out of the Game's reach.
 */
import { EMPTY_STORAGE_MS, STORAGE_TOO_SLOW } from "@boilergames/sdk/v1/engine";
import workerSource from "virtual:frame-worker-source";

/** The Screen page that embeds this frame. */
const screen = window.parent;
let worker: Worker | undefined;
let workerUrl: string | undefined;
/** The type of the message waiting for its reply, if one is. */
let waiting: string | undefined;
/** True from the first `start` or `resume` on: a frame runs one Match. */
let begun = false;


/**
 * Run in a worker of its own, because WebKit gives the store to workers but not to this page. Where
 * `caches` is missing (Chromium) or throws (Firefox), there is nothing to empty, and it says so too.
 */
const EMPTY_CACHES = `"use strict";
(async () => {
  try {
    const store = self.caches;
    if (store !== undefined) for (const name of await store.keys()) await store.delete(name);
  } catch {}
  postMessage("emptied");
})();`;

window.addEventListener("message", (event) => {
  // Only the page that embeds this one may talk to it. The CSP's frame-ancestors says which page that is.
  if (event.source !== screen || screen === window) return;
  const message: unknown = event.data;
  if (typeof message !== "object" || message === null || waiting !== undefined) return;
  const type = (message as { type?: unknown }).type;
  if (typeof type !== "string") return;
  waiting = type;

  if (type === "start" || type === "resume") {
    if (begun) return reply({ type: "couldNotStart", why: "a Match is already running in this frame" });
    const bundle = (message as { bundle?: unknown }).bundle;
    if (typeof bundle !== "string") return reply({ type: "couldNotStart", why: "the Game's code wasn't sent" });
    begun = true;
    // Nothing a Game left behind may be there when the next one loads, even if it found a way
    // around the bootstrap's removals.
    void emptyCacheStore().then((emptied) => {
      if (!emptied) return reply({ type: "couldNotStart", why: STORAGE_TOO_SLOW });
      // The Game's own two seconds start now.
      screen.postMessage({ type: "emptied" }, "*");
      worker = start(bundle);
      // The worker already holds the bundle as part of its script; it needs the rest.
      worker.postMessage({ ...message, bundle: undefined });
    });
    return;
  }
  worker?.postMessage(message);
  if (worker === undefined) reply({ type: "couldNotStart", why: "no Match has started in this frame" });
});

/** Empties the cache store a sandboxed worker sees. Resolves false if that didn't finish in time. */
function emptyCacheStore(): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([EMPTY_CACHES], { type: "text/javascript" }));
  const cleaner = new Worker(url);
  return new Promise<boolean>((resolve) => {
    const done = (emptied: boolean) => {
      clearTimeout(limit);
      cleaner.terminate();
      URL.revokeObjectURL(url);
      resolve(emptied);
    };
    const limit = setTimeout(() => done(false), EMPTY_STORAGE_MS);
    cleaner.addEventListener("message", () => done(true));
    cleaner.addEventListener("error", (event) => {
      event.preventDefault();
      done(false);
    });
  });
}

function start(bundle: string): Worker {
  // Strict mode for everything, the Game included: the Engine freezes the state it hands a Game, and
  // only strict code throws when a Game changes it; sloppy code would carry on as if it had.
  // Each part ends on its own line, so a bundle ending in a `//` comment can't swallow what follows.
  const script = new Blob(['"use strict";\n', workerSource, "\n;\n", bundle, "\n"], { type: "text/javascript" });
  workerUrl = URL.createObjectURL(script);
  const started = new Worker(workerUrl);
  started.addEventListener("message", (event: MessageEvent<unknown>) => reply(event.data));
  // The Game's code failed to load (a syntax error, a throw at the top level): the bootstrap can't
  // answer, so the frame says so. An error later, from the Game's own timers, isn't an answer.
  started.addEventListener("error", (event: ErrorEvent) => {
    event.preventDefault();
    if (waiting === "start" || waiting === "resume") reply({ type: "couldNotStart", why: `the Game's code failed to load: ${event.message || "an error"}` });
  });
  return started;
}

/** Sends the Screen the one reply it waits for, and drops anything the worker sends unasked. */
function reply(data: unknown): void {
  if (waiting === undefined) return;
  waiting = undefined;
  if (workerUrl !== undefined) {
    URL.revokeObjectURL(workerUrl);
    workerUrl = undefined;
  }
  screen.postMessage(data, "*");
}

screen.postMessage({ type: "ready" }, "*");
