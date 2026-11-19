/**
 * Counted plays (BUILD-PLAN Step 18): which ended Matches add one to their Game's count.
 *
 * The Engine runs in the Host's browser (ADR 0005), so it is the Host's browser that says a Match
 * finished, and a Room needs no account. These rules make a false count slow, not impossible, which
 * is why a Game's page says "about N plays". Every number the rules use is the server's own: the
 * Seats it holds, the Player count it read from the Game's code, the time by its own clock.
 *
 * A play that isn't counted is not an error and nobody is told. Counting never delays or breaks the
 * Room: Rooms calls this after the Room is back in the Lobby, and a database error is only logged.
 */
import type { Database } from "./db/database.js";
import { publishedGameOfVersion } from "./db/games.js";
import { addPlay, type PlaySubject } from "./db/plays.js";
import type { OfficialGames } from "./games.js";
import { WindowLimit } from "./limits.js";
import type { Clock, EndedMatch } from "./rooms.js";

/** The shortest Match that counts. A Room plays one Match at a time, so this alone caps a Room at 120 counted plays an hour. */
export const MIN_COUNTED_MATCH_MS = 30_000;
/**
 * The most counted plays one Screen's address may have in 24 hours. Generous: a campus network can
 * put many Rooms behind one address. Kept in memory, like the other per-address limits, so a restart
 * forgets it.
 */
export const COUNTED_PLAYS_PER_ADDRESS_PER_DAY = 60;
const DAY_MS = 24 * 60 * 60_000;
/** How often addresses with nothing left in their window are forgotten. */
const SWEEP_MS = 60 * 60_000;

export interface PlayCounterOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly official: OfficialGames;
  /** Where a failure to count is written. console.error unless a test wants to see it. */
  readonly log?: (line: string) => void;
}

export interface PlayCounter {
  /** Rooms' onMatchEnd: counts the Match if it meets every rule. */
  readonly matchEnded: (ended: EndedMatch) => void;
  /** Stops the sweep timer. */
  readonly stop: () => void;
}

export function playCounter(options: PlayCounterOptions): PlayCounter {
  const { database, clock, official } = options;
  const log = options.log ?? ((line: string) => console.error(line));
  const perAddress = new WindowLimit(COUNTED_PLAYS_PER_ADDRESS_PER_DAY, DAY_MS, clock);
  let cancel = clock.setTimeout(function again() {
    perAddress.sweep();
    cancel = clock.setTimeout(again, SWEEP_MS);
  }, SWEEP_MS);

  /** What the Match's `gameId` counts for, and the fewest Players its Game needs; undefined if it counts for nothing. */
  function subjectOf(gameId: string): { readonly subject: PlaySubject; readonly fewest: number } | undefined {
    const officialOne = official.listing.find((listing) => listing.id === gameId);
    if (officialOne !== undefined) return { subject: { official: officialOne.id }, fewest: officialOne.players.min };
    // A ready Version of a Game that is published now: any of its Versions, since the count is the
    // Game's. A Creator's private plays of an unpublished Game, or a taken-down one's, don't count.
    const game = publishedGameOfVersion(database, gameId);
    return game === undefined ? undefined : { subject: { gameId: game.gameId }, fewest: game.about.players.min };
  }

  function matchEnded(ended: EndedMatch): void {
    if (ended.reason !== "finished") return;
    if (ended.lengthMs < MIN_COUNTED_MATCH_MS) return;
    if (perAddress.wait(ended.screenAddress) > 0) return;
    try {
      const found = subjectOf(ended.gameId);
      if (found === undefined || ended.seats < found.fewest) return;
      addPlay(database, found.subject);
      // Only a play actually counted is held against the address.
      perAddress.record(ended.screenAddress);
    } catch (error) {
      // Never the address or the Room: the logs keep nothing about who played.
      log(`Counting a play failed: ${(error as Error).message}`);
    }
  }

  return { matchEnded, stop: () => cancel() };
}
