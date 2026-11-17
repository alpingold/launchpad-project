/**
 * Before the browser tests: builds the Game frame, the test Screen page and the test bundles, then
 * starts three servers on the origins in origins.ts. Returns the teardown that stops them.
 *
 * The frame is served by the real frame server with its real header, so the tests attack exactly
 * what production serves. The site and the outside server count every request to /probe/, so a
 * test can prove nothing left the browser, rather than trusting that an attempt "failed".
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build, defaultClientConditions } from "vite";
import { buildOfficialGames } from "../games/scripts/build.js";
import { createFrameServer } from "../server/src/frame-origin.js";
import { FRAME, OUTSIDE, SITE } from "./origins.js";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const out = here(".build");
const conditions = ["@boilergames/source", ...defaultClientConditions];
const GAME_GLOBAL = "BoilerGamesGame";
const BUNDLES = ["best-word", "hostile", "hoarder"];

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function buildAll(): Promise<void> {
  // The frame, with the client's own frame config, into .build/frame/v1.
  await build({ configFile: here("../client/vite.frame.config.ts"), root: here("../client"), logLevel: "warn", build: { outDir: join(out, "frame/v1") } });
  // The test Screen page.
  await build({
    configFile: false,
    root: here("harness"),
    logLevel: "warn",
    resolve: { conditions },
    build: { outDir: join(out, "site"), emptyOutDir: true },
  });
  // Each test Game as a bundle: one classic script assigning the Game to the global, as step 5 will build them.
  for (const name of BUNDLES) {
    await build({
      configFile: false,
      logLevel: "warn",
      resolve: { conditions },
      build: {
        outDir: join(out, "site/games"),
        emptyOutDir: false,
        minify: false,
        lib: { entry: here(`games/${name}.ts`), formats: ["iife"], name: GAME_GLOBAL, fileName: () => `${name}.js` },
      },
    });
  }
  // The Official games, built by their own build script, exactly as `npm run build` builds them.
  await buildOfficialGames(join(out, "site/games/official"));
}

/** Every /probe/ request a counting server has had: method and path, or "upgrade" for a WebSocket. */
type Hits = string[];

function listen(server: Server, origin: string): Promise<void> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(url.port), url.hostname === "localhost" ? "localhost" : url.hostname, () => resolve());
  });
}

/** Answers /__hits with what it counted. Anything else under /probe/ is counted and answered 200. */
function counting(hits: Hits, request: IncomingMessage, response: ServerResponse): boolean {
  const path = new URL(request.url ?? "/", "http://x").pathname;
  if (path === "/__hits") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(hits));
    return true;
  }
  if (path.startsWith("/probe/")) {
    hits.push(`${request.method ?? "?"} ${path}`);
    response.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" }).end("reached");
    return true;
  }
  return false;
}

function countUpgrades(server: Server, hits: Hits): void {
  server.on("upgrade", (request: IncomingMessage, socket) => {
    hits.push(`upgrade ${new URL(request.url ?? "/", "http://x").pathname}`);
    socket.destroy();
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await buildAll();

  const siteHits: Hits = [];
  const site = createServer((request, response) => {
    if (counting(siteHits, request, response)) return;
    const path = new URL(request.url ?? "/", SITE).pathname;
    const file = normalize(join(out, "site", path === "/" ? "index.html" : path));
    if (!file.startsWith(join(out, "site"))) return void response.writeHead(404).end();
    readFile(file).then(
      (body) =>
        response
          .writeHead(200, {
            "content-type": TYPES[extname(file)] ?? "application/octet-stream",
            // Something for a Game to steal, if it could reach the site's cookies.
            "set-cookie": "site-secret=only-for-the-site; Path=/; SameSite=Lax",
          })
          .end(body),
      () => response.writeHead(404).end(),
    );
  });
  countUpgrades(site, siteHits);

  const outsideHits: Hits = [];
  const outside = createServer((request, response) => {
    if (!counting(outsideHits, request, response)) response.writeHead(404).end();
  });
  countUpgrades(outside, outsideHits);

  const frame = createFrameServer({ root: join(out, "frame"), siteOrigin: SITE });

  await Promise.all([listen(site, SITE), listen(outside, OUTSIDE), listen(frame, FRAME)]);
  return async () => {
    for (const server of [site, outside, frame]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
