// A Creator's Generations over real HTTP (BUILD-PLAN Step 33), against the development fake: an idea
// to a Concept, edited, redrafted and approved, to a Game on My Games, published as AI-made; each
// Creator sees only their own; and with the maker off every route refuses. The key is searched for
// in every answer and log line.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaytestRunner, RunResult } from "@boilergames/playtest/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { IN_MEMORY, openDatabase, type Database } from "../db/database.js";
import { createServer, RecordedMail, type RunningServer } from "../index.js";
import type { Clock } from "../rooms.js";
import { FAKE_CONCEPT, FAKE_FAIL, fakeAnswer } from "./dev-fake.js";
import { ScriptedModel } from "./fake-model.js";
import { GENERATIONS_PATH } from "./generation-routes.js";
import { KEY_PATH, MAKER_OFF } from "./key-routes.js";
import { keySecretFromBytes, SECRET_BYTES } from "./key-secret.js";
import { MAX_IDEA_CHARS } from "./numbers.js";

const SITE = "https://boilergames.test";
const KEY = "sk-genai-routes-0123456789QRST";

class FakeClock implements Clock {
  time = 1_800_000_000_000;
  now = () => this.time;
  setTimeout = () => () => undefined;
}

/** Passes every Game, as the fake's Game would pass the real Playtest (build.test.ts and the browser tests run it for real). */
const playtest: PlaytestRunner = {
  run: async (): Promise<RunResult> => ({ ok: true, bundle: "var BoilerGamesGame = (function() {})();", about: { title: "Tap Vote", players: { min: 2, max: 4 } }, sdkVersion: "v1" }),
};

let root: string;
let db: Database;
let mail: RecordedMail;
let server: RunningServer;
let base: string;
let answers: string[];
let logged: string[];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "generations-"));
  await mkdir(join(root, "client"));
  await mkdir(join(root, "games"));
  await writeFile(join(root, "client/index.html"), "<!doctype html><title>BoilerGames</title>");
  await writeFile(join(root, "games/games.json"), "[]");
});
afterAll(async () => {
  await rm(root, { recursive: true });
});

async function start(options: { model?: ScriptedModel | null; runner?: PlaytestRunner | null } = {}): Promise<void> {
  server = createServer({
    clientDist: join(root, "client"),
    gamesDist: join(root, "games"),
    siteOrigin: SITE,
    frameUrl: "https://play.test/v1/",
    clock: new FakeClock(),
    mail,
    database: db,
    model: options.model === undefined ? new ScriptedModel([], { respond: fakeAnswer }) : options.model,
    keySecret: keySecretFromBytes(Buffer.alloc(SECRET_BYTES, 5)),
    playtest: options.runner === undefined ? playtest : options.runner,
  });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  db = openDatabase({ file: IN_MEMORY, log: () => undefined });
  mail = new RecordedMail();
  answers = [];
  logged = [];
  for (const method of ["log", "warn", "error", "info"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  await start();
});
afterEach(async () => {
  await server.close();
  db.close();
  vi.restoreAllMocks();
  for (const text of [...answers, ...logged]) expect(text).not.toContain(KEY);
});

type Body = Record<string, unknown>;

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}): Promise<{ status: number; body: Body }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(method === "GET" ? {} : { origin: SITE, "content-type": "application/json" }), ...(options.cookie === undefined ? {} : { cookie: options.cookie }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  answers.push(text, JSON.stringify([...response.headers]));
  return { status: response.status, body: text === "" ? {} : (JSON.parse(text) as Body) };
}

async function signIn(email: string): Promise<string> {
  await call("POST", "/api/sign-in", { body: { email } });
  const token = new URL(/https:\S+/.exec(mail.sent.at(-1)?.text ?? "")?.[0] ?? "").hash.slice(1);
  const response = await fetch(`${base}/api/sign-in/confirm`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token }) });
  const cookie = response.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  await call("POST", "/api/me/display-name", { body: { displayName: email.split("@")[0] }, cookie });
  return cookie;
}

/** A signed-in Creator with a saved key. */
async function creator(email: string): Promise<string> {
  const cookie = await signIn(email);
  expect((await call("PUT", KEY_PATH, { body: { key: KEY }, cookie })).status).toBe(200);
  return cookie;
}

