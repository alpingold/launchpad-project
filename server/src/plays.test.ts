// Counted plays: each rule on its own, against a real database in memory. A play that isn't counted
// changes nothing and says nothing; a database that fails is logged and the Room goes on.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { createAccount, setDisplayName } from "./db/accounts.js";
import { IN_MEMORY, openDatabase, type Database } from "./db/database.js";
import { createGame, createVersion, finishCheck, publish, takeDown, unpublish } from "./db/games.js";
import { playsOf } from "./db/plays.js";
import type { OfficialGames } from "./games.js";
import { COUNTED_PLAYS_PER_ADDRESS_PER_DAY, MIN_COUNTED_MATCH_MS, playCounter, type PlayCounter } from "./plays.js";
import type { Clock, EndedMatch } from "./rooms.js";

class FakeClock implements Clock {
  time = 1_800_000_000_000;
  now = () => this.time;
  setTimeout = () => () => undefined;
}

/** One Official game, for 2 to 6 Players, as games.json lists it. */
const OFFICIAL: OfficialGames = { listing: [{ id: "allotments", title: "Allotments", players: { min: 2, max: 6 } }], bundles: new Map() };

let db: Database;
let clock: FakeClock;
let logged: string[];
let counter: PlayCounter;

beforeEach(() => {
  db = openDatabase({ file: IN_MEMORY, log: () => undefined });
  clock = new FakeClock();
  logged = [];
  counter = playCounter({ database: db, clock, official: OFFICIAL, log: (line) => logged.push(line) });
  createAccount(db, { id: "a1", email: "ada@purdue.edu", createdAt: 1 });
  setDisplayName(db, "a1", "Ada", "ada");
});

const about = (min: number) => ({ title: "Three Taps", players: { min, max: 8 } });

/** A Game with one Version per entry, each checked as given: a number is a ready Version's fewest Players. */
function gameWith(id: string, versions: readonly (number | "failed" | "checking")[]): string[] {
  createGame(db, { id, ownerId: "a1", createdAt: 1 });
  return versions.map((state, index) => {
    const versionId = `${id}-v${index + 1}`;
    createVersion(db, { id: versionId, gameId: id, source: "// code", createdAt: 1 + index });
    if (state === "failed") finishCheck(db, versionId, { ok: false, problems: [{ stage: "types", message: "no" }] }, 2);
    else if (typeof state === "number") finishCheck(db, versionId, { ok: true, bundle: "// bundle", about: about(state) }, 2);
    return versionId;
  });
}

/** A Match that meets every rule for a Game of 2 Players; `change` breaks one. */
function ended(change: Partial<EndedMatch> = {}): EndedMatch {
  return { gameId: "allotments", reason: "finished", seats: 2, lengthMs: MIN_COUNTED_MATCH_MS, screenAddress: "10.0.0.1", ...change };
}

const officialPlays = () => playsOf(db, { official: "allotments" });

describe("a play is counted", () => {
  test("an Official game's finished Match, at least 30 seconds long, with at least its fewest Players", () => {
    counter.matchEnded(ended());
    counter.matchEnded(ended({ seats: 6, lengthMs: 10 * 60_000 }));
    expect(officialPlays()).toBe(2);
  });

  test("a published Game's: counted for the Game, whichever of its ready Versions was played", () => {
    const [first, second] = gameWith("g1", [2, 2]);
    publish(db, "g1", second!);
    counter.matchEnded(ended({ gameId: second! }));
    counter.matchEnded(ended({ gameId: first! }));
    expect(playsOf(db, { gameId: "g1" })).toBe(2);
    expect(logged).toEqual([]);
  });
});

