/**
 * Before the browser tests: builds the Game frame, the test Screen page and the test bundles, then
 * starts three servers on the origins in origins.ts. Returns the teardown that stops them.
 *
 * The frame is served by the real frame server with its real header, so the tests attack exactly
 * what production serves. The site and the outside server count every request to /probe/, and the
 * frame server every request it answers, so a test can prove nothing left the browser, rather than
 * trusting that an attempt "failed".
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build, defaultClientConditions } from "vite";
import { buildOfficialGames } from "../games/scripts/build.js";
import { createFrameServer } from "../server/src/frame-origin.js";
import { createServer as createSiteServer } from "../server/src/index.js";
import { APP, APP_FRAME, FRAME, OUTSIDE, SITE } from "./origins.js";

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
  // The client, with its own config, as `npm run build` builds it.
  await build({ configFile: here("../client/vite.config.ts"), root: here("../client"), logLevel: "warn", build: { outDir: join(out, "client"), emptyOutDir: true } });
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

/**
 * The real frame server, counted: every request it answers, as "METHOD /path?query status". The
 * frame's own page loads are the only requests it should ever see.
 */
function countedFrameServer(root: string, hits: Hits): Server {
  const server = createFrameServer({ root, siteOrigin: SITE });
  server.prependListener("request", (request: IncomingMessage, response: ServerResponse) => {
    response.on("finish", () => hits.push(`${request.method ?? "?"} ${request.url ?? "?"} ${response.statusCode}`));
  });
  server.on("upgrade", (request: IncomingMessage, socket) => {
    hits.push(`upgrade ${request.url ?? "?"}`);
    socket.destroy();
  });
  return server;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await buildAll();

  const frameHits: Hits = [];
  let frame = countedFrameServer(join(out, "frame"), frameHits);
  let builds = 1;

  /**
   * Stands in for deploying a new build: the same page with a changed script, served by a restarted
   * frame server on the same port. A browser holding the old page must get the new one, with its own
   * hash, never the old page with the new header.
   */
  async function newBuild(): Promise<void> {
    builds += 1;
    const page = await readFile(join(out, builds === 2 ? "frame" : `frame-${builds - 1}`, "v1/index.html"), "utf8");
    const root = join(out, `frame-${builds}`);
    await mkdir(join(root, "v1"), { recursive: true });
    await writeFile(join(root, "v1/index.html"), page.replace("</script>", `;void "build ${builds}";</script>`));
    frame.closeAllConnections();
    await new Promise((resolve) => frame.close(resolve));
    frame = countedFrameServer(root, frameHits);
    await listen(frame, FRAME);
  }

  const siteHits: Hits = [];
  const site = createServer((request, response) => {
    const path = new URL(request.url ?? "/", SITE).pathname;
    // What the frame server has answered, for the tests; and a new build of the frame.
    if (path === "/__frame-hits") return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(frameHits));
    if (path === "/__new-build" && request.method === "POST") {
      return void newBuild().then(
        () => response.writeHead(200).end("rebuilt"),
        (error: unknown) => response.writeHead(500).end(String(error)),
      );
    }
    if (counting(siteHits, request, response)) return;
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

  // The real site, as main.ts runs it, and the frame server it embeds.
  // Every test's browsers come from 127.0.0.1, and a run opens far more than 20 Rooms a minute; here
  // each socket counts as its own address, so the per-address limits (tested exactly in the
  // server's own tests) don't trip the browser tests.
  let sockets = 0;
  const app = createSiteServer({
    clientDist: join(out, "client"),
    gamesDist: join(out, "site/games/official"),
    siteOrigin: APP,
    frameUrl: `${APP_FRAME}/v1/`,
    addressOf: () => `test-${++sockets}`,
    // A test's Room stays open for 5 minutes after its Screen goes, and a run opens far more than
    // the default 30 in that time.
    maxRooms: 1_000,
  });
  const appFrame = createFrameServer({ root: join(out, "frame"), siteOrigin: APP });

  await Promise.all([listen(site, SITE), listen(outside, OUTSIDE), listen(frame, FRAME), listen(app.http, APP), listen(appFrame, APP_FRAME)]);
  return async () => {
    await app.close();
    for (const server of [site, outside, frame, appFrame]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
