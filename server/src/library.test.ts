// The Library's two routes, over real HTTP, against a database the test fills in directly: what each
// Game carries (and never carries), the order, and that a private Game is "not found" exactly like
// one that never existed.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAccount, setDisplayName } from "./db/accounts.js";
import { IN_MEMORY, openDatabase, type Database } from "./db/database.js";
import { createGame, createVersion, finishCheck, publish, setDescription, takeDown } from "./db/games.js";
import { addPlay } from "./db/plays.js";
import { createServer, type RunningServer } from "./index.js";
import { MAX_LIBRARY_GAMES } from "./library.js";

const SITE = "https://boilergames.test";
const OFFICIAL = { id: "demo", title: "Demo", players: { min: 1, max: 4 }, look: { font: "rounded" } };
const EMAIL = "ada.private@purdue.edu";

let root: string;
let database: Database;
let server: RunningServer;
let base: string;

/** A Game with one ready Version per title, published (the last one) unless told otherwise. */
function game(id: string, titles: readonly string[], options: { publish?: boolean; madeAt?: number; description?: string } = {}): string[] {
  createGame(db(), { id, ownerId: "a1", createdAt: 1 });
  const versions = titles.map((title, index) => {
    const versionId = `${id}-v${index + 1}`;
    createVersion(db(), { id: versionId, gameId: id, source: "// the source", createdAt: (options.madeAt ?? 100) + index });
    finishCheck(db(), versionId, { ok: true, bundle: "// the bundle", about: { title, players: { min: 2, max: 5 } } }, 2);
    return versionId;
  });
  if (options.description !== undefined) setDescription(db(), id, options.description);
  if (options.publish !== false) publish(db(), id, versions.at(-1)!);
  return versions;
}
const db = () => database;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "library-"));
  await mkdir(join(root, "client"));
  await mkdir(join(root, "games"));
  await writeFile(join(root, "client/index.html"), "<!doctype html><title>BoilerGames</title>");
  await writeFile(join(root, "games/games.json"), JSON.stringify([{ ...OFFICIAL, description: "Tap things. The most taps wins." }]));
  await writeFile(join(root, "games/demo.js"), "var BoilerGamesGame = {};");
  database = openDatabase({ file: IN_MEMORY, log: () => undefined });
  createAccount(database, { id: "a1", email: EMAIL, createdAt: 1 });
  setDisplayName(database, "a1", "Ada", "ada");

  game("older", ["Old One"], { madeAt: 100, description: "An old Game." });
  game("newer", ["New One, v1", "New One"], { madeAt: 200, description: "A newer Game." });
  game("private", ["Never Published"], { publish: false });
  game("down", ["Taken Down"], { madeAt: 300 });
  takeDown(database, "down", 400);
  addPlay(database, { gameId: "older" });
  addPlay(database, { gameId: "older" });
  addPlay(database, { official: "demo" });

  server = createServer({ clientDist: join(root, "client"), gamesDist: join(root, "games"), siteOrigin: SITE, frameUrl: "https://play.test/v1/", database });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.close();
  database.close();
  await rm(root, { recursive: true });
});

test("the Library: the Official games, then every published Game, newest first, each with what its page needs", async () => {
  const response = await fetch(`${base}/api/library`);
  expect(response.headers.get("cache-control")).toBe("no-cache");
  expect(await response.json()).toEqual([
    { id: "demo", playId: "demo", title: "Demo", players: { min: 1, max: 4 }, look: { font: "rounded" }, description: "Tap things. The most taps wins.", creator: null, madeBy: "Official", publishedAt: null, plays: 1 },
    { id: "newer", playId: "newer-v2", title: "New One", players: { min: 2, max: 5 }, description: "A newer Game.", creator: "Ada", madeBy: "Uploaded", publishedAt: 201, plays: 0 },
    { id: "older", playId: "older-v1", title: "Old One", players: { min: 2, max: 5 }, description: "An old Game.", creator: "Ada", madeBy: "Uploaded", publishedAt: 100, plays: 2 },
  ]);
});

