/**
 * A Game that tries to pass something to another Game: through every place in a worker that can
 * keep data, or reach another browsing context. The test plays it in two roles, set by the first
 * Player's id (`leave-<token>` or `find-<token>`):
 *
 * - `leave` writes the token into each store, holds a lock named after it, and keeps announcing it
 *   on a BroadcastChannel for as long as its frame lives.
 * - `find` looks in each store, asks which locks are held, and listens on the channel.
 * - `ask` asks the storage manager how much is stored and whether it is kept (see below).
 *
 * Each feature's line in the Screen View says what happened. A `leave` line says "missing" (no such
 * thing in this worker), "blocked" (it threw or refused), or "LEFT" if the data went in. A `find`
 * line says "missing", "blocked", "found nothing", or "FOUND" with what it found. The walls hold
 * when nothing is LEFT, nothing is FOUND, and the storage manager has
 * not ANSWERED.
 */
import { defineGame } from "../../sdk/src/v1/index.js";
import { FRAME } from "../origins.js";

/** A worker's global scope, loosely: this file is type-checked as a page, and probes what exists. */
const scope = globalThis as unknown as Record<string, unknown>;
/** Any value from an API the page's types don't describe in a worker: probed by name, so typed loosely on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const CHANNEL = "boilergames-leak";
const report: Record<string, string> = {};
let started = false;

const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/** Runs one probe and records its outcome; gives up after 4 seconds. Reading a missing feature throws in some browsers. */
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

