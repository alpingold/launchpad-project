// Games and their Versions, through the whole server over real HTTP, with a database in memory and
// a fake Playtest behind the same interface the real one has (playtest/src/client.ts): each test
// says when a Playtest finishes and what it finds. One test runs the real Playtest, in a child process.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childProcessRunner, type PlaytestRunner, type RunResult } from "@boilergames/playtest/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { MAX_CHECKS_AT_ONCE, MAX_WAITING } from "./checks.js";
import { DESCRIPTION_MAX, GAMES_PER_ACCOUNT, MAX_LISTED_GAMES, MAX_UPLOAD_BODY_BYTES, TAKEN_DOWN, UPLOADS_PER_DAY, UPLOADS_PER_HOUR, VERSIONS_PER_GAME } from "./games.js";
import { createServer, IN_MEMORY, openDatabase, RecordedMail, type Database, type RunningServer } from "./index.js";
import type { Clock } from "./rooms.js";

const SITE = "https://boilergames.test";
const HOUR = 60 * 60 * 1000;

/** The time, moved by the tests. Its timers never fire: nothing here waits on one. */
class FakeClock implements Clock {
  time = Date.UTC(2026, 10, 18);
  now = () => this.time;
  setTimeout = () => () => undefined;
}

/** A Playtest that finishes when a test says so. */
class FakePlaytest implements PlaytestRunner {
  readonly runs: { readonly source: string; readonly finish: (result: RunResult) => void }[] = [];
  /** How many are running now, and the most at once. */
  running = 0;
  most = 0;
  /** If set, every Playtest finishes at once with this, rather than when a test says. */
  answer: RunResult | undefined;
  run(source: string): Promise<RunResult> {
    if (this.answer !== undefined) return Promise.resolve(this.answer);
    this.running += 1;
    this.most = Math.max(this.most, this.running);
    return new Promise((resolve) => {
      this.runs.push({
        source,
        finish: (result) => {
          this.running -= 1;
          resolve(result);
        },
      });
    });
  }
  /** Finishes the run of `source` (the first still running) with `result`. */
  finish(source: string, result: RunResult): void {
    const at = this.runs.findIndex((run) => run.source === source);
    const [run] = at < 0 ? [] : this.runs.splice(at, 1);
    if (run === undefined) throw new Error(`no Playtest of ${source} is running`);
    run.finish(result);
  }
}

const READY = (title: string): RunResult => ({ ok: true, bundle: `var BoilerGamesGame = ${JSON.stringify(title)};`, about: { title, players: { min: 1, max: 4 } }, sdkVersion: "v1" });
const FAILED: RunResult = { ok: false, problems: [{ stage: "types", message: "Type 'string' is not assignable to type 'number'.", line: 3 }] };

let root: string;
let clock: FakeClock;
let mail: RecordedMail;
let db: Database;
let playtest: FakePlaytest;
let server: RunningServer;
let base: string;
let logged: string[];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "games-"));
  await mkdir(join(root, "client"));
  await mkdir(join(root, "games"));
  await writeFile(join(root, "client/index.html"), "<!doctype html><title>BoilerGames</title>");
  await writeFile(join(root, "games/games.json"), JSON.stringify([{ id: "demo", title: "Demo", players: { min: 1, max: 8 } }]));
  await writeFile(join(root, "games/demo.js"), "var BoilerGamesGame = {};");
});
afterAll(async () => {
  await rm(root, { recursive: true });
});

async function startServer(runner: PlaytestRunner | null): Promise<void> {
  server = createServer({
    clientDist: join(root, "client"),
    gamesDist: join(root, "games"),
    siteOrigin: SITE,
    frameUrl: "https://play.boilergames.test/v1/",
    clock,
    mail,
    database: db,
    playtest: runner,
    addressOf: () => "visitor",
  });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  clock = new FakeClock();
  mail = new RecordedMail();
  db = openDatabase({ file: IN_MEMORY, log: () => undefined });
  playtest = new FakePlaytest();
  logged = [];
  for (const method of ["log", "warn", "error", "info"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  await startServer(playtest);
});
afterEach(async () => {
  await server.close();
  db.close();
  vi.restoreAllMocks();
});

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
  readonly headers: Headers;
}