test("one Game by its Game id, or an Official game by its name: the same entry as in the list", async () => {
  const list = (await (await fetch(`${base}/api/library`)).json()) as { id: string }[];
  for (const entry of list) {
    const response = await fetch(`${base}/api/library/${entry.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(entry);
  }
});

test("no listing carries an email address, an account's id, the source or the bundle: each entry has exactly its own keys", async () => {
  const keys = ["creator", "description", "id", "madeBy", "playId", "players", "plays", "publishedAt", "title"];
  const list = (await (await fetch(`${base}/api/library`)).json()) as Record<string, unknown>[];
  for (const entry of list) expect(Object.keys(entry).filter((key) => key !== "look").sort()).toEqual(keys);
  for (const path of ["/api/library", "/api/library/older", "/api/library/demo"]) {
    const text = await (await fetch(`${base}${path}`)).text();
    for (const secret of [EMAIL, "a1", "the source", "the bundle"]) expect(text, `${path} carries ${secret}`).not.toContain(secret);
  }
});

test("an unpublished Game, a taken-down one, a Version's id and an id that never existed are the same 'not found'", async () => {
  const answers = await Promise.all(
    ["private", "down", "older-v1", "never-was"].map(async (id) => {
      const response = await fetch(`${base}/api/library/${id}`);
      return { status: response.status, cache: response.headers.get("cache-control"), type: response.headers.get("content-type"), body: await response.text() };
    }),
  );
  expect(answers[0]).toEqual({ status: 404, cache: "no-store", type: expect.stringContaining("application/json"), body: JSON.stringify({ error: "There's no such Game in the Library." }) });
  for (const answer of answers) expect(answer).toEqual(answers[0]);
});

test("the Library's pages are the site's page", async () => {
  for (const path of ["/library", "/library/older"]) expect(await (await fetch(`${base}${path}`)).text(), path).toContain("BoilerGames");
});

test("the Lobby's list is unchanged: no descriptions, no plays, the published Version's id", async () => {
  expect(await (await fetch(`${base}/api/games`)).json()).toEqual([
    OFFICIAL,
    { id: "newer-v2", title: "New One", players: { min: 2, max: 5 }, creator: "Ada", uploaded: true },
    { id: "older-v1", title: "Old One", players: { min: 2, max: 5 }, creator: "Ada", uploaded: true },
  ]);
  expect(await (await fetch(`${base}/api/games/demo`)).json()).toEqual(OFFICIAL);
});

test(`the Library lists at most ${MAX_LIBRARY_GAMES} published Games, the newest`, async () => {
  // Its own database and server, so the other tests' Games are not counted.
  const many = openDatabase({ file: IN_MEMORY, log: () => undefined });
  createAccount(many, { id: "a1", email: EMAIL, createdAt: 1 });
  setDisplayName(many, "a1", "Ada", "ada");
  const total = MAX_LIBRARY_GAMES + 5;
  for (let n = 1; n <= total; n += 1) {
    createGame(many, { id: `g${n}`, ownerId: "a1", createdAt: n });
    createVersion(many, { id: `g${n}-v1`, gameId: `g${n}`, source: "//", createdAt: n });
    finishCheck(many, `g${n}-v1`, { ok: true, bundle: "//", about: { title: `Game ${n}`, players: { min: 1, max: 4 } } }, n);
    publish(many, `g${n}`, `g${n}-v1`);
  }
  const listing = createServer({ clientDist: join(root, "client"), gamesDist: join(root, "games"), siteOrigin: SITE, frameUrl: "https://play.test/v1/", database: many });
  await new Promise<void>((resolve) => listing.http.listen(0, "127.0.0.1", resolve));
  try {
    const list = (await (await fetch(`http://127.0.0.1:${(listing.http.address() as AddressInfo).port}/api/library`)).json()) as { id: string; madeBy: string }[];
    const uploaded = list.filter((entry) => entry.madeBy === "Uploaded");
    expect(uploaded).toHaveLength(MAX_LIBRARY_GAMES);
    expect(uploaded[0]?.id).toBe(`g${total}`);
    expect(uploaded.at(-1)?.id).toBe(`g${total - MAX_LIBRARY_GAMES + 1}`);
    expect(list.filter((entry) => entry.madeBy === "Official")).toHaveLength(1);
  } finally {
    await listing.close();
    many.close();
  }
});
