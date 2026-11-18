/**
 * The site's HTTP side, with Express: the built client, the list of Official games, each Game's
 * bundle, and accounts (sign-in.ts). The game domain (the frame) is a separate server: see
 * frame-origin.ts.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import type { Database } from "./db/database.js";
import type { Mail } from "./mail.js";
import type { Clock } from "./rooms.js";
import { signInRoutes } from "./sign-in.js";

export interface SiteOptions {
  /** The built client: client/dist. Never the frame's build, which lives apart in client/dist-frame. */
  readonly clientDist: string;
  /** The built Official games: games/dist, with games.json and one <id>.js per Game. */
  readonly gamesDist: string;
  /** The Game frame's page on the game domain, such as https://boilergames-play.party/v1/. */
  readonly frameUrl: string;
}

export interface SiteParts {
  /** The database, opened and up to date. */
  readonly database: Database;
  readonly mail: Mail;
  readonly clock: Clock;
  /** The site's own origin: the only one whose pages may change anything. */
  readonly siteOrigin: string;
  /** The visitor's network address, for the per-visitor limits. */
  readonly addressOf: (request: IncomingMessage) => string;
}

export interface Site {
  readonly app: Express;
  /** Stops the site's timers. */
  readonly stop: () => void;
}

/** The methods that only read. Every other one changes something, and must pass `onlyFromTheSite`. */
const READING = new Set(["GET", "HEAD", "OPTIONS"]);
/** The most a changing request's JSON body may hold. */
export const MAX_BODY_BYTES = 16 * 1024;

/** The client's pages. Each is the same index.html; the client draws the page its path names. */
const PAGES = ["/screen", "/play", "/sign-in", "/sign-in/confirm", "/sign-in/name"];

/**
 * Every request that changes something passes here first, before its body is read and before any
 * route, so a route added later can't skip it. It must come from one of the site's own pages (its
 * Origin header), and carry a JSON body.
 *
 * Why: the session cookie is SameSite=Lax, so another site can't make a visitor's browser send it
 * with a POST from a form, a script or an image. A browser always names the page's origin in a
 * POST's Origin header, and a page can't change it. And another site's page can't send a JSON body
 * to this one at all without asking first (a CORS preflight), which the site never allows.
 */
function onlyFromTheSite(siteOrigin: string): RequestHandler {
  return (request, response, next) => {
    if (READING.has(request.method)) return next();
    if (request.headers.origin !== siteOrigin) return void response.status(403).json({ error: "Only the site's own pages can do that." });
    if (request.is("application/json") !== "application/json") return void response.status(415).json({ error: "Send JSON." });
    next();
  };
}

/** Errors: a body that can't be read is the visitor's mistake; anything else is the server's, logged without the request. */
const errors: ErrorRequestHandler = (error: { status?: number; statusCode?: number; message?: string }, _request, response, _next) => {
  const status = error.status ?? error.statusCode ?? 500;
  if (status >= 400 && status < 500) return void response.status(status).json({ error: "That request couldn't be read." });
  console.error(`A request failed: ${error.message ?? String(error)}`);
  response.status(500).json({ error: "Something went wrong on the server." });
};

/**
 * The listing and every bundle, read once at start, together: a bundle is served only if the
 * listing names it, and a request's `:id` is looked up, never turned into a file path.
 */
function loadGames(gamesDist: string): { readonly listing: unknown[]; readonly bundles: Map<string, Buffer> } {
  let listing: { id?: unknown }[];
  try {
    listing = JSON.parse(readFileSync(join(gamesDist, "games.json"), "utf8")) as { id?: unknown }[];
  } catch (error) {
    // Not built yet (development before the first build): no Games, rather than no server.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.warn(`No games.json in ${gamesDist}: run npm run build to build the Official games.`);
    return { listing: [], bundles: new Map() };
  }
  const bundles = new Map<string, Buffer>();
  for (const game of listing) {
    if (typeof game.id !== "string" || !/^[a-z0-9-]+$/.test(game.id)) throw new Error(`games.json lists a Game with a bad id: ${JSON.stringify(game.id)}`);
    bundles.set(game.id, readFileSync(join(gamesDist, `${game.id}.js`)));
  }
  return { listing, bundles };
}

export function createSite(options: SiteOptions & SiteParts): Site {
  const { listing, bundles } = loadGames(options.gamesDist);
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(onlyFromTheSite(options.siteOrigin));
  app.use(express.json({ limit: MAX_BODY_BYTES }));

  const signIn = signInRoutes(options);
  app.use(signIn.router);

  // What the pages need to know about this deployment: where the Game frame is served.
  app.get("/api/config", (_request, response) => {
    response.json({ frameUrl: options.frameUrl });
  });
  app.get("/api/games", (_request, response) => {
    response.json(listing);
  });
  app.get("/api/games/:id/bundle.js", (request, response) => {
    const bundle = bundles.get(request.params.id);
    if (bundle === undefined) return void response.status(404).type("text/plain").send("No such Game");
    response.type("text/javascript").send(bundle);
  });

  app.use(express.static(options.clientDist, { index: "index.html", dotfiles: "deny" }));
  app.get(PAGES, (_request, response) => {
    response.sendFile("index.html", { root: options.clientDist });
  });
  app.use((_request, response) => {
    response.status(404).type("text/plain").send("Not found");
  });
  app.use(errors);
  return { app, stop: signIn.stop };
}
