/**
 * The game domain (ADR 0004): a second origin that serves the Game frame's one page and nothing
 * else. In development it is a second port; in production, its own domain.
 *
 * Plain `node:http`, not Express: it has no API, no cookies and nothing private, and one page
 * needs no framework. The less runs here, the less there is to attack.
 *
 * The page carries its script inline, and the CSP allows that script by its hash and no script
 * from any URL. The server reads the page once, when it starts, and takes the hash from that same
 * copy, so the page it serves and the header it sends can't disagree. A new build is served after
 * a restart, with its own hash.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

/** The frame's page, by URL path. One folder per SDK version; old ones stay so old Matches can resume. */
const PAGE_PATHS = new Set(["/v1/", "/v1/index.html"]);
const PAGE_FILE = "v1/index.html";

/**
 * The Content-Security-Policy every response here carries. Each line is a wall, and no source in
 * it can reach the network: no 'self', no host, no http(s) or ws(s), no wildcard. Line by line:
 *
 * - `default-src 'none'`: whatever isn't named below is refused.
 * - `script-src 'sha256-…'`: the page's own inline script, by its hash, and nothing else. Not
 *   'self': with it, a Game's importScripts or import() reached this server, with whatever it
 *   put in the URL (Chromium and Firefox). A blob: worker inherits this policy, so inside the
 *   Game's worker no script URL loads at all. With no page built, `'none'`.
 * - `worker-src blob:`: the frame starts the Game's worker, and the worker that empties the cache
 *   store, from blob: URLs, which name data already in the page. blob: reaches no network.
 * - `connect-src`, `img-src`, `font-src`, `media-src`, `object-src`, `frame-src`, `form-action`,
 *   `base-uri`: all 'none'. connect-src covers fetch, XMLHttpRequest, WebSocket, EventSource and
 *   beacons; images, fonts and media are refused too, because loading one sends its URL out.
 * - `webrtc 'block'`: peer connections, which no other directive covers, in browsers that know it.
 * - `sandbox allow-scripts`: the page gets an opaque origin even when opened on its own, not only
 *   inside the Screen's sandboxed iframe. Never `allow-same-origin`.
 * - `frame-ancestors <the site>`: the one directive that names a host. It allows no request; it
 *   says which page may embed this one, and refuses every other.
 */
export function frameContentSecurityPolicy(siteOrigin: string, scriptHash: string | null): string {
  return [
    "default-src 'none'",
    scriptHash === null ? "script-src 'none'" : `script-src 'sha256-${checkedHash(scriptHash)}'`,
    "worker-src blob:",
    "connect-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "webrtc 'block'",
    "sandbox allow-scripts",
    `frame-ancestors ${checkedOrigin(siteOrigin)}`,
  ].join("; ");
}

/** An origin goes into the header as it is, so it must be nothing else: no path, wildcard or `;`. */
function checkedOrigin(origin: string): string {
  if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(origin)) throw new Error(`"${origin}" isn't an origin like https://boilergames.party`);
  return origin;
}

function checkedHash(hash: string): string {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(hash)) throw new Error(`"${hash}" isn't a base64 SHA-256 hash`);
  return hash;
}

/**
 * The hash the CSP allows the page's script by: base64 SHA-256 of the exact text between its
 * <script> and </script>. The page must hold exactly one script, inline, with no attributes.
 */
export function inlineScriptHash(html: string): string {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const only = scripts[0];
  if (scripts.length !== 1 || only === undefined) throw new Error(`the frame page must hold exactly one <script>; it holds ${scripts.length}`);
  if (only[1]?.trim() !== "") throw new Error("the frame page's <script> must be inline, with no attributes");
  return createHash("sha256").update(only[2] ?? "", "utf8").digest("base64");
}

export interface FrameServerOptions {
  /** The folder holding v1/index.html: client/dist/frame. */
  readonly root: string;
  /** The site's origin, the only page allowed to embed the frame. */
  readonly siteOrigin: string;
}

export function createFrameServer(options: FrameServerOptions): Server {
  let page: { readonly body: Buffer; readonly etag: string } | null;
  let scriptHash: string | null;
  try {
    const body = readFileSync(join(options.root, PAGE_FILE));
    scriptHash = inlineScriptHash(body.toString("utf8"));
    // The ETag names this exact page. A browser that has it cached gets 304 only while the server
    // serves this same page, and a 304's headers replace the cached ones: so the cached page is
    // only ever paired with its own hash. After a new build, the old ETag doesn't match: 200.
    page = { body, etag: `"${createHash("sha256").update(body).digest("base64url")}"` };
  } catch (error) {
    // Not built yet (development before the first build). Serve nothing, with no script allowed.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    page = null;
    scriptHash = null;
  }
  const policy = frameContentSecurityPolicy(options.siteOrigin, scriptHash);

  return createServer((request, response) => {
    // On every response, errors included, so no page here is ever without the walls.
    response.setHeader("Content-Security-Policy", policy);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    // Cached, but checked with the server every time (by its ETag) before it is used.
    response.setHeader("Cache-Control", "no-cache");

    const path = new URL(request.url ?? "/", "http://frame").pathname;
    if (!PAGE_PATHS.has(path) || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    if (page === null) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not built yet: run npm run build");
      return;
    }
    response.setHeader("ETag", page.etag);
    if (request.headers["if-none-match"] === page.etag) {
      response.writeHead(304).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(request.method === "HEAD" ? undefined : page.body);
  });
}