/** Asks for the Generation until `done` holds, as the Track page does. */
async function until(cookie: string, id: string, done: (generation: Body) => boolean): Promise<Body> {
  for (let i = 0; i < 500; i += 1) {
    const { body } = await call("GET", `${GENERATIONS_PATH}/${id}`, { cookie });
    if (done(body)) return body;
    await new Promise((go) => setTimeout(go, 5));
  }
  throw new Error("the Generation never got there");
}

describe("a Generation, from idea to a published Game", () => {
  test("drafted, edited, redrafted with a note, approved, and on My Games; published, it is AI-made in the Library", async () => {
    const ada = await creator("ada@purdue.edu");
    const started = await call("POST", GENERATIONS_PATH, { body: { idea: "A game where everyone taps." }, cookie: ada });
    expect(started).toMatchObject({ status: 201, body: { idea: "A game where everyone taps.", state: "concept" } });
    const id = String(started.body["id"]);

    const review = await until(ada, id, (generation) => generation["state"] === "review");
    expect(review["concept"]).toEqual(FAKE_CONCEPT);
    expect(review).not.toHaveProperty("code");

    // An edit that breaks a rule comes back with every problem; one that doesn't is saved.
    const broken = await call("PUT", `${GENERATIONS_PATH}/${id}/concept`, { body: { concept: { ...FAKE_CONCEPT, title: "", phases: [] } }, cookie: ada });
    expect(broken).toMatchObject({ status: 400, body: { problems: ["title must be text, and not empty.", "phases must be a list of 1 to 8 phases."] } });
    const edited = await call("PUT", `${GENERATIONS_PATH}/${id}/concept`, { body: { concept: { ...FAKE_CONCEPT, title: "Ada's Taps" } }, cookie: ada });
    expect(edited).toMatchObject({ status: 200, body: { state: "review", concept: { title: "Ada's Taps" } } });

    // Sent back with a note: drafted again, and back for review.
    expect((await call("POST", `${GENERATIONS_PATH}/${id}/redraft`, { body: { note: "Make it longer." }, cookie: ada })).body["state"]).toBe("concept");
    await until(ada, id, (generation) => generation["state"] === "review");

    const approved = await call("POST", `${GENERATIONS_PATH}/${id}/approve`, { body: { concept: { ...FAKE_CONCEPT, title: "Ada's Taps" } }, cookie: ada });
    expect(approved.status).toBe(200);
    const ready = await until(ada, id, (generation) => generation["state"] === "ready");
    expect((ready["steps"] as { kind: string }[]).map((step) => step.kind)).toEqual(["concept", "concept", "build", "playtest"]);
    const gameId = String(ready["gameId"]);

    const mine = await call("GET", "/api/my/games", { cookie: ada });
    expect((mine.body["games"] as { id: string }[]).map((game) => game.id)).toEqual([gameId]);
    const game = await call("GET", `/api/my/games/${gameId}`, { cookie: ada });
    const versionId = String((game.body["game"] as { versions: { id: string }[] }).versions[0]?.id);
    expect((await call("POST", `/api/my/games/${gameId}/publish`, { body: { versionId }, cookie: ada })).status).toBe(200);
    const library = await call("GET", `/api/library/${gameId}`);
    expect(library.body).toMatchObject({ madeBy: "AI-made", creator: "ada" });

    const list = await call("GET", GENERATIONS_PATH, { cookie: ada });
    expect(list.body).toEqual([expect.objectContaining({ id, state: "ready", gameId })]);
  });

  test("an idea the AI can't make a Concept of fails, with its reason; a cancelled one says so", async () => {
    const ada = await creator("ada@purdue.edu");
    const failed = await call("POST", GENERATIONS_PATH, { body: { idea: `Something ${FAKE_FAIL}` }, cookie: ada });
    const done = await until(ada, String(failed.body["id"]), (generation) => generation["state"] === "failed");
    expect(done["reason"]).toMatch(/^The AI couldn't write a usable Concept in 3 tries/);
    expect(done["gameId"]).toBeNull();

    const other = await call("POST", GENERATIONS_PATH, { body: { idea: "Taps" }, cookie: ada });
    const otherId = String(other.body["id"]);
    await until(ada, otherId, (generation) => generation["state"] === "review");
    expect((await call("POST", `${GENERATIONS_PATH}/${otherId}/cancel`, { body: {}, cookie: ada })).body).toMatchObject({ state: "cancelled", reason: "You cancelled it." });
    expect((await call("POST", `${GENERATIONS_PATH}/${otherId}/cancel`, { body: {}, cookie: ada })).status).toBe(409);
  });

  test("an idea too long, or none, is refused", async () => {
    const ada = await creator("ada@purdue.edu");
    expect((await call("POST", GENERATIONS_PATH, { body: { idea: "x".repeat(MAX_IDEA_CHARS + 1) }, cookie: ada })).status).toBe(400);
    expect((await call("POST", GENERATIONS_PATH, { body: { idea: "  " }, cookie: ada })).status).toBe(400);
    expect((await call("POST", GENERATIONS_PATH, { body: {}, cookie: ada })).status).toBe(400);
  });
});

describe("a Revision", () => {
  test("asked for a ready Version of the Creator's own Game, followed like a Generation, to a new Version; never for someone else's", async () => {
    const ada = await creator("ada@purdue.edu");
    const id = String((await call("POST", GENERATIONS_PATH, { body: { idea: "Taps" }, cookie: ada })).body["id"]);
    await until(ada, id, (generation) => generation["state"] === "review");
    await call("POST", `${GENERATIONS_PATH}/${id}/approve`, { body: {}, cookie: ada });
    const made = await until(ada, id, (generation) => generation["state"] === "ready");
    const gameId = String(made["gameId"]);
    const game = await call("GET", `/api/my/games/${gameId}`, { cookie: ada });
    const versionId = String((game.body["game"] as { versions: { id: string }[] }).versions[0]?.id);

    const bo = await creator("bo@purdue.edu");
    expect((await call("POST", `/api/my/games/${gameId}/revisions`, { body: { versionId, request: "Mine." }, cookie: bo })).status).toBe(404);

    const revised = await call("POST", `/api/my/games/${gameId}/revisions`, { body: { versionId, request: "Longer, please." }, cookie: ada });
    expect(revised).toMatchObject({ status: 201, body: { kind: "revision", idea: "Longer, please.", gameId } });
    await until(ada, String(revised.body["id"]), (generation) => generation["state"] === "ready");
    const after = await call("GET", `/api/my/games/${gameId}`, { cookie: ada });
    expect((after.body["game"] as { versions: { number: number }[] }).versions.map((version) => version.number)).toEqual([2, 1]);
  });
});

describe("each Creator's own", () => {
  test("another Creator can't see, change or cancel it; a visitor must sign in", async () => {
    const ada = await creator("ada@purdue.edu");
    const id = String((await call("POST", GENERATIONS_PATH, { body: { idea: "Taps" }, cookie: ada })).body["id"]);
    await until(ada, id, (generation) => generation["state"] === "review");
    const bo = await creator("bo@purdue.edu");
    expect((await call("GET", `${GENERATIONS_PATH}/${id}`, { cookie: bo })).status).toBe(404);
    expect((await call("POST", `${GENERATIONS_PATH}/${id}/approve`, { body: {}, cookie: bo })).status).toBe(404);
    expect((await call("POST", `${GENERATIONS_PATH}/${id}/cancel`, { body: {}, cookie: bo })).status).toBe(404);
    expect((await call("PUT", `${GENERATIONS_PATH}/${id}/concept`, { body: { concept: FAKE_CONCEPT }, cookie: bo })).status).toBe(404);
    expect((await call("GET", GENERATIONS_PATH, { cookie: bo })).body).toEqual([]);
    expect((await call("GET", GENERATIONS_PATH)).status).toBe(401);
  });
});

describe("with the maker off", () => {
  test.each([
    ["no model", { model: null }],
    ["no Playtest", { runner: null }],
  ] as const)("%s: every route refuses", async (_what, options) => {
    await server.close();
    await start(options);
    const ada = await signIn("ada@purdue.edu");
    for (const [method, path] of [
      ["GET", GENERATIONS_PATH],
      ["POST", GENERATIONS_PATH],
      ["GET", `${GENERATIONS_PATH}/x`],
      ["POST", `${GENERATIONS_PATH}/x/approve`],
      ["POST", `${GENERATIONS_PATH}/x/cancel`],
    ] as const) {
      expect(await call(method, path, { cookie: ada, ...(method === "GET" ? {} : { body: { idea: "Taps" } }) })).toEqual({ status: 503, body: { error: MAKER_OFF } });
    }
  });
});
