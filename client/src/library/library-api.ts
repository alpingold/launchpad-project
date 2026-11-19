/**
 * The Library's side of the site's API (server/src/library.ts): read-only and public. A Game's
 * title, description and Creator's name are a stranger's text: React writes them into the page as
 * text, never as markup.
 */
import type { Look } from "@boilergames/sdk/v1";
import { get } from "../account/account-api.js";

/** One Game in the Library, named by its Game id (an Official game by its name). */
export interface LibraryEntry {
  readonly id: string;
  /** What /screen?play= takes. */
  readonly playId: string;
  readonly title: string;
  readonly players: { readonly min: number; readonly max: number };
  /** A ready Version's Look: already checked for readable contrast by the Playtest. */
  readonly look?: Look;
  readonly description: string;
  /** Null for an Official game. */
  readonly creator: string | null;
  readonly madeBy: "Official" | "Uploaded" | "AI-made";
  /** Seconds since 1970; null for an Official game. */
  readonly publishedAt: number | null;
  readonly plays: number;
}

export const library = () => get<readonly LibraryEntry[]>("/api/library");
export const libraryEntry = (id: string) => get<LibraryEntry>(`/api/library/${encodeURIComponent(id)}`);

/** Where hosting a Game starts: a Screen with a Room, offering it. */
export const hostAddress = (entry: LibraryEntry) => `/screen?play=${encodeURIComponent(entry.playId)}`;

/**
 * A Game's counted plays, in words. "About", because the Host's browser reports a Match's end, so the
 * count can only be approximate (the glossary's "Counted play"). Said in this one place, so the
 * wording can change in one place if the owner decides it otherwise.
 */
export function aboutPlays(plays: number): string {
  if (plays === 0) return "Not played yet";
  return `About ${plays.toLocaleString("en-US")} ${plays === 1 ? "play" : "plays"}`;
}

/** "2 to 6 players", or "4 players" when it takes exactly that many. */
export function playerCount(players: LibraryEntry["players"]): string {
  return players.min === players.max ? `${players.min} ${players.min === 1 ? "player" : "players"}` : `${players.min} to ${players.max} players`;
}

/** Who made it, and how. */
export function madeBy(entry: LibraryEntry): string {
  if (entry.madeBy === "Official") return "An Official game, made by BoilerGames";
  if (entry.madeBy === "AI-made") return `AI-made by ${entry.creator ?? "a Creator"}`;
  return `Uploaded by ${entry.creator ?? "a Creator"}`;
}