/** A request as one of the site's pages makes it. */
async function call(method: string, path: string, options: { body?: unknown; cookie?: string; raw?: string } = {}): Promise<Reply> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(method === "GET" ? {} : { origin: SITE, "content-type": "application/json" }), ...(options.cookie === undefined ? {} : { cookie: options.cookie }) },
    ...(options.raw !== undefined ? { body: options.raw } : options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON: a bundle, or a page.
  }
  return { status: response.status, body, text, headers: response.headers };
}

/**
 * The status of a request a browser makes to check that what it kept is still good. Not with fetch,
 * which adds "Cache-Control: no-cache" to any request that names its own If-None-Match, as the
 * Fetch standard says, and so always gets the whole answer.
 */
function revalidate(path: string, etag: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(`${base}${path}`, { headers: { "if-none-match": etag } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    }).on("error", reject);
  });
}

/** Signs in through the emailed link and, unless `name` is null, picks a display name. Returns the session cookie. */
async function signIn(email: string, name: string | null = email.split("@")[0] ?? "x"): Promise<string> {
  expect((await call("POST", "/api/sign-in", { body: { email } })).status).toBe(200);
  const token = new URL(/https:\S+/.exec(mail.sent.at(-1)?.text ?? "")?.[0] ?? "").hash.slice(1);
  const response = await fetch(`${base}/api/sign-in/confirm`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token }) });
  const cookie = response.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  if (name !== null) expect((await call("POST", "/api/me/display-name", { body: { displayName: name }, cookie })).status).toBe(200);
  return cookie;
}

interface VersionSeen {
  id: string;
  number: number;
  state: string;
  problems: unknown;
  about: { title: string } | null;
}
interface GameSeen {
  id: string;
  description: string;
  publishedVersionId: string | null;
  takenDownAt: number | null;
  versions: VersionSeen[];
}

/** Uploads a new Game; returns it, with its Version 1. */
async function upload(cookie: string, source: string): Promise<GameSeen> {
  const reply = await call("POST", "/api/my/games", { body: { source }, cookie });
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body["game"] as GameSeen;
}

async function uploadVersion(cookie: string, gameId: string, source: string): Promise<VersionSeen> {
  const reply = await call("POST", `/api/my/games/${gameId}/versions`, { body: { source }, cookie });
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body["version"] as VersionSeen;
}

async function gameSeen(cookie: string, gameId: string): Promise<GameSeen> {
  return (await call("GET", `/api/my/games/${gameId}`, { cookie })).body["game"] as GameSeen;
}

/** Waits until the fake Playtest has been asked to check `source`. */
const asked = (source: string) => vi.waitFor(() => expect(playtest.runs.map((run) => run.source)).toContain(source));

/** Waits until the Game's newest Version has settled, and returns the Game. */
async function settled(cookie: string, gameId: string): Promise<GameSeen> {
  let game: GameSeen | undefined;
  await vi.waitFor(async () => {
    game = await gameSeen(cookie, gameId);
    expect(game.versions[0]?.state).not.toBe("checking");
  });
  return game as GameSeen;
}

/** Uploads a Game and lets its Version 1 pass its check. */
async function readyGame(cookie: string, source: string, title = source): Promise<GameSeen> {
  const game = await upload(cookie, source);
  await asked(source);
  playtest.finish(source, READY(title));
  return settled(cookie, game.id);
}

