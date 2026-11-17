/**
 * The game domain (ADR 0004): a second origin that serves the Game frame's two files and nothing
 * else. In development it is a second port; in production, its own domain.
 *
 * Plain `node:http`, not Express: it has no API, no cookies and nothing private, and two files
 * need no framework. The less runs here, the less there is to attack.
 */
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

/** The frame's files, by URL path. One folder per SDK version; old ones stay so old Matches can resume. */
const FILES: Readonly<Record<string, { readonly file: string; readonly type: string }>> = {
  "/v1/": { file: "v1/index.html", type: "text/html; charset=utf-8" },
  "/v1/index.html": { file: "v1/index.html", type: "text/html; charset=utf-8" },
  "/v1/frame.js": { file: "v1/frame.js", type: "text/javascript; charset=utf-8" },
};

/**
 * The Content-Security-Policy every response here carries. Each line is a wall:
 *
 * - Scripts: only the page's own `frame.js` ('self'), and workers only from blob: URLs, which is how
 *   the frame starts the Game. A blob: worker inherits this policy, so the Game gets it too.
 * - Network: none. connect-src covers fetch, XMLHttpRequest, WebSocket, EventSource and beacons;
 *   images, fonts and media are refused too, because loading one sends its URL out. webrtc 'block'
 *   stops peer connections, which no other directive covers, in browsers that know it.
 * - `sandbox allow-scripts`: the page gets an opaque origin even when opened on its own, not
 *   only inside the Screen's sandboxed iframe. Never `allow-same-origin`.
 * - frame-ancestors: only the site may embed the frame.
 */
export function frameContentSecurityPolicy(siteOrigin: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
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

export interface FrameServerOptions {
  /** The folder holding v1/index.html and v1/frame.js: client/dist/frame. */
  readonly root: string;
  /** The site's origin, the only page allowed to embed the frame. */
  readonly siteOrigin: string;
}

export function createFrameServer(options: FrameServerOptions): Server {
  const policy = frameContentSecurityPolicy(options.siteOrigin);
  return createServer((request, response) => {
    // On every response, errors included, so no page here is ever without the walls.
    response.setHeader("Content-Security-Policy", policy);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-cache");

    const path = new URL(request.url ?? "/", "http://frame").pathname;
    const entry = Object.hasOwn(FILES, path) ? FILES[path] : undefined;
    if (entry === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    readFile(join(options.root, entry.file)).then(
      (body) => response.writeHead(200, { "content-type": entry.type }).end(request.method === "HEAD" ? undefined : body),
      () => response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not built yet: run npm run build"),
    );
  });
}