/** The feature at `path` (such as "navigator.storage"), or undefined if any step is missing. */
function get(path: string): Loose | undefined {
  let value: unknown = scope;
  for (const key of path.split(".")) {
    if (value === undefined || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value === undefined || value === null ? undefined : (value as Loose);
}

const missing = (path: string) => `missing: no ${path} in this worker`;

function request<T>(req: Loose): Promise<T> {
  return new Promise((resolve, reject) => {
    req["onsuccess"] = () => resolve(req["result"] as T);
    req["onerror"] = () => reject(req["error"]);
  });
}

function leave(token: string): void {
  attempt("caches", async () => {
    const caches = get("caches");
    if (caches === undefined) return missing("caches");
    const cache = (await caches["open"]!.call(caches, "leak")) as Loose;
    await cache["put"]!.call(cache, new Request(`https://leak.invalid/${token}`), new Response(token));
    return "LEFT: a cache entry";
  });
  attempt("origin private file system", async () => {
    const storage = get("navigator.storage");
    if (storage?.["getDirectory"] === undefined) return missing("navigator.storage.getDirectory");
    const dir = (await storage["getDirectory"].call(storage)) as Loose;
    const file = (await dir["getFileHandle"]!.call(dir, `leak-${token}`, {
      create: true,
    })) as Loose;
    if (typeof file["createSyncAccessHandle"] === "function") {
      const handle = (await file["createSyncAccessHandle"].call(file)) as Loose;
      handle["write"]!.call(handle, new TextEncoder().encode(token));
      handle["close"]!.call(handle);
    }
    return "LEFT: a file";
  });
  attempt("indexedDB", async () => {
    const idb = get("indexedDB");
    if (idb === undefined) return missing("indexedDB");
    const open = idb["open"]!.call(idb, "leak", 1) as Loose;
    open["onupgradeneeded"] = () => (open["result"] as Loose)["createObjectStore"]!.call(open["result"], "s");
    const db = await request<Loose>(open);
    const tx = db["transaction"]!.call(db, "s", "readwrite") as Loose;
    (tx["objectStore"]!.call(tx, "s") as Loose)["put"]!.call(tx["objectStore"]!.call(tx, "s"), token, "k");
    return "LEFT: a database";
  });
  attempt("webkitRequestFileSystem", () => {
    const sync = get("webkitRequestFileSystemSync");
    if (sync === undefined) return missing("webkitRequestFileSystemSync");
    // 0 is TEMPORARY, 1 is PERSISTENT.
    for (const kind of [0, 1]) {
      const fs = (sync as unknown as (type: number, size: number) => Loose)(kind, 1024);
      const root = fs["root"] as Loose;
      const entry = root["getFile"]!.call(root, `leak-${token}`, {
        create: true,
      }) as Loose;
      (entry["createWriter"]!.call(entry) as Loose)["write"]!.call(undefined, new Blob([token]));
    }
    return "LEFT: a file";
  });
  attempt("BroadcastChannel", () => {
    const Channel = scope["BroadcastChannel"] as (new (name: string) => Loose) | undefined;
    if (Channel === undefined) return missing("BroadcastChannel");
    const channel = new Channel(CHANNEL);
    // Announced until the frame goes, so a Game running alongside has every chance to hear it.
    setInterval(() => channel["postMessage"]!.call(channel, token), 100);
    return "LEFT: announcing on a channel";
  });
  attempt("navigator.locks", async () => {
    const locks = get("navigator.locks");
    if (locks === undefined) return missing("navigator.locks");
    let held = false;
    void locks["request"]!.call(locks, `leak-${token}`, () => {
      held = true;
      return new Promise(() => {});
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    return held ? "LEFT: holding a lock" : "blocked: the lock was never granted";
  });
  attempt("navigator.serviceWorker", async () => {
    const container = get("navigator.serviceWorker");
    if (container === undefined) return missing("navigator.serviceWorker");
    if (typeof container["register"] !== "function") return "missing: no register() in a worker";
    // The frame's own page by its full URL: a relative one would fail only because the worker's
    // address is a blob: URL, which proves nothing.
    await container["register"].call(container, `${FRAME}/v1/`);
    return "LEFT: registered a service worker";
  });
  attempt("nested Worker", () => {
    const Nested = scope["Worker"] as (new (url: string) => Loose) | undefined;
    if (Nested === undefined) return missing("Worker");
    // A worker of the Game's own, with a fresh global: the Game's way around anything removed from its own.
    // Reading `caches` throws in Firefox's sandboxed workers, so the nested worker catches it.
    const source = 'try { postMessage(typeof caches); } catch (e) { postMessage("throws: " + e); }';
    const worker = new Nested(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    return new Promise<string>((resolve) => {
      worker["onmessage"] = (event: { data: unknown }) => resolve(`LEFT: started a worker, where caches is ${String(event.data)}`);
      worker["onerror"] = (event: { preventDefault(): void; message: string }) => {
        event.preventDefault();
        resolve(`blocked: the worker failed: ${event.message}`);
      };
    });
  });
  everywhereElse(true);
}

function find(): void {
  attempt("caches", async () => {
    const caches = get("caches");
    if (caches === undefined) return missing("caches");
    const found: string[] = [];
    for (const name of (await caches["keys"]!.call(caches)) as string[]) {
      const cache = (await caches["open"]!.call(caches, name)) as Loose;
      found.push(`${name} (${((await cache["keys"]!.call(cache)) as unknown[]).length} entries)`);
    }
    return found.length === 0 ? "found nothing" : `FOUND: ${found.join(", ")}`;
  });
  attempt("origin private file system", async () => {
    const storage = get("navigator.storage");
    if (storage?.["getDirectory"] === undefined) return missing("navigator.storage.getDirectory");
    const dir = (await storage["getDirectory"].call(storage)) as Loose;
    const names: string[] = [];
    for await (const name of dir["keys"]!.call(dir) as AsyncIterable<string>) names.push(name);
    return names.length === 0 ? "found nothing" : `FOUND: ${names.join(", ")}`;
  });
  attempt("indexedDB", async () => {
    const idb = get("indexedDB");
    if (idb === undefined) return missing("indexedDB");
    const list = (await idb["databases"]!.call(idb)) as { name: string }[];
    return list.length === 0 ? "found nothing" : `FOUND: ${list.map((d) => d.name).join(", ")}`;
  });
  attempt("webkitRequestFileSystem", () => {
    const sync = get("webkitRequestFileSystemSync");
    if (sync === undefined) return missing("webkitRequestFileSystemSync");
    const found: string[] = [];
    for (const kind of [0, 1]) {
      const fs = (sync as unknown as (type: number, size: number) => Loose)(kind, 1024);
      const root = fs["root"] as Loose;
      const entries = (root["createReader"]!.call(root) as Loose)["readEntries"]!.call(undefined) as { name: string }[];
      found.push(...entries.map((e) => e.name));
    }
    return found.length === 0 ? "found nothing" : `FOUND: ${found.join(", ")}`;
  });
  attempt("BroadcastChannel", () => {
    const Channel = scope["BroadcastChannel"] as (new (name: string) => Loose) | undefined;
    if (Channel === undefined) return missing("BroadcastChannel");
    const heard: string[] = [];
    const channel = new Channel(CHANNEL);
    channel["onmessage"] = ((event: { data: unknown }) => heard.push(String(event.data))) as never;
    return new Promise<string>((resolve) =>
      setTimeout(() => resolve(heard.length === 0 ? "found nothing (listened 1.5 s)" : `FOUND: heard ${[...new Set(heard)].join(", ")}`), 1_500),
    );
  });
  attempt("navigator.locks", async () => {
    const locks = get("navigator.locks");
    if (locks === undefined) return missing("navigator.locks");
    const state = (await locks["query"]!.call(locks)) as {
      held: { name: string }[];
      pending: { name: string }[];
    };
    const names = [...state.held, ...state.pending].map((l) => l.name);
    return names.length === 0 ? "found nothing" : `FOUND: ${names.join(", ")}`;
  });
  attempt("navigator.serviceWorker", async () => {
    const container = get("navigator.serviceWorker");
    if (container === undefined) return missing("navigator.serviceWorker");
    if (typeof container["getRegistrations"] !== "function") return "missing: no getRegistrations() in a worker";
    const registrations = (await container["getRegistrations"].call(container)) as unknown[];
    return registrations.length === 0 ? "found nothing" : `FOUND: ${registrations.length} registrations`;
  });
  attempt("nested Worker", () => (scope["Worker"] === undefined ? missing("Worker") : "found nothing (a worker holds nothing between Matches)"));
  everywhereElse(false);
}

/** Probes that are the same in both roles: what exists, and what the storage manager says. */
function everywhereElse(leaving: boolean): void {
  for (const name of ["localStorage", "sessionStorage", "cookieStore", "SharedWorker"]) {
    attempt(name, () => (get(name) === undefined ? missing(name) : `${leaving ? "LEFT" : "FOUND"}: ${name} exists in a worker`));
  }
  // The ways back to a removed feature, if only its plain name were taken away: each must fail.
  const routes: Record<string, { plain: () => unknown; constructors: string[] }> = {
    caches: {
      plain: () => (typeof caches === "undefined" ? undefined : caches),
      constructors: ["CacheStorage", "Cache"],
    },
    Worker: {
      plain: () => (typeof Worker === "undefined" ? undefined : Worker),
      constructors: [],
    },
  };
  for (const [name, { plain, constructors }] of Object.entries(routes)) {
    attempt(`${name} by every route`, () => {
      const open: string[] = [];
      if (plain() !== undefined) open.push("the plain name");
      if ((self as unknown as Record<string, unknown>)[name] !== undefined) open.push(`self.${name}`);
      if ((globalThis as unknown as Record<string, unknown>)[name] !== undefined) open.push(`globalThis.${name}`);
      for (let o: object | null = scope; o !== null; o = Object.getPrototypeOf(o) as object | null) {
        const found = Object.getOwnPropertyDescriptor(o, name);
        if (found === undefined) continue;
        const value = found.get !== undefined ? found.get.call(scope) : found.value;
        if (value !== undefined) open.push(`the ${found.get !== undefined ? "getter" : "value"} on ${o.constructor?.name ?? "an object"}`);
      }
      for (const ctor of constructors) if (scope[ctor] !== undefined) open.push(ctor);
      // Putting it back must fail too: on the global, where it was defined it is now fixed in place.
      try {
        Object.defineProperty(scope, name, {
          get: () => "restored",
          configurable: true,
        });
        if (scope[name] === "restored") open.push("redefining it");
      } catch {
        // Refused: it can't be put back.
      }
      return open.length === 0 ? "missing: every route fails" : `${leaving ? "LEFT" : "FOUND"}: ${open.join(", ")}`;
    });
  }
}

/**
 * What the storage manager says. Its own role, played in a frame of its own, because in Firefox
 * `estimate()` and `persisted()` never return in a sandboxed worker: the worker freezes, and the
 * two-second rule ends that Match. Only the Game that asked is hurt, but it can't report.
 */
function askStorageManager(): void {
  attempt("navigator.storage.estimate", async () => {
    const storage = get("navigator.storage");
    if (storage?.["estimate"] === undefined) return missing("navigator.storage.estimate");
    const { usage, quota } = (await storage["estimate"].call(storage)) as {
      usage: number;
      quota: number;
    };
    return `ANSWERED: usage ${usage} of ${quota}`;
  });
  attempt("navigator.storage.persist", async () => {
    const storage = get("navigator.storage");
    if (storage === undefined) return missing("navigator.storage");
    const persisted = typeof storage["persisted"] === "function" ? String(await storage["persisted"].call(storage)) : "no persisted()";
    return `ANSWERED: persist() ${typeof storage["persist"] === "function" ? "exists" : "doesn't exist in a worker"}, persisted() is ${persisted}`;
  });
}

type State = { readonly checks: number };

export default defineGame<State, { readonly type: "report" }>({
  about: { title: "Hoarder", players: { min: 1, max: 4 } },
  start(ctx) {
    const id = ctx.players[0]?.id ?? "";
    if (!started) {
      started = true;
      if (id.startsWith("leave-")) leave(id.slice("leave-".length));
      else if (id.startsWith("ask-")) askStorageManager();
      else find();
    }
    return { state: { checks: 0 } };
  },
  onAction: (state) => ({ state: { checks: state.checks + 1 } }),
  onLeave: (state) => ({ state }),
  screen: () => ({
    parts: Object.entries(report).map(([name, outcome]) => ({
      kind: "text" as const,
      text: `${name} => ${outcome}`.slice(0, 2_000),
    })),
  }),
  controller: () => ({
    parts: [{ kind: "button", label: "Report", action: { type: "report" } }],
  }),
});