describe("an Upload", () => {
  test("goes checking, then ready with its about and bundle; the Creator's list shows it", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await upload(ada, "source one");
    expect(game.versions).toEqual([expect.objectContaining({ number: 1, state: "checking", problems: null, about: null })]);
    expect(game.description).toBe("");
    await asked("source one");
    playtest.finish("source one", READY("Three Taps"));
    const checked = await settled(ada, game.id);
    expect(checked.versions[0]).toEqual(expect.objectContaining({ state: "ready", about: { title: "Three Taps", players: { min: 1, max: 4 } }, problems: null }));
    expect((await call("GET", "/api/my/games", { cookie: ada })).body["games"]).toEqual([{ id: game.id, title: "Three Taps", published: false, latest: { number: 1, state: "ready" } }]);
    // Its code is its owner's to fetch.
    const versionId = checked.versions[0]?.id ?? "";
    expect((await call("GET", `/api/games/${versionId}/bundle.js`, { cookie: ada })).text).toBe('var BoilerGamesGame = "Three Taps";');
  });

  test("goes checking, then failed with every problem, each with its stage and line", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await upload(ada, "broken");
    await asked("broken");
    playtest.finish("broken", FAILED);
    const checked = await settled(ada, game.id);
    expect(checked.versions[0]).toEqual(expect.objectContaining({ state: "failed", problems: [{ stage: "types", message: "Type 'string' is not assignable to type 'number'.", line: 3 }], about: null }));
    expect((await call("GET", "/api/my/games", { cookie: ada })).body["games"]).toEqual([{ id: game.id, title: null, published: false, latest: { number: 1, state: "failed" } }]);
  });

  test("a new Version is numbered after the last, and the Game lists them newest first", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await readyGame(ada, "v1");
    const second = await uploadVersion(ada, game.id, "v2");
    expect(second).toEqual(expect.objectContaining({ number: 2, state: "checking" }));
    expect((await gameSeen(ada, game.id)).versions.map((version) => [version.number, version.state])).toEqual([
      [2, "checking"],
      [1, "ready"],
    ]);
  });

  test("a restart while it is checking loses nothing: the next start checks it again and finishes it", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await upload(ada, "slow");
    await asked("slow");
    // The server stops (a deploy) with the Playtest still running; its late answer is written nowhere.
    await server.close();
    playtest.finish("slow", FAILED);
    playtest = new FakePlaytest();
    await startServer(playtest);
    await asked("slow");
    playtest.finish("slow", READY("Slow"));
    expect((await settled(ada, game.id)).versions[0]).toEqual(expect.objectContaining({ state: "ready", about: expect.objectContaining({ title: "Slow" }) }));
  });

  test(`at most ${MAX_CHECKS_AT_ONCE} Playtests at once, and one per account, so one busy Creator doesn't hold up the rest`, async () => {
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    const cy = await signIn("cy@purdue.edu");
    const adas = await upload(ada, "ada 1");
    await uploadVersion(ada, adas.id, "ada 2");
    await upload(bo, "bo 1");
    await upload(cy, "cy 1");
    await asked("bo 1");
    // Ada's second waits for her first, though it came before Bo's: Bo's goes ahead of it.
    expect(playtest.runs.map((run) => run.source).sort()).toEqual(["ada 1", "bo 1"]);
    // Ada's first done: her second is first in line now. Cy's waits for a place.
    playtest.finish("ada 1", READY("A"));
    await asked("ada 2");
    expect(playtest.runs.map((run) => run.source).sort()).toEqual(["ada 2", "bo 1"]);
    playtest.finish("bo 1", READY("B"));
    await asked("cy 1");
    expect(playtest.most).toBe(MAX_CHECKS_AT_ONCE);
  });

  test("a check that itself failed is written as failed, with the plain message, and the Creator can upload again", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await upload(ada, "unlucky");
    await asked("unlucky");
    playtest.finish("unlucky", { ok: false, checkFailed: true, problems: [{ stage: "play", message: "The check itself failed, not your Game. Try again in a minute." }] });
    expect((await settled(ada, game.id)).versions[0]?.problems).toEqual([{ stage: "play", message: "The check itself failed, not your Game. Try again in a minute." }]);
  });
});

describe("only the owner", () => {
  test("nobody else can see, change, publish, unpublish or add a Version to a Game: it answers as a Game that doesn't exist", async () => {
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    const game = await readyGame(ada, "ada's");
    const versionId = game.versions[0]?.id ?? "";
    const attempts: [string, string, unknown?][] = [
      ["GET", `/api/my/games/${game.id}`],
      ["PUT", `/api/my/games/${game.id}`, { description: "mine now" }],
      ["POST", `/api/my/games/${game.id}/versions`, { source: "bo's code" }],
      ["POST", `/api/my/games/${game.id}/publish`, { versionId }],
      ["POST", `/api/my/games/${game.id}/unpublish`, {}],
    ];
    for (const [method, path, body] of attempts) {
      const theirs = await call(method, path, { body, cookie: bo });
      const nothing = await call(method, path.replace(game.id, "no-such-game"), { body, cookie: bo });
      expect(theirs.status, `${method} ${path}`).toBe(404);
      expect(theirs.text, `${method} ${path}`).toBe(nothing.text);
    }
    expect((await call("GET", "/api/my/games", { cookie: bo })).body["games"]).toEqual([]);
    const unchanged = await gameSeen(ada, game.id);
    expect(unchanged.description).toBe("");
    expect(unchanged.publishedVersionId).toBeNull();
    expect(unchanged.versions).toHaveLength(1);
  });

  test("signed out: sign in first; signed in without a display name: pick one first", async () => {
    const nameless = await signIn("nn@purdue.edu", null);
    for (const [cookie, status, error] of [
      [undefined, 401, "Sign in first."],
      [nameless, 403, "Pick a display name first."],
    ] as const) {
      expect(await call("GET", "/api/my/games", { cookie })).toEqual(expect.objectContaining({ status, body: { error } }));
      expect(await call("POST", "/api/my/games", { body: { source: "x" }, cookie })).toEqual(expect.objectContaining({ status, body: { error } }));
    }
    expect(playtest.runs).toEqual([]);
  });
});

