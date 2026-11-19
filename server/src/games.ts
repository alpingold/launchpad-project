/**
 * Games and their Versions (BUILD-PLAN Step 14): a Creator's own Games under /api/my/, the list of
 * Games every Lobby shows, and each Game's code.
 *
 * Every /api/my/ route is for a signed-in account with a display name, and only ever about that
 * account's own Games: another account's Game answers exactly as a Game that doesn't exist, so
 * nobody learns which ids are real.
 *
 * What a Room plays: an Official game by its name, or an uploaded Game by its **Version's** id. The
 * list names a published Game by its published Version's id, so a Match keeps the code it started
 * with, even after a reload, even if the Creator publishes a newer Version meanwhile.
 *
 * Who may fetch a Version (its listing and its bundle): its Game's owner, always; anyone, while its
 * Game is published and the Version is `ready`. Refused and not found look the same from outside.
 */
import { randomBytes } from "node:crypto";
import { LOAD_MS, MAX_BUNDLE_BYTES, MAX_SOURCE_BYTES, RUN_MS, SEEDS, type PlaytestRunner } from "@boilergames/playtest/client";
import express, { Router, type ErrorRequestHandler, type Request, type Response } from "express";
import { z } from "zod";
import { Checks, MAX_WAITING } from "./checks.js";
import type { Account } from "./db/accounts.js";
import { transaction, type Database } from "./db/database.js";
import {
  countGames,
  countVersions,
  createGame,
  createVersion,
  gameById,
  gameOfVersion,
  gamesOwnedBy,
  playableVersion,
  publish,
  publishedGames,
  liftTakedown,
  setDescription,
  takeDown,
  unpublish,
  uploadTimesSince,
  versionsOf,
  type About,
  type Game,
  type Playable,
  type Version,
} from "./db/games.js";
import type { Clock } from "./rooms.js";
import { waitWords } from "./sign-in.js";

const HOUR_S = 60 * 60;
const DAY_S = 24 * HOUR_S;

/** Uploads (a new Game, or a new Version of one) one account may make in an hour, and in a day. */
export const UPLOADS_PER_HOUR = 10;
export const UPLOADS_PER_DAY = 50;
/** Games one account may have. */
export const GAMES_PER_ACCOUNT = 20;
/** Versions one Game may have. */
export const VERSIONS_PER_GAME = 50;
/** The most a description may be, in characters. */
export const DESCRIPTION_MAX = 300;
/**
 * The most an Upload's request may be. The source is sent as JSON text, whose escapes (a newline
 * is two characters, a quote two) make it a little larger than the file: a quarter more room than
 * the source's own limit. A source over that limit, but whose request fits, is refused by its size
 * below, with the same message.
 */
export const MAX_UPLOAD_BODY_BYTES = MAX_SOURCE_BYTES + 64 * 1024;
/**
 * The most published Games /api/games lists, newest first: the list can't grow without bound before
 * the Library (milestone 2b) gives Games pages of their own.
 */
export const MAX_LISTED_GAMES = 200;
/** What a Creator is told, on publishing and on the Game's page, while an admin's takedown stands. */
export const TAKEN_DOWN = "An admin took this Game down. Write to the site's owner if you think that was a mistake.";
/**
 * The limits a Game is held to, for the page that tells Creators how to write one (/make), through
 * /api/config. The Playtest's own numbers and this file's, never copies: the page can't quote a
 * limit the site doesn't enforce.
 */
export const GAME_LIMITS = {
  maxSourceBytes: MAX_SOURCE_BYTES,
  maxBundleBytes: MAX_BUNDLE_BYTES,
  loadMs: LOAD_MS,
  runMs: RUN_MS,
  seeds: SEEDS.length,
  uploadsPerHour: UPLOADS_PER_HOUR,
  uploadsPerDay: UPLOADS_PER_DAY,
} as const;

/** The routes that take a Game's source. */
export const UPLOAD_PATHS = ["/api/my/games", "/api/my/games/:id/versions"];

const TOO_LARGE = `A Game's code may be at most ${MAX_SOURCE_BYTES / 1024} KB.`;

