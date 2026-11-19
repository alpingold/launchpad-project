/**
 * The queries about Games and their Versions. With database.ts, the only file with SQL about them.
 * Every value goes in as a parameter; every row read is parsed.
 *
 * Times here are whole seconds since 1970, as the tables keep them.
 */
import { z } from "zod";
import type { Database } from "./database.js";
import { all, one } from "./rows.js";

/** A Game's `about`, as the Playtest read it from its code: its title, Player count and Look. */
export interface About {
  readonly title: string;
  readonly players: { readonly min: number; readonly max: number };
  readonly look?: unknown;
}

export interface Problem {
  readonly stage: string;
  readonly message: string;
  readonly line?: number;
}

export type VersionState = "checking" | "ready" | "failed";

/** One Version, as its Creator sees it: never its source or its bundle, which are large. */
export interface Version {
  readonly id: string;
  readonly number: number;
  readonly state: VersionState;
  /** Every problem the Playtest found: a failed Version only. */
  readonly problems: readonly Problem[] | null;
  /** What its code says about itself: a ready Version only. */
  readonly about: About | null;
  readonly createdAt: number;
  readonly checkedAt: number | null;
}

export interface Game {
  readonly id: string;
  readonly ownerId: string;
  readonly description: string;
  readonly publishedVersionId: string | null;
  readonly createdAt: number;
  /** When an admin took it down, or null. While set, it can't be published. */
  readonly takenDownAt: number | null;
}

const aboutJson = z
  .string()
  .transform((text) => JSON.parse(text) as unknown)
  .pipe(z.object({ title: z.string(), players: z.object({ min: z.number(), max: z.number() }), look: z.unknown().optional() }));
const problemsJson = z
  .string()
  .transform((text) => JSON.parse(text) as unknown)
  .pipe(z.array(z.object({ stage: z.string(), message: z.string(), line: z.number().optional() })));

const gameRow = z
  .object({
    id: z.string(),
    owner_id: z.string(),
    description: z.string(),
    published_version_id: z.string().nullable(),
    created_at: z.number().int(),
    taken_down_at: z.number().int().nullable(),
  })
  .transform(
    (row): Game => ({
      id: row.id,
      ownerId: row.owner_id,
      description: row.description,
      publishedVersionId: row.published_version_id,
      createdAt: row.created_at,
      takenDownAt: row.taken_down_at,
    }),
  );

const GAME_COLUMNS = "games.id, games.owner_id, games.description, games.published_version_id, games.created_at, games.taken_down_at";

const versionRow = z
  .object({
    id: z.string(),
    number: z.number().int(),
    state: z.enum(["checking", "ready", "failed"]),
    problems: problemsJson.nullable(),
    about: aboutJson.nullable(),
    made_by: z.enum(["upload", "generation", "revision"]),
    sdk_version: z.literal("v1"),
    created_at: z.number().int(),
    checked_at: z.number().int().nullable(),
  })
  .transform(
    (row): Version => ({ id: row.id, number: row.number, state: row.state, problems: row.problems, about: row.about, createdAt: row.created_at, checkedAt: row.checked_at }),
  );

const VERSION_COLUMNS = "versions.id, versions.number, versions.state, versions.problems, versions.about, versions.made_by, versions.sdk_version, versions.created_at, versions.checked_at";

export function createGame(db: Database, game: { readonly id: string; readonly ownerId: string; readonly createdAt: number }): void {
  db.prepare("INSERT INTO games (id, owner_id, created_at) VALUES (?, ?, ?)").run(game.id, game.ownerId, game.createdAt);
}

/** A new Version of a Game, `checking`, numbered after its Game's last one. */
export function createVersion(db: Database, version: { readonly id: string; readonly gameId: string; readonly source: string; readonly createdAt: number }): Version {
  const last = one(z.object({ last: z.number().int().nullable() }), db.prepare("SELECT max(number) AS last FROM versions WHERE game_id = ?").get(version.gameId));
  const number = (last?.last ?? 0) + 1;
  db.prepare("INSERT INTO versions (id, game_id, number, made_by, source, state, sdk_version, created_at) VALUES (?, ?, ?, 'upload', ?, 'checking', 'v1', ?)").run(
    version.id,
    version.gameId,
    number,
    version.source,
    version.createdAt,
  );
  return { id: version.id, number, state: "checking", problems: null, about: null, createdAt: version.createdAt, checkedAt: null };
}

export function gameById(db: Database, gameId: string): Game | undefined {
  return one(gameRow, db.prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE id = ?`).get(gameId));
}

/** An account's Games, newest first. */
export function gamesOwnedBy(db: Database, ownerId: string): Game[] {
  return all(gameRow, db.prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE owner_id = ? ORDER BY created_at DESC, id`).all(ownerId));
}

/** A Game's Versions, newest first. */
export function versionsOf(db: Database, gameId: string): Version[] {
  return all(versionRow, db.prepare(`SELECT ${VERSION_COLUMNS} FROM versions WHERE game_id = ? ORDER BY number DESC`).all(gameId));
}