describe("publishing", () => {
  test("a ready Version can be published; a failed one, a checking one, or another Game's can't", async () => {
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    const game = await readyGame(ada, "good");
    const failed = await uploadVersion(ada, game.id, "bad");
    await asked("bad");
    playtest.finish("bad", FAILED);
    await settled(ada, game.id);
    const checking = await uploadVersion(ada, game.id, "still checking");
    const bos = await readyGame(bo, "bo's");
    for (const versionId of [failed.id, checking.id, bos.versions[0]?.id, "no-such-version"]) {
      const reply = await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId }, cookie: ada });
      expect(reply.status).toBe(409);
      expect(reply.body["error"]).toBe("Only a Version of this Game that passed its check can be published.");
    }
    expect((await gameSeen(ada, game.id)).publishedVersionId).toBeNull();
    const ready = game.versions[0]?.id ?? "";
    expect((await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId: ready }, cookie: ada })).status).toBe(200);
    expect((await gameSeen(ada, game.id)).publishedVersionId).toBe(ready);
    expect((await call("GET", "/api/my/games", { cookie: ada })).body["games"]).toEqual([expect.objectContaining({ published: true })]);
  });

  test("an unpublished Game's code is served to its owner only, never kept; published, to anyone, kept but asked about each time; unpublished again, to its owner only", async () => {
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    const game = await readyGame(ada, "the code", "Hidden");
    const versionId = game.versions[0]?.id ?? "";
    const bundle = `/api/games/${versionId}/bundle.js`;
    const listing = `/api/games/${versionId}`;
    const nothing = await call("GET", "/api/games/no-such-version/bundle.js");

    const owners = await call("GET", bundle, { cookie: ada });
    expect(owners.status).toBe(200);
    expect(owners.headers.get("cache-control")).toBe("private, no-store");
    expect(owners.headers.get("content-type")).toContain("text/plain");
    for (const cookie of [bo, undefined]) {
      const refused = await call("GET", bundle, { cookie });
      expect(refused.status).toBe(404);
      expect(refused.text).toBe(nothing.text);
      expect(refused.headers.get("cache-control")).toBe("no-store");
      expect((await call("GET", listing, { cookie })).status).toBe(404);
    }
    expect((await call("GET", listing, { cookie: ada })).body).toEqual({ id: versionId, title: "Hidden", players: { min: 1, max: 4 }, creator: "ada", uploaded: true });
    expect(JSON.parse((await call("GET", "/api/games")).text)).toEqual([{ id: "demo", title: "Demo", players: { min: 1, max: 8 } }]);

    await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId }, cookie: ada });
    const anyones = await call("GET", bundle);
    expect(anyones.status).toBe(200);
    expect(anyones.text).toBe('var BoilerGamesGame = "Hidden";');
    expect(anyones.headers.get("cache-control")).toBe("private, no-cache");
    // Asked again with what the browser kept: "not modified", nothing sent.
    const etag = anyones.headers.get("etag") ?? "";
    expect(await revalidate(bundle, etag)).toBe(304);
    // The list: the Official games, then the published Game by its Version's id, with its Creator's name.
    expect(JSON.parse((await call("GET", "/api/games")).text)).toEqual([
      { id: "demo", title: "Demo", players: { min: 1, max: 8 } },
      { id: versionId, title: "Hidden", players: { min: 1, max: 4 }, creator: "ada", uploaded: true },
    ]);

    await call("POST", `/api/my/games/${game.id}/unpublish`, { body: {}, cookie: ada });
    expect((await call("GET", bundle)).status).toBe(404);
    expect(await revalidate(bundle, etag)).toBe(404);
    expect((await call("GET", bundle, { cookie: ada })).status).toBe(200);
    expect(JSON.parse((await call("GET", "/api/games")).text)).toHaveLength(1);
  });

  test("a Match keeps its code: after a newer Version is published, the one it started on is still served to anyone", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await readyGame(ada, "first", "First");
    const first = game.versions[0]?.id ?? "";
    await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId: first }, cookie: ada });
    const third = await uploadVersion(ada, game.id, "newer");
    await asked("newer");
    playtest.finish("newer", READY("Newer"));
    await settled(ada, game.id);
    await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId: third.id }, cookie: ada });
    expect((await call("GET", `/api/games/${first}/bundle.js`)).text).toBe('var BoilerGamesGame = "First";');
    expect((await call("GET", `/api/games/${first}`)).body["title"]).toBe("First");
    expect(JSON.parse((await call("GET", "/api/games")).text).map((listing: { id: string }) => listing.id)).toEqual(["demo", third.id]);
  });

  test("an admin takes a Game down, by the id the list shows, and it sticks: the Creator can't publish it again until an admin lifts it", async () => {
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    const game = await readyGame(ada, "rude");
    const versionId = game.versions[0]?.id ?? "";
    await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId }, cookie: ada });
    // Set by hand in the database, as README.md says.
    db.prepare("UPDATE accounts SET admin = 1 WHERE email = ?").run("bo@purdue.edu");
    expect((await call("POST", `/api/admin/games/${versionId}/take-down`, { body: {}, cookie: bo })).body).toEqual({ takenDown: game.id });
    const takenDown = await gameSeen(ada, game.id);
    expect(takenDown.publishedVersionId).toBeNull();
    expect(takenDown.takenDownAt).toBe(Math.floor(clock.now() / 1000));
    expect((await call("GET", `/api/games/${versionId}/bundle.js`)).status).toBe(404);
    expect(JSON.parse((await call("GET", "/api/games")).text)).toHaveLength(1);

    // Publishing again is refused, plainly; uploading a Version and playing it privately are not.
    const refused = await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId }, cookie: ada });
    expect(refused).toEqual(expect.objectContaining({ status: 409, body: { error: TAKEN_DOWN } }));
    expect((await gameSeen(ada, game.id)).publishedVersionId).toBeNull();
    const second = await uploadVersion(ada, game.id, "rude, again");
    await asked("rude, again");
    playtest.finish("rude, again", READY("Again"));
    await settled(ada, game.id);
    expect((await call("GET", `/api/games/${second.id}/bundle.js`, { cookie: ada })).status).toBe(200);
    expect((await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId: second.id }, cookie: ada })).status).toBe(409);

    // Lifted: nothing is published by that, but the Creator may publish again.
    expect((await call("POST", `/api/admin/games/${game.id}/lift-takedown`, { body: {}, cookie: bo })).body).toEqual({ liftedTakedown: game.id });
    expect(await gameSeen(ada, game.id)).toEqual(expect.objectContaining({ takenDownAt: null, publishedVersionId: null }));
    expect((await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId: second.id }, cookie: ada })).status).toBe(200);
    expect((await call("GET", `/api/games/${second.id}/bundle.js`)).status).toBe(200);
    expect(logged).toEqual(expect.arrayContaining([expect.stringMatching(/^Admin \S+ took down the Game /), expect.stringMatching(/^Admin \S+ lifted the takedown of the Game /)]));
  });

  test("a Creator's own unpublish is not a takedown: they may publish again at once", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await readyGame(ada, "mine");
    const versionId = game.versions[0]?.id ?? "";
    await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId }, cookie: ada });
    await call("POST", `/api/my/games/${game.id}/unpublish`, { body: {}, cookie: ada });
    expect((await gameSeen(ada, game.id)).takenDownAt).toBeNull();
    expect((await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId }, cookie: ada })).status).toBe(200);
  });

  test("anyone but an admin gets the same \"not found\" from both admin routes as from a route that doesn't exist, and nothing changes", async () => {
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    const game = await readyGame(ada, "rude");
    const versionId = game.versions[0]?.id ?? "";
    await call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId }, cookie: ada });
    const nowhere = await call("POST", "/api/admin/no-such-route", { body: {}, cookie: bo });
    for (const route of ["take-down", "lift-takedown"]) {
      for (const cookie of [bo, ada, undefined]) {
        for (const id of [versionId, game.id]) {
          const refused = await call("POST", `/api/admin/games/${id}/${route}`, { body: {}, cookie });
          expect(refused.status, `${route} ${id}`).toBe(404);
          expect(refused.text, `${route} ${id}`).toBe(nowhere.text);
        }
      }
    }
    expect(await gameSeen(ada, game.id)).toEqual(expect.objectContaining({ takenDownAt: null, publishedVersionId: versionId }));
  });
});

