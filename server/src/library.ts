/**
 * The Library (BUILD-PLAN Step 19): every Official game, then every published Game, each with its
 * description, its Creator's display name and its counted plays. Read-only and public.
 *
 * A Game here is named by its **Game id** (an Official game by its name), which lasts: the Lobby's
 * list names an uploaded Game by its published Version's id, which changes with every publish, and a
 * page people link to can't. `playId` is what /screen?play= takes.
 *
 * Neither route reads who is asking: a private Game is "not found" to everyone, its owner included
 * (they have /my/games), so the answer can't tell anyone which private Games exist.
 */
import { Router, type Response } from "express";
import type { Database } from "./db/database.js";
import { libraryGame, libraryGames, type LibraryRow } from "./db/games.js";
import { playsOf } from "./db/plays.js";
import type { Listing, OfficialGames } from "./games.js";

/**
 * The most published Games the Library lists. The browser holds the whole list and searches it
 * itself: with a few hundred Games that is one small response and no search code on the server. If
 * the Library ever nears this cap, searching moves to the server.
 */
export const MAX_LIBRARY_GAMES = 500;

/** One Game in the Library. */
export interface LibraryEntry {
  /** The Game's id, or an Official game's name: the address of its page, /library/<id>. */
  readonly id: string;
  /** What /screen?play= takes: the published Version's id, or the Official game's name. */
  readonly playId: string;
  readonly title: string;
  readonly players: { readonly min: number; readonly max: number };
  readonly look?: unknown;
  readonly description: string;
  /** The Creator's display name; null for an Official game, which the site made. */
  readonly creator: string | null;
  /** How it was made (the glossary's "Made by"): "AI-made" when the site's AI made any of its Versions. */
  readonly madeBy: "Official" | "Uploaded" | "AI-made";
  /**
   * When the published Version was made, in seconds since 1970; null for an Official game, which
   * has no Versions. "Newest" sorts these last: they came with the site.
   */
  readonly publishedAt: number | null;
  /** Counted plays: approximate, since a Host's browser reports a Match's end. */
  readonly plays: number;
}

export interface LibraryOptions {
  readonly database: Database;
  readonly official: OfficialGames;
}

function officialEntry(database: Database, official: OfficialGames, listing: Listing): LibraryEntry {
  return {
    id: listing.id,
    playId: listing.id,
    title: listing.title,
    players: listing.players,
    ...(listing.look === undefined ? {} : { look: listing.look }),
    description: official.descriptions.get(listing.id) ?? "",
    creator: null,
    madeBy: "Official",
    publishedAt: null,
    plays: playsOf(database, { official: listing.id }),
  };
}

function uploadedEntry(row: LibraryRow): LibraryEntry {
  const { title, players, look } = row.about;
  return {
    id: row.gameId,
    playId: row.versionId,
    title,
    players,
    ...(look === undefined ? {} : { look }),
    description: row.description,
    creator: row.creator,
    madeBy: row.aiMade ? "AI-made" : "Uploaded",
    publishedAt: row.publishedAt,
    plays: row.plays,
  };
}

export function libraryRoutes(options: LibraryOptions): Router {
  const { database, official } = options;
  const router = Router();

  // Asked again every time: a Game can be published, unpublished or taken down at any moment.
  router.get("/api/library", (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.json([...official.listing.map((listing) => officialEntry(database, official, listing)), ...libraryGames(database, MAX_LIBRARY_GAMES).map(uploadedEntry)]);
  });

  const notFound = (response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(404).json({ error: "There's no such Game in the Library." });
  };

  router.get("/api/library/:id", (request, response) => {
    const id = String(request.params["id"]);
    const officialOne = official.listing.find((listing) => listing.id === id);
    if (officialOne !== undefined) {
      response.setHeader("Cache-Control", "no-cache");
      return void response.json(officialEntry(database, official, officialOne));
    }
    const row = libraryGame(database, id);
    if (row === undefined) return notFound(response);
    response.setHeader("Cache-Control", "no-cache");
    response.json(uploadedEntry(row));
  });

  return router;
}
