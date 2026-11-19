/**
 * The site's HTTP side, with Express: the built client, accounts (sign-in.ts), and Games: the
 * Official ones and those Creators upload, their lists and their code (games.ts). The game domain
 * (the frame) is a separate server: see frame-origin.ts.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { PlaytestRunner } from "@boilergames/playtest/client";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import type { Database } from "./db/database.js";
import { GAME_LIMITS, gameRoutes, UPLOAD_PATHS, uploadBodies, type Listing, type OfficialGames } from "./games.js";
import { keyRoutes } from "./generations/key-routes.js";
import type { KeySecret } from "./generations/key-secret.js";
import type { Model } from "./generations/model.js";
import { libraryRoutes } from "./library.js";
import type { Mail } from "./mail.js";
import { playCounter } from "./plays.js";
import type { Clock, EndedMatch } from "./rooms.js";
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
  /** How a Playtest is run, for Uploads. Null: there is none, and Uploads are refused. */
  readonly playtest: PlaytestRunner | null;
  /** The model the AI maker talks to. Null: none, and the AI maker is off. */
  readonly model: Model | null;
  /** What Creators' keys are encrypted with. Null: none, and the AI maker is off. */
  readonly keySecret: KeySecret | null;
}

export interface Site {
  readonly app: Express;
  /** For Rooms (onMatchEnd): counts the play if it meets the rules (plays.ts). */
  readonly matchEnded: (ended: EndedMatch) => void;
  /** Stops the site's timers. */
  readonly stop: () => void;
}

/** The methods that only read. Every other one changes something, and must pass `onlyFromTheSite`. */
const READING = new Set(["GET", "HEAD", "OPTIONS"]);
/** The most a changing request's JSON body may hold. */
export const MAX_BODY_BYTES = 16 * 1024;

/** The client's pages. Each is the same index.html; the client draws the page its path names. */
const PAGES = ["/screen", "/play", "/sign-in", "/sign-in/confirm", "/sign-in/name", "/my/games", "/my/games/:id", "/library", "/library/:id", "/make", "/privacy", "/my/genai-key"];

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
function loadGames(gamesDist: string): OfficialGames {
  let listed: (Listing & { readonly description?: unknown })[];
  try {
    listed = JSON.parse(readFileSync(join(gamesDist, "games.json"), "utf8")) as (Listing & { readonly description?: unknown })[];
  } catch (error) {
    // Not built yet (development before the first build): no Games, rather than no server.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.warn(`No games.json in ${gamesDist}: run npm run build to build the Official games.`);
    return { listing: [], bundles: new Map(), descriptions: new Map() };
  }
  const bundles = new Map<string, Buffer>();
  const descriptions = new Map<string, string>();
  const listing: Listing[] = [];
  for (const { description, ...game } of listed) {
    if (typeof (game.id as unknown) !== "string" || !/^[a-z0-9-]+$/.test(game.id)) throw new Error(`games.json lists a Game with a bad id: ${JSON.stringify(game.id)}`);
    bundles.set(game.id, readFileSync(join(gamesDist, `${game.id}.js`)));
    // The description is the Library's alone: the Lobby's list (/api/games) stays as it was.
    descriptions.set(game.id, typeof description === "string" ? description : "");
    listing.push(game);
  }
  return { listing, bundles, descriptions };
}

export function createSite(options: SiteOptions & SiteParts): Site {
  const official = loadGames(options.gamesDist);
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(onlyFromTheSite(options.siteOrigin));
  // A Game's code is larger than anything else sent: its routes read their bodies first, with their
  // own limit. Every other body is held to MAX_BODY_BYTES.
  app.post(UPLOAD_PATHS, ...uploadBodies());
  app.use(express.json({ limit: MAX_BODY_BYTES }));

  const signIn = signInRoutes(options);
  app.use(signIn.router);
  const games = gameRoutes({ database: options.database, clock: options.clock, playtest: options.playtest, official, signedIn: signIn.signedIn });
  app.use(games.router);
  app.use(libraryRoutes({ database: options.database, official }));
  const plays = playCounter({ database: options.database, clock: options.clock, official });
  // The AI maker is on only with both a model and a key secret: without either, a release runs as
  // before, and the maker's pages say it isn't available.
  const aiMaker = options.model !== null && options.keySecret !== null;
  const keys = keyRoutes({ database: options.database, clock: options.clock, model: options.model, keySecret: options.keySecret, signedIn: signIn.signedIn });
  app.use(keys.router);

  // What the pages need to know about this deployment: where the Game frame is served, and the
  // limits a Game is held to (for /make), and whether the AI maker is on.
  app.get("/api/config", (_request, response) => {
    response.json({ frameUrl: options.frameUrl, limits: GAME_LIMITS, aiMaker });
  });

  app.use(express.static(options.clientDist, { index: "index.html", dotfiles: "deny" }));
  app.get(PAGES, (_request, response) => {
    response.sendFile("index.html", { root: options.clientDist });
  });
  app.use((_request, response) => {
    response.status(404).type("text/plain").send("Not found");
  });
  app.use(errors);
  return {
    app,
    matchEnded: plays.matchEnded,
    stop: () => {
      signIn.stop();
      games.stop();
      plays.stop();
      keys.stop();
    },
  };
}