describe("the list of Games", () => {
  test(`lists at most ${MAX_LISTED_GAMES} published Games, the newest`, async () => {
    // Made in the database directly: as many Uploads through the routes would meet the Upload limits first.
    const owner = await signIn("ada@purdue.edu");
    const ownerId = String(db.prepare("SELECT id FROM accounts WHERE email = ?").get("ada@purdue.edu")?.["id"]);
    const about = JSON.stringify({ title: "G", players: { min: 1, max: 2 } });
    for (let n = 0; n < MAX_LISTED_GAMES + 5; n++) {
      db.prepare("INSERT INTO games (id, owner_id, created_at) VALUES (?, ?, ?)").run(`g${n}`, ownerId, n);
      db.prepare("INSERT INTO versions (id, game_id, number, made_by, source, state, bundle, about, sdk_version, created_at, checked_at) VALUES (?, ?, 1, 'upload', 'x', 'ready', 'x', ?, 'v1', ?, ?)").run(`v${n}`, `g${n}`, about, n, n);
      db.prepare("UPDATE games SET published_version_id = ? WHERE id = ?").run(`v${n}`, `g${n}`);
    }
    const listed = (JSON.parse((await call("GET", "/api/games", { cookie: owner })).text) as { id: string }[]).map((listing) => listing.id);
    expect(listed).toHaveLength(1 + MAX_LISTED_GAMES);
    expect(listed.slice(0, 3)).toEqual(["demo", `v${MAX_LISTED_GAMES + 4}`, `v${MAX_LISTED_GAMES + 3}`]);
    expect(listed.at(-1)).toBe("v5");
  });
});