describe("each rule on its own", () => {
  test.each(["stopped", "broken", "tooFewPlayers"] as const)("a Match that ended %s doesn't count", (reason) => {
    counter.matchEnded(ended({ reason }));
    expect(officialPlays()).toBe(0);
  });

  test("a Match shorter than 30 seconds doesn't count", () => {
    counter.matchEnded(ended({ lengthMs: MIN_COUNTED_MATCH_MS - 1 }));
    expect(officialPlays()).toBe(0);
  });

  test("a Room with fewer Seats than the Game's fewest Players doesn't count: an Official game's, from its listing", () => {
    counter.matchEnded(ended({ seats: 1 }));
    expect(officialPlays()).toBe(0);
  });

  test("the same for an uploaded Game: its fewest Players are read from the Version's about", () => {
    const [versionId] = gameWith("g1", [3]);
    publish(db, "g1", versionId!);
    counter.matchEnded(ended({ gameId: versionId!, seats: 2 }));
    expect(playsOf(db, { gameId: "g1" })).toBe(0);
    counter.matchEnded(ended({ gameId: versionId!, seats: 3 }));
    expect(playsOf(db, { gameId: "g1" })).toBe(1);
  });

  test("a Creator's private plays of an unpublished Game don't count", () => {
    const [versionId] = gameWith("g1", [2]);
    counter.matchEnded(ended({ gameId: versionId! }));
    expect(playsOf(db, { gameId: "g1" })).toBe(0);
  });

  test("an unpublished Game's plays don't count, though it was published once", () => {
    const [versionId] = gameWith("g1", [2]);
    publish(db, "g1", versionId!);
    unpublish(db, "g1");
    counter.matchEnded(ended({ gameId: versionId! }));
    expect(playsOf(db, { gameId: "g1" })).toBe(0);
  });

  test("a taken-down Game's plays don't count", () => {
    const [versionId] = gameWith("g1", [2]);
    publish(db, "g1", versionId!);
    takeDown(db, "g1", 5);
    counter.matchEnded(ended({ gameId: versionId! }));
    expect(playsOf(db, { gameId: "g1" })).toBe(0);
  });

  test("a Version that failed its check or is still being checked counts for nothing, though its Game is published", () => {
    const [ready, failed, checking] = gameWith("g1", [2, "failed", "checking"]);
    publish(db, "g1", ready!);
    counter.matchEnded(ended({ gameId: failed! }));
    counter.matchEnded(ended({ gameId: checking! }));
    expect(playsOf(db, { gameId: "g1" })).toBe(0);
  });

  test("a gameId that is no Game, Official or uploaded, counts for nothing", () => {
    counter.matchEnded(ended({ gameId: "no-such-game" }));
    expect(officialPlays()).toBe(0);
    expect(playsOf(db, { gameId: "no-such-game" })).toBe(0);
    expect(logged).toEqual([]);
  });

  test(`one Screen's address has at most ${COUNTED_PLAYS_PER_ADDRESS_PER_DAY} counted plays in 24 hours; another address isn't held up`, () => {
    for (let n = 0; n < COUNTED_PLAYS_PER_ADDRESS_PER_DAY + 5; n += 1) counter.matchEnded(ended());
    expect(officialPlays()).toBe(COUNTED_PLAYS_PER_ADDRESS_PER_DAY);
    counter.matchEnded(ended({ screenAddress: "10.0.0.2" }));
    expect(officialPlays()).toBe(COUNTED_PLAYS_PER_ADDRESS_PER_DAY + 1);
    clock.time += 24 * 60 * 60_000;
    counter.matchEnded(ended());
    expect(officialPlays()).toBe(COUNTED_PLAYS_PER_ADDRESS_PER_DAY + 2);
  });

  test("plays that weren't counted don't use up the address's day", () => {
    for (let n = 0; n < COUNTED_PLAYS_PER_ADDRESS_PER_DAY; n += 1) counter.matchEnded(ended({ lengthMs: 1_000 }));
    counter.matchEnded(ended());
    expect(officialPlays()).toBe(1);
  });
});

test("a database that fails is logged, without the address, and nothing is thrown at the Room", () => {
  const [versionId] = gameWith("g1", [2]);
  publish(db, "g1", versionId!);
  db.close();
  expect(() => counter.matchEnded(ended({ gameId: versionId! }))).not.toThrow();
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatch(/^Counting a play failed: /);
  expect(logged[0]).not.toContain("10.0.0.1");
});

test("rooms.ts imports nothing from db/: Rooms stay free of the database", () => {
  const source = readFileSync(new URL("./rooms.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((match) => match[1]);
  expect(imports.length).toBeGreaterThan(0);
  expect(imports.filter((path) => path?.includes("db/") === true || path?.includes("plays") === true)).toEqual([]);
});