export function countGames(db: Database, ownerId: string): number {
  return one(z.object({ n: z.number().int() }), db.prepare("SELECT count(*) AS n FROM games WHERE owner_id = ?").get(ownerId))?.n ?? 0;
}

export function countVersions(db: Database, gameId: string): number {
  return one(z.object({ n: z.number().int() }), db.prepare("SELECT count(*) AS n FROM versions WHERE game_id = ?").get(gameId))?.n ?? 0;
}

/**
 * When an account's Uploads since `since` were made, oldest first. Read from the Versions
 * themselves, so a restart (every deploy is one) forgets none of them.
 */
export function uploadTimesSince(db: Database, ownerId: string, since: number): number[] {
  // Uploads only: a Version the site's AI made is held to its own limits (generations/numbers.ts).
  return all(
    z.object({ created_at: z.number().int() }),
    db
      .prepare("SELECT versions.created_at FROM versions JOIN games ON games.id = versions.game_id WHERE games.owner_id = ? AND versions.made_by = 'upload' AND versions.created_at > ? ORDER BY versions.created_at")
      .all(ownerId, since),
  ).map((row) => row.created_at);
}

/** Every Version still `checking`, oldest first, with its owner: the queue, as the database has it. */
export function versionsToCheck(db: Database): { readonly versionId: string; readonly ownerId: string }[] {
  return all(
    z.object({ id: z.string(), owner_id: z.string() }),
    db.prepare("SELECT versions.id, games.owner_id FROM versions JOIN games ON games.id = versions.game_id WHERE versions.state = 'checking' ORDER BY versions.created_at, versions.number").all(),
  ).map((row) => ({ versionId: row.id, ownerId: row.owner_id }));
}

/** The source of a Version still `checking`, or undefined if it has been checked since (or never was). */
export function sourceToCheck(db: Database, versionId: string): string | undefined {
  return one(z.object({ source: z.string() }), db.prepare("SELECT source FROM versions WHERE id = ? AND state = 'checking'").get(versionId))?.source;
}

/**
 * Writes the Playtest's verdict: `ready` with its bundle and `about`, or `failed` with its problems.
 * One statement, so the state and what goes with it are written together. Only a Version still
 * `checking` is changed; returns whether one was.
 */
export function finishCheck(
  db: Database,
  versionId: string,
  verdict: { readonly ok: true; readonly bundle: string; readonly about: About } | { readonly ok: false; readonly problems: readonly Problem[] },
  checkedAt: number,
): boolean {
  const changed = verdict.ok
    ? db.prepare("UPDATE versions SET state = 'ready', bundle = ?, about = ?, checked_at = ? WHERE id = ? AND state = 'checking'").run(verdict.bundle, JSON.stringify(verdict.about), checkedAt, versionId)
    : db.prepare("UPDATE versions SET state = 'failed', problems = ?, checked_at = ? WHERE id = ? AND state = 'checking'").run(JSON.stringify(verdict.problems), checkedAt, versionId);
  return changed.changes === 1;
}

export function setDescription(db: Database, gameId: string, description: string): void {
  db.prepare("UPDATE games SET description = ? WHERE id = ?").run(description, gameId);
}

/**
 * Points a Game at one of its own `ready` Versions. Returns whether it did: not for any other
 * Version, and never while an admin's takedown stands.
 */
export function publish(db: Database, gameId: string, versionId: string): boolean {
  const changed = db
    .prepare(
      "UPDATE games SET published_version_id = ? WHERE id = ? AND taken_down_at IS NULL AND EXISTS (SELECT 1 FROM versions WHERE id = ? AND game_id = ? AND state = 'ready')",
    )
    .run(versionId, gameId, versionId, gameId);
  return changed.changes === 1;
}

export function unpublish(db: Database, gameId: string): void {
  db.prepare("UPDATE games SET published_version_id = NULL WHERE id = ?").run(gameId);
}

/** An admin takes a Game down: unpublished, and kept from being published again, in one statement. */
export function takeDown(db: Database, gameId: string, at: number): void {
  db.prepare("UPDATE games SET published_version_id = NULL, taken_down_at = ? WHERE id = ?").run(at, gameId);
}

/** An admin lifts a takedown: the Creator may publish the Game again (nothing is published by this). */
export function liftTakedown(db: Database, gameId: string): void {
  db.prepare("UPDATE games SET taken_down_at = NULL WHERE id = ?").run(gameId);
}

/** The Game a Version belongs to, by the Version's id. */
export function gameOfVersion(db: Database, versionId: string): Game | undefined {
  return one(
    gameRow,
    db.prepare(`SELECT ${GAME_COLUMNS} FROM games JOIN versions ON versions.game_id = games.id WHERE versions.id = ?`).get(versionId),
  );
}

/**
 * The Game a `ready` Version belongs to, by the Version's id, and the Version's `about`: only while
 * that Game is published (with this Version or another), so not while it is unpublished or taken
 * down. For counting a play (plays.ts): the play belongs to the Game, whichever of its Versions it was.
 */
