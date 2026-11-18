/**
 * The Creator's side of the site's API (server/src/games.ts): their own Games and Versions. Every
 * text in here that a Creator wrote (a description, a title from a Game's code) is shown as text,
 * never as markup: React writes it into the page as text.
 */
import { get, post, put, type Answer } from "../account/account-api.js";

export interface Problem {
  readonly stage: "source" | "types" | "bundle" | "play";
  readonly message: string;
  readonly line?: number;
}

export interface Version {
  readonly id: string;
  readonly number: number;
  readonly state: "checking" | "ready" | "failed";
  readonly problems: readonly Problem[] | null;
  readonly about: { readonly title: string; readonly players: { readonly min: number; readonly max: number } } | null;
  readonly createdAt: number;
}

export interface Game {
  readonly id: string;
  readonly description: string;
  readonly publishedVersionId: string | null;
  /** When an admin took it down, or null. While set, it can't be published. */
  readonly takenDownAt: number | null;
  readonly versions: readonly Version[];
}

/** One of the Creator's Games, as their list shows it. */
export interface GameLine {
  readonly id: string;
  readonly title: string | null;
  readonly published: boolean;
  readonly latest: { readonly number: number; readonly state: Version["state"] } | null;
}

/** The largest source the site takes, in bytes (the Playtest's own limit). */
export const MAX_SOURCE_BYTES = 256 * 1024;
/** The longest description, in characters. */
export const DESCRIPTION_MAX = 300;

/** What the Creator's page says while an admin's takedown stands (the server's own words for it). */
export const TAKEN_DOWN = "An admin took this Game down. Write to the site's owner if you think that was a mistake.";

/** What each stage of the check is called on the page. */
export const STAGE_NAMES: Readonly<Record<Problem["stage"], string>> = { source: "The code", types: "Type check", bundle: "Bundling", play: "Playing it" };

export const myGames = () => get<{ games: GameLine[] }>("/api/my/games");
export const myGame = (id: string) => get<{ game: Game }>(`/api/my/games/${encodeURIComponent(id)}`);
export const uploadGame = (source: string) => post<{ game: Game }>("/api/my/games", { source });
export const uploadVersion = (gameId: string, source: string) => post<{ version: Version }>(`/api/my/games/${encodeURIComponent(gameId)}/versions`, { source });
export const saveDescription = (gameId: string, description: string) => put<{ game: Game }>(`/api/my/games/${encodeURIComponent(gameId)}`, { description });
export const publishVersion = (gameId: string, versionId: string) => post<{ game: Game }>(`/api/my/games/${encodeURIComponent(gameId)}/publish`, { versionId });
export const unpublishGame = (gameId: string) => post<{ game: Game }>(`/api/my/games/${encodeURIComponent(gameId)}/unpublish`, {});

/** The title a Game goes by: its published Version's, or its newest ready one's, or none yet. */
export function titleOf(game: Game): string | null {
  const shown = game.versions.find((version) => version.id === game.publishedVersionId) ?? game.versions.find((version) => version.state === "ready");
  return shown?.about?.title ?? null;
}

export type { Answer };