describe("the limits, each with a message that says what to do", () => {
  test(`${UPLOADS_PER_HOUR} Uploads an hour and ${UPLOADS_PER_DAY} a day for one account, counted from the database, so a restart forgets none`, async () => {
    playtest.answer = FAILED;
    const ada = await signIn("ada@purdue.edu");
    const game = await upload(ada, "u0");
    for (let i = 1; i < UPLOADS_PER_HOUR; i++) await uploadVersion(ada, game.id, `u${i}`);
    const refused = await call("POST", `/api/my/games/${game.id}/versions`, { body: { source: "one more" }, cookie: ada });
    expect(refused.status).toBe(429);
    expect(refused.body["error"]).toBe(`You can upload ${UPLOADS_PER_HOUR} times in an hour. Try again in 60 minutes.`);
    // Still refused after a restart.
    await server.close();
    await startServer(playtest);
    expect((await call("POST", `/api/my/games/${game.id}/versions`, { body: { source: "one more" }, cookie: ada })).status).toBe(429);
    // A day's worth, an hour at a time.
    let made = UPLOADS_PER_HOUR;
    while (made < UPLOADS_PER_DAY) {
      clock.time += HOUR;
      for (let i = 0; i < UPLOADS_PER_HOUR && made < UPLOADS_PER_DAY; i++, made++) await uploadVersion(ada, game.id, `d${made}`);
    }
    clock.time += HOUR;
    const daily = await call("POST", `/api/my/games/${game.id}/versions`, { body: { source: "one more" }, cookie: ada });
    expect(daily.status).toBe(429);
    expect(daily.body["error"]).toMatch(new RegExp(`^You can upload ${UPLOADS_PER_DAY} times in a day. Try again in \\d+ hours\\.$`));
  });

  test(`${GAMES_PER_ACCOUNT} Games for one account`, async () => {
    playtest.answer = FAILED;
    const ada = await signIn("ada@purdue.edu");
    for (let i = 0; i < GAMES_PER_ACCOUNT; i++) {
      if (i > 0 && i % UPLOADS_PER_HOUR === 0) clock.time += HOUR;
      await upload(ada, `game ${i}`);
    }
    clock.time += HOUR;
    const refused = await call("POST", "/api/my/games", { body: { source: "one more" }, cookie: ada });
    expect(refused).toEqual(expect.objectContaining({ status: 409, body: { error: `You have ${GAMES_PER_ACCOUNT} Games, the most one account may have. Upload a new Version of one of them instead.` } }));
  });

  test(`${VERSIONS_PER_GAME} Versions for one Game`, async () => {
    playtest.answer = FAILED;
    const ada = await signIn("ada@purdue.edu");
    const game = await upload(ada, "v0");
    for (let i = 1; i < VERSIONS_PER_GAME; i++) {
      if (i % UPLOADS_PER_HOUR === 0) clock.time += HOUR;
      if (i % UPLOADS_PER_DAY === 0) clock.time += 24 * HOUR;
      await uploadVersion(ada, game.id, `v${i}`);
    }
    clock.time += 25 * HOUR;
    const refused = await call("POST", `/api/my/games/${game.id}/versions`, { body: { source: "one more" }, cookie: ada });
    expect(refused).toEqual(expect.objectContaining({ status: 409, body: { error: `This Game has ${VERSIONS_PER_GAME} Versions, the most one Game may have. Start a new Game for more.` } }));
  });

  test(`${MAX_WAITING} waiting in the queue in all; past that, the site is busy`, async () => {
    // Accounts enough that no one account's own limits come first; nothing finishes, so they pile up.
    const cookies = await Promise.all(["a", "b", "c"].map((name) => signIn(`${name}${name}@purdue.edu`)));
    let made = 0;
    for (const cookie of cookies) for (let i = 0; i < UPLOADS_PER_HOUR && made < MAX_WAITING + MAX_CHECKS_AT_ONCE; i++, made++) await upload(cookie, `q${made}`);
    const refused = await call("POST", "/api/my/games", { body: { source: "one more" }, cookie: cookies[2] });
    expect(refused).toEqual(expect.objectContaining({ status: 503, body: { error: "The site is busy checking other Games. Try again in a few minutes." } }));
  });

  test("a source over 256 KB is refused, whether or not its request fits; so is a request too large to read", async () => {
    const ada = await signIn("ada@purdue.edu");
    const message = "A Game's code may be at most 256 KB.";
    expect(await call("POST", "/api/my/games", { body: { source: "x".repeat(256 * 1024 + 1) }, cookie: ada })).toEqual(expect.objectContaining({ status: 413, body: { error: message } }));
    expect(await call("POST", "/api/my/games", { body: { source: "\n".repeat(MAX_UPLOAD_BODY_BYTES / 2) }, cookie: ada })).toEqual(expect.objectContaining({ status: 413, body: { error: message } }));
    // A full-size source with JSON's escapes in it still fits.
    const full = await call("POST", "/api/my/games", { body: { source: `${"a\n".repeat(10 * 1024)}${"x".repeat(256 * 1024 - 20 * 1024)}` }, cookie: ada });
    expect(full.status).toBe(201);
    // Every other request is still held to the site's own small limit.
    expect((await call("PUT", "/api/my/games/x", { body: { description: "x".repeat(20_000) }, cookie: ada })).status).toBe(413);
    expect(await call("POST", "/api/my/games", { body: { source: "  " }, cookie: ada })).toEqual(expect.objectContaining({ status: 400, body: { error: "Send the Game's code." } }));
  });

  test("with no Playtest on this server, Uploads are refused", async () => {
    await server.close();
    await startServer(null);
    const ada = await signIn("ada@purdue.edu");
    expect(await call("POST", "/api/my/games", { body: { source: "x" }, cookie: ada })).toEqual(expect.objectContaining({ status: 503, body: { error: "Uploads are switched off on this server for now." } }));
  });
});