/** One line of /api/games: what a Lobby needs before it loads a Game's code. */
export interface Listing {
  readonly id: string;
  readonly title: string;
  readonly players: { readonly min: number; readonly max: number };
  readonly look?: unknown;
  /** An uploaded Game's Creator, by display name. Official games have none. */
  readonly creator?: string;
  /** Present, and true, for a Game a Creator uploaded rather than one of the site's own. */
  readonly uploaded?: true;
}

/** The Official games, as games/dist holds them. */
export interface OfficialGames {
  /** As the Lobby lists them: games.json without the descriptions, which only the Library shows. */
  readonly listing: readonly Listing[];
  readonly bundles: ReadonlyMap<string, Buffer>;
  /** Each one's description, by id, for the Library. */
  readonly descriptions: ReadonlyMap<string, string>;
}

export interface GameRoutesOptions {
  readonly database: Database;
  readonly clock: Clock;
  /** How a Playtest is run. Null: there is none, and Uploads are refused. */
  readonly playtest: PlaytestRunner | null;
  readonly official: OfficialGames;
  /** The signed-in account behind a request (sign-in.ts). */
  readonly signedIn: (request: Request, response: Response) => Account | undefined;
}

export interface GameRoutes {
  readonly router: Router;
  /** Stops starting Playtests (checks.ts). */
  readonly stop: () => void;
}

/** A Version's listing: its `about`, with its Creator's name, marked as uploaded. */
function listingOf(playable: { readonly versionId: string; readonly about: About; readonly creator: string }): Listing {
  const { title, players, look } = playable.about;
  return { id: playable.versionId, title, players, ...(look === undefined ? {} : { look }), creator: playable.creator, uploaded: true };
}

/** A Game as its owner sees it: every Version, newest first. */
function detail(game: Game, versions: readonly Version[]): object {
  return { id: game.id, description: game.description, publishedVersionId: game.publishedVersionId, createdAt: game.createdAt, takenDownAt: game.takenDownAt, versions };
}

const newId = () => randomBytes(16).toString("base64url");

const sourceBody = z.object({ source: z.string() });

/** The upload routes' own body parser, larger than the site's, and its message when even that is too small. */
export function uploadBodies(): [ReturnType<typeof express.json>, ErrorRequestHandler] {
  const tooLarge: ErrorRequestHandler = (error: { type?: string }, _request, response, next) => {
    if (error.type === "entity.too.large") return void response.status(413).json({ error: TOO_LARGE });
    next(error);
  };
  return [express.json({ limit: MAX_UPLOAD_BODY_BYTES }), tooLarge];
}

