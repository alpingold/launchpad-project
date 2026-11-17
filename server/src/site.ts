/**
 * The site's HTTP side, with Express: the built client, the list of Official games, and each Game's
 * bundle. The game domain (the frame) is a separate server: see frame-origin.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";

export interface SiteOptions {
  /** The built client: client/dist. Never the frame's build, which lives apart in client/dist-frame. */
  readonly clientDist: string;
  /** The built Official games: games/dist, with games.json and one <id>.js per Game. */
  readonly gamesDist: string;
  /** The Game frame's page on the game domain, such as https://boilergames-play.party/v1/. */
  readonly frameUrl: string;
}

/** The client's pages. Each is the same index.html; the client draws the page its path names. */
const PAGES = ["/screen", "/play"];

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

export function createSite(options: SiteOptions): Express {
  const { listing, bundles } = loadGames(options.gamesDist);
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

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
  return app;
}