describe("what a Creator writes is text", () => {
  test(`a description up to ${DESCRIPTION_MAX} characters, trimmed, kept exactly as written, and in no log line`, async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await readyGame(ada, "x", "<b>Title</b>");
    const description = `<script>alert("hi")</script>\nTwo lines & "quotes" ${"é".repeat(DESCRIPTION_MAX - 60)}`;
    const saved = await call("PUT", `/api/my/games/${game.id}`, { body: { description: `  ${description}  ` }, cookie: ada });
    expect(saved.headers.get("content-type")).toContain("application/json");
    expect((saved.body["game"] as GameSeen).description).toBe(description);
    expect((await gameSeen(ada, game.id)).description).toBe(description);
    expect((await gameSeen(ada, game.id)).versions[0]?.about?.title).toBe("<b>Title</b>");
    const tooLong = await call("PUT", `/api/my/games/${game.id}`, { body: { description: "é".repeat(DESCRIPTION_MAX + 1) }, cookie: ada });
    expect(tooLong).toEqual(expect.objectContaining({ status: 400, body: { error: `A description may be at most ${DESCRIPTION_MAX} characters.` } }));
    for (const line of logged) {
      expect(line).not.toContain("alert");
      expect(line).not.toContain("<b>");
    }
  });
});

describe("blocked words, where text becomes public, each refusal naming the word", () => {
  const publishIt = (cookie: string, game: GameSeen) => call("POST", `/api/my/games/${game.id}/publish`, { body: { versionId: game.versions[0]?.id }, cookie });
  const describeIt = (cookie: string, game: GameSeen, description: string) => call("PUT", `/api/my/games/${game.id}`, { body: { description }, cookie });

  test("a display name, when it is chosen; a harmless name containing a blocked word is taken", async () => {
    const ada = await signIn("ada@purdue.edu", null);
    const refused = await call("POST", "/api/me/display-name", { body: { displayName: "x_fuck_99" }, cookie: ada });
    expect(refused).toEqual(expect.objectContaining({ status: 400, body: { error: `That display name has a word the site doesn't allow: "fuck". Pick another.` } }));
    expect((await call("POST", "/api/me/display-name", { body: { displayName: "Scunthorpe Sam" }, cookie: ada })).status).toBe(200);
  });

  test("a Game's title, from its Version's about, when it is published; the Game stays unpublished", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await readyGame(ada, "rude", "Whores of Space");
    const refused = await publishIt(ada, game);
    expect(refused.status).toBe(400);
    expect(refused.body["error"]).toBe(`The Game's title has a word the site doesn't allow: "whore". Change the title in the Game's code, upload it as a new Version and publish that.`);
    expect((await gameSeen(ada, game.id)).publishedVersionId).toBeNull();
  });

  test("a description, when the Game is published: kept while it is private, refused at publishing", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await readyGame(ada, "nice", "Nice Game");
    expect((await describeIt(ada, game, "A game for twats")).status).toBe(200);
    expect(await publishIt(ada, game)).toEqual(expect.objectContaining({ status: 400, body: { error: `The description has a word the site doesn't allow: "twat". Change it and try again.` } }));
    expect((await gameSeen(ada, game.id)).publishedVersionId).toBeNull();
  });

  test("a description changed while the Game is published is refused, and the old one stays", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await readyGame(ada, "nice", "Nice Game");
    expect((await describeIt(ada, game, "Draw things.")).status).toBe(200);
    expect((await publishIt(ada, game)).status).toBe(200);
    expect(await describeIt(ada, game, "Draw a CUNT")).toEqual(expect.objectContaining({ status: 400, body: { error: `The description has a word the site doesn't allow: "cunt". Change it and try again.` } }));
    expect((await gameSeen(ada, game.id)).description).toBe("Draw things.");
  });

  test("a harmless title and description containing blocked words are published", async () => {
    const ada = await signIn("ada@purdue.edu");
    const game = await readyGame(ada, "harmless", "Scunthorpe Spice Rack");
    expect((await describeIt(ada, game, "Specific gravity, fire retardant and spicy tacos.")).status).toBe(200);
    expect((await publishIt(ada, game)).status).toBe(200);
  });
});