export function gameRoutes(options: GameRoutesOptions): GameRoutes {
  const { database, clock, official } = options;
  const seconds = () => Math.floor(clock.now() / 1000);
  const checks = options.playtest === null ? null : new Checks(database, options.playtest, clock);
  const router = Router();

  // What a Creator sees of their own Games is theirs alone: no cache on the way may keep it.
  router.use("/api/my", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use("/api/admin", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  /** The signed-in account, if it may make Games; otherwise answers and returns undefined. */
  function creator(request: Request, response: Response): Account | undefined {
    const account = options.signedIn(request, response);
    if (account === undefined) return void response.status(401).json({ error: "Sign in first." });
    if (account.displayName === null) return void response.status(403).json({ error: "Pick a display name first." });
    return account;
  }

  /** The account's own Game by its id; otherwise answers "no such Game" (another's Game too) and returns undefined. */
  function ownGame(account: Account, request: Request, response: Response): Game | undefined {
    const game = gameById(database, String(request.params["id"]));
    if (game === undefined || game.ownerId !== account.id) return void response.status(404).json({ error: "There's no such Game of yours." });
    return game;
  }

  /** The source in an Upload, if it may be checked now; otherwise answers why not and returns undefined. */
  function uploadable(account: Account, request: Request, response: Response): string | undefined {
    const body = sourceBody.safeParse(request.body);
    if (!body.success || body.data.source.trim() === "") return void response.status(400).json({ error: "Send the Game's code." });
    if (Buffer.byteLength(body.data.source, "utf8") > MAX_SOURCE_BYTES) return void response.status(413).json({ error: TOO_LARGE });
    if (checks === null) return void response.status(503).json({ error: "Uploads are switched off on this server for now." });
    if (checks.waiting >= MAX_WAITING) return void response.status(503).json({ error: "The site is busy checking other Games. Try again in a few minutes." });
    const now = seconds();
    for (const [most, window, when] of [
      [UPLOADS_PER_HOUR, HOUR_S, "in an hour"],
      [UPLOADS_PER_DAY, DAY_S, "in a day"],
    ] as const) {
      const times = uploadTimesSince(database, account.id, now - window);
      if (times.length >= most) {
        // The oldest of the last `most` must leave the window first.
        const waitS = (times[times.length - most] ?? now) + window - now;
        response.setHeader("Retry-After", String(waitS));
        return void response.status(429).json({ error: `You can upload ${most} times ${when}. Try again in ${waitWords(waitS * 1000)}.` });
      }
    }
    return body.data.source;
  }

  router.post("/api/my/games", (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    const source = uploadable(account, request, response);
    if (source === undefined) return;
    if (countGames(database, account.id) >= GAMES_PER_ACCOUNT) {
      return void response.status(409).json({ error: `You have ${GAMES_PER_ACCOUNT} Games, the most one account may have. Upload a new Version of one of them instead.` });
    }
    const game: Game = { id: newId(), ownerId: account.id, description: "", publishedVersionId: null, createdAt: seconds(), takenDownAt: null };
    const version = transaction(database, () => {
      createGame(database, game);
      return createVersion(database, { id: newId(), gameId: game.id, source, createdAt: game.createdAt });
    });
    checks?.add(version.id, account.id);
    response.status(201).json({ game: detail(game, [version]) });
  });

  router.post("/api/my/games/:id/versions", (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    const game = ownGame(account, request, response);
    if (game === undefined) return;
    const source = uploadable(account, request, response);
    if (source === undefined) return;
    if (countVersions(database, game.id) >= VERSIONS_PER_GAME) {
      return void response.status(409).json({ error: `This Game has ${VERSIONS_PER_GAME} Versions, the most one Game may have. Start a new Game for more.` });
    }
    const version = transaction(database, () => createVersion(database, { id: newId(), gameId: game.id, source, createdAt: seconds() }));
    checks?.add(version.id, account.id);
    response.status(201).json({ version });
  });

  router.get("/api/my/games", (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    const games = gamesOwnedBy(database, account.id).map((game) => {
      const versions = versionsOf(database, game.id);
      const shown = versions.find((version) => version.id === game.publishedVersionId) ?? versions.find((version) => version.state === "ready");
      const latest = versions[0];
      return {
        id: game.id,
        // The published Version's title, or the newest one that has a title, or none yet.
        title: shown?.about?.title ?? null,
        published: game.publishedVersionId !== null,
        latest: latest === undefined ? null : { number: latest.number, state: latest.state },
      };
    });
    response.json({ games });
  });

  router.get("/api/my/games/:id", (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    const game = ownGame(account, request, response);
    if (game === undefined) return;
    response.json({ game: detail(game, versionsOf(database, game.id)) });
  });

  router.put("/api/my/games/:id", (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    const game = ownGame(account, request, response);
    if (game === undefined) return;
    const body = z.object({ description: z.string() }).safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: "Send a description." });
    const description = body.data.description.trim();
    if ([...description].length > DESCRIPTION_MAX) return void response.status(400).json({ error: `A description may be at most ${DESCRIPTION_MAX} characters.` });
    setDescription(database, game.id, description);
    response.json({ game: detail({ ...game, description }, versionsOf(database, game.id)) });
  });

  router.post("/api/my/games/:id/publish", (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    const game = ownGame(account, request, response);
    if (game === undefined) return;
    const body = z.object({ versionId: z.string() }).safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: "Say which Version to publish." });
    if (game.takenDownAt !== null) return void response.status(409).json({ error: TAKEN_DOWN });
    if (!publish(database, game.id, body.data.versionId)) {
      return void response.status(409).json({ error: "Only a Version of this Game that passed its check can be published." });
    }
    response.json({ game: detail({ ...game, publishedVersionId: body.data.versionId }, versionsOf(database, game.id)) });
  });

  router.post("/api/my/games/:id/unpublish", (request, response) => {
    const account = creator(request, response);
    if (account === undefined) return;
    const game = ownGame(account, request, response);
    if (game === undefined) return;
    unpublish(database, game.id);
    response.json({ game: detail({ ...game, publishedVersionId: null }, versionsOf(database, game.id)) });
  });

  // An admin takes any Game down, by its Game id or by the id the list of Games shows (its published
  // Version's), and the takedown sticks: the Creator can't publish it again until an admin lifts it.
  // The Creator can still upload Versions and play them privately. Games are public without review,
  // so this exists before the first one is published. There is no page for it until milestone 4:
  // README.md says how.
  /** The Game an admin names; otherwise answers (a non-admin: as if there were no such route) and returns undefined. */
  function adminsGame(request: Request, response: Response): { readonly admin: Account; readonly game: Game } | undefined {
    const account = options.signedIn(request, response);
    // Not an admin: as if there were no such route, so nobody learns which accounts are admins.
    if (account?.admin !== true) return void response.status(404).type("text/plain").send("Not found");
    const id = String(request.params["id"]);
    const game = gameById(database, id) ?? gameOfVersion(database, id);
    if (game === undefined) return void response.status(404).json({ error: "There's no such Game." });
    return { admin: account, game };
  }

  router.post("/api/admin/games/:id/take-down", (request, response) => {
    const found = adminsGame(request, response);
    if (found === undefined) return;
    takeDown(database, found.game.id, seconds());
    console.log(`Admin ${found.admin.id} took down the Game ${found.game.id}`);
    response.json({ takenDown: found.game.id });
  });

  router.post("/api/admin/games/:id/lift-takedown", (request, response) => {
    const found = adminsGame(request, response);
    if (found === undefined) return;
    liftTakedown(database, found.game.id);
    console.log(`Admin ${found.admin.id} lifted the takedown of the Game ${found.game.id}`);
    response.json({ liftedTakedown: found.game.id });
  });

  // The Lobby's list: the Official games, then every published Game, newest first. It changes when a
  // Game is published or taken down, so a browser asks again every time.
  router.get("/api/games", (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.json([...official.listing, ...publishedGames(database, MAX_LISTED_GAMES).map(listingOf)]);
  });

  /**
   * A Version the request may fetch: its owner's, always; anyone's while its Game is published.
   * Otherwise undefined, whether it doesn't exist, isn't ready or isn't theirs.
   */
  function fetchable(request: Request, response: Response): Playable | undefined {
    const playable = playableVersion(database, String(request.params["id"]));
    if (playable === undefined) return undefined;
    if (playable.gamePublished) return playable;
    return options.signedIn(request, response)?.id === playable.ownerId ? playable : undefined;
  }

  /**
   * How long a browser may keep what it fetched. Never long: a Game's code can be taken down, and
   * from then on must be refused. A published one is kept but asked about each time (its bytes never
   * change, so the answer is a short "not modified"); one only its owner may fetch is never kept.
   * Neither is ever kept by a cache shared between people.
   */
  const cacheFor = (playable: Playable) => (playable.gamePublished ? "private, no-cache" : "private, no-store");

  const notFound = (response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(404).json({ error: "There's no such Game." });
  };

  // One Game's listing: for a Screen that plays a Version the list doesn't show (the Creator's own
  // unpublished one), or no longer shows (after a reload, when a newer one has been published).
  router.get("/api/games/:id", (request, response) => {
    const officialOne = official.listing.find((listing) => listing.id === request.params["id"]);
    if (officialOne !== undefined) return void response.json(officialOne);
    const playable = fetchable(request, response);
    if (playable === undefined) return notFound(response);
    response.setHeader("Cache-Control", cacheFor(playable));
    response.json(listingOf(playable));
  });

  // A Game's code. Served as plain text: the site never runs a Game's code itself (only the Game
  // frame does, on the game domain), and with nosniff a browser won't run text as a script, so a
  // stranger's code can't be made to run as the site's own.
  router.get("/api/games/:id/bundle.js", (request, response) => {
    const officialOne = official.bundles.get(String(request.params["id"]));
    if (officialOne !== undefined) {
      response.setHeader("Cache-Control", "no-cache");
      return void response.type("text/plain").send(officialOne);
    }
    const playable = fetchable(request, response);
    if (playable === undefined) return notFound(response);
    response.setHeader("Cache-Control", cacheFor(playable));
    response.type("text/plain").send(playable.bundle);
  });

  return { router, stop: () => checks?.stop() };
}

