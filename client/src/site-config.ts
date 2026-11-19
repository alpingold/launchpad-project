/**
 * What the site says about itself (/api/config): where the Game frame is served, and the limits a
 * Game is held to, which are the Playtest's and the site's own numbers (server/src/games.ts,
 * GAME_LIMITS). Fetched once per page and shared, so no page keeps a copy of a limit of its own.
 */
import type { GameLimits } from "./make/rules.js";

export interface SiteConfig {
  readonly frameUrl: string;
  readonly limits: GameLimits;
}

let loading: Promise<SiteConfig> | undefined;

/** The site's config. A failed fetch isn't kept, so the next call tries again. */
export function siteConfig(): Promise<SiteConfig> {
  loading ??= fetch("/api/config")
    .then((response) => {
      if (!response.ok) throw new Error(`The site's config couldn't be loaded (${response.status}).`);
      return response.json() as Promise<SiteConfig>;
    })
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}