test("a real Playtest, end to end, through the child-process way", async () => {
  await server.close();
  await startServer(childProcessRunner({ log: () => undefined }));
  const ada = await signIn("ada@purdue.edu");
  const source = `import { defineGame } from "@boilergames/sdk/v1";
export default defineGame<{ taps: number }, { type: "tap" }>({
  about: { title: "Three Taps", players: { min: 1, max: 2 } },
  start: () => ({ state: { taps: 0 } }),
  onAction: (state) => (state.taps + 1 >= 3 ? { state: { taps: 3 }, end: {} } : { state: { taps: state.taps + 1 } }),
  onLeave: (state) => ({ state }),
  screen: (state) => ({ parts: [{ kind: "text", text: \`\${state.taps} taps\` }] }),
  controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
});
`;
  const game = await upload(ada, source);
  let checked: GameSeen | undefined;
  await vi.waitFor(
    async () => {
      checked = await gameSeen(ada, game.id);
      expect(checked.versions[0]?.state).not.toBe("checking");
    },
    { timeout: 30_000, interval: 100 },
  );
  expect(checked?.versions[0]).toEqual(expect.objectContaining({ state: "ready", about: { title: "Three Taps", players: { min: 1, max: 2 } } }));
  const bundle = await call("GET", `/api/games/${checked?.versions[0]?.id ?? ""}/bundle.js`, { cookie: ada });
  expect(bundle.text).toMatch(/^var BoilerGamesGame = \(function\(\) \{/);
}, 40_000);