export function publishedGameOfVersion(db: Database, versionId: string): { readonly gameId: string; readonly about: About } | undefined {
  const row = one(
    z.object({ game_id: z.string(), about: aboutJson }),
    db
      .prepare(
        "SELECT versions.game_id, versions.about FROM versions JOIN games ON games.id = versions.game_id WHERE versions.id = ? AND versions.state = 'ready' AND games.published_version_id IS NOT NULL",
      )
      .get(versionId),
  );
  return row === undefined ? undefined : { gameId: row.game_id, about: row.about };
}

/** One playable Version, by its id: what a Room needs to list it and load it, and who may. */
export interface Playable {
  readonly versionId: string;
  readonly about: About;
  readonly bundle: string;
  readonly ownerId: string;
  /** Whether its Game is published (with this Version or another). */
  readonly gamePublished: boolean;
  /** Its Creator's display name. */
  readonly creator: string;
}

const playableRow = z
  .object({ id: z.string(), about: aboutJson, bundle: z.string(), owner_id: z.string(), published_version_id: z.string().nullable(), display_name: z.string().nullable() })
  .transform(
    (row): Playable => ({ versionId: row.id, about: row.about, bundle: row.bundle, ownerId: row.owner_id, gamePublished: row.published_version_id !== null, creator: row.display_name ?? "" }),
  );

/** A `ready` Version, by its id, or undefined. */
export function playableVersion(db: Database, versionId: string): Playable | undefined {
  return one(
    playableRow,
    db
      .prepare(
        "SELECT versions.id, versions.about, versions.bundle, games.owner_id, games.published_version_id, accounts.display_name FROM versions JOIN games ON games.id = versions.game_id JOIN accounts ON accounts.id = games.owner_id WHERE versions.id = ? AND versions.state = 'ready'",
      )
      .get(versionId),
  );
}

/** The newest `most` published Games, as the Lobby lists them: the published Version's id and `about`, and its Creator's name. Newest first. */
export function publishedGames(db: Database, most: number): { readonly versionId: string; readonly about: About; readonly creator: string }[] {
  return all(
    z.object({ id: z.string(), about: aboutJson, display_name: z.string() }),
    db
      .prepare(
        "SELECT versions.id, versions.about, accounts.display_name FROM games JOIN versions ON versions.id = games.published_version_id JOIN accounts ON accounts.id = games.owner_id WHERE versions.state = 'ready' ORDER BY versions.created_at DESC, versions.id LIMIT ?",
      )
      .all(most),
  ).map((row) => ({ versionId: row.id, about: row.about, creator: row.display_name }));
}

/** A published Game as the Library shows it. Never its source, its bundle, or anything about its owner but their display name. */
export interface LibraryRow {
  readonly gameId: string;
  /** Its published Version: what /screen?play= takes. */
  readonly versionId: string;
  readonly about: About;
  readonly description: string;
  readonly creator: string;
  /** When the published Version was made. */
  readonly publishedAt: number;
  /** Its counted plays (plays.ts). */
  readonly plays: number;
}

const libraryRow = z
  .object({ game_id: z.string(), version_id: z.string(), about: aboutJson, description: z.string(), display_name: z.string(), published_at: z.number().int(), plays: z.number().int() })
  .transform(
    (row): LibraryRow => ({
      gameId: row.game_id,
      versionId: row.version_id,
      about: row.about,
      description: row.description,
      creator: row.display_name,
      publishedAt: row.published_at,
      plays: row.plays,
    }),
  );

/** Published Games only: a taken-down Game is unpublished, so it isn't here either. */
const LIBRARY_SELECT = `SELECT games.id AS game_id, versions.id AS version_id, versions.about, games.description, accounts.display_name,
  versions.created_at AS published_at, coalesce(plays.count, 0) AS plays
  FROM games JOIN versions ON versions.id = games.published_version_id JOIN accounts ON accounts.id = games.owner_id
  LEFT JOIN plays ON plays.subject = games.id
  WHERE versions.state = 'ready'`;

/** The newest `most` published Games, by when their published Version was made, newest first. */
export function libraryGames(db: Database, most: number): LibraryRow[] {
  return all(libraryRow, db.prepare(`${LIBRARY_SELECT} ORDER BY versions.created_at DESC, games.id LIMIT ?`).all(most));
}

/** One published Game by its Game id, or undefined: unpublished, taken down and never-existing alike. */
export function libraryGame(db: Database, gameId: string): LibraryRow | undefined {
  return one(libraryRow, db.prepare(`${LIBRARY_SELECT} AND games.id = ?`).get(gameId));
}

/** A Version's source, if the Version belongs to the Game; otherwise undefined. */
export function versionSource(db: Database, gameId: string, versionId: string): string | undefined {
  return one(z.object({ source: z.string() }), db.prepare("SELECT source FROM versions WHERE id = ? AND game_id = ?").get(versionId, gameId))?.source;
}
