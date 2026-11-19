// The whole server in-process, over real HTTP and real WebSockets: the site's files and Games, a
// Room played through (join, a View, an Action), and what the transport does with messages that
// aren't messages.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_MESSAGE_BYTES } from "@boilergames/protocol";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import * as playtest from "@boilergames/playtest";
import { playsOf } from "./db/plays.js";
import { UPLOADS_PER_DAY, UPLOADS_PER_HOUR } from "./games.js";
import { createServer, forwardedAddress, IN_MEMORY, MAX_SOCKETS_PER_ADDRESS, openDatabase, realClock, WEBSOCKET_PATH, type RunningServer } from "./index.js";
import { MIN_COUNTED_MATCH_MS } from "./plays.js";

let server: RunningServer;
let base: string;
let root: string;
const GAME = { id: "demo", title: "Demo", players: { min: 1, max: 4 } };
/** The site's own origin, which a socket must come from. */
const SITE = "https://boilergames.test";
const FRAME_URL = "https://play.boilergames.test/v1/";
/** Pings every 150 ms here, so a test can watch a silent socket being dropped. */
const PING_MS = 150;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "site-"));
  await mkdir(join(root, "client"));
  await mkdir(join(root, "games"));
  await writeFile(join(root, "client/index.html"), "<!doctype html><title>BoilerGames</title>");
  await writeFile(join(root, "games/games.json"), JSON.stringify([GAME]));
  await writeFile(join(root, "games/demo.js"), "var BoilerGamesGame = {};");
  server = createServer({ clientDist: join(root, "client"), gamesDist: join(root, "games"), siteOrigin: SITE, frameUrl: FRAME_URL, pingIntervalMs: PING_MS });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  base = `127.0.0.1:${(server.http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true });
});

/** A WebSocket client that keeps every message it gets. */
class Client {
  readonly messages: { type: string; [key: string]: unknown }[] = [];
  readonly closed: Promise<number>;
  readonly #ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on("message", (data) => this.messages.push(JSON.parse(String(data)) as { type: string }));
    this.closed = new Promise((resolve) => ws.on("close", (code) => resolve(code)));
  }

  static async open(options: { origin?: string; headers?: Record<string, string>; autoPong?: boolean; at?: string } = {}): Promise<Client> {
    const ws = new WebSocket(`ws://${options.at ?? base}${WEBSOCKET_PATH}`, { origin: options.origin ?? SITE, headers: options.headers ?? {}, autoPong: options.autoPong ?? true });
    ws.on("error", () => undefined);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return new Client(ws);
  }

  send(message: unknown): void {
    this.#ws.send(JSON.stringify(message));
  }

  raw(data: string | Buffer, binary = false): void {
    this.#ws.send(data, { binary });
  }

  /** The first message of this type from index `from` on, waiting for it if need be. */
  async next(type: string, from = 0): Promise<{ type: string; [key: string]: unknown }> {
    for (let waited = 0; waited < 3_000; waited += 10) {
      const found = this.messages.slice(from).find((m) => m.type === type);
      if (found !== undefined) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no ${type} message; got ${JSON.stringify(this.messages)}`);
  }
}

describe("HTTP", () => {
  test("serves the built client, the list of Official games, and each Game's bundle", async () => {
    expect(await (await fetch(`http://${base}/`)).text()).toContain("BoilerGames");
    expect(await (await fetch(`http://${base}/api/games`)).json()).toEqual([GAME]);
    const bundle = await fetch(`http://${base}/api/games/demo/bundle.js`);
    // As text, never as a script: the site never runs a Game's code itself (games.ts).
    expect(bundle.headers.get("content-type")).toContain("text/plain");
    expect(bundle.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await bundle.text()).toBe("var BoilerGamesGame = {};");
  });

  test("serves the client's page at /screen and /play too, and tells the pages where the Game frame is", async () => {
    for (const path of ["/screen", "/play", "/make", "/privacy"]) expect(await (await fetch(`http://${base}${path}`)).text(), path).toContain("BoilerGames");
    expect(await (await fetch(`http://${base}/api/config`)).json()).toEqual({ frameUrl: FRAME_URL, limits: expect.any(Object) });
  });

  test("the limits /make quotes are the Playtest's own numbers and the site's own Upload limits, not copies", async () => {
    const { limits } = (await (await fetch(`http://${base}/api/config`)).json()) as { limits: unknown };
    expect(limits).toEqual({
      maxSourceBytes: playtest.MAX_SOURCE_BYTES,
      maxBundleBytes: playtest.MAX_BUNDLE_BYTES,
      loadMs: playtest.LOAD_MS,
      runMs: playtest.RUN_MS,
      seeds: playtest.SEEDS.length,
      uploadsPerHour: UPLOADS_PER_HOUR,
      uploadsPerDay: UPLOADS_PER_DAY,
    });
  });

  test("serves no bundle the list doesn't name, and never the frame's page", async () => {
    for (const path of ["/api/games/nope/bundle.js", "/api/games/__proto__/bundle.js", "/api/games/..%2Fgames.json/bundle.js", "/frame/v1/", "/dist-frame/v1/"]) {
      expect((await fetch(`http://${base}${path}`)).status, path).toBe(404);
    }
  });
});

describe("a Room over real WebSockets", () => {
  test("a Screen opens a Room, a phone joins, the Screen sends its View, and its Action comes back", async () => {
    const screen = await Client.open();
    screen.send({ type: "openRoom", v: 1 });
    const opened = await screen.next("roomOpened");
    const code = (opened["room"] as { code: string }).code;

    const phone = await Client.open();
    phone.send({ type: "join", v: 1, code, name: "  Ada  " });
    const seated = await phone.next("seated");
    const seatId = seated["seatId"] as string;
    // The name was trimmed on the way in.
    expect((seated["room"] as { seats: { name: string }[] }).seats).toEqual([{ id: seatId, name: "Ada", connected: true }]);
    await screen.next("room");

    screen.send({ type: "startMatch", match: { gameId: "demo", title: "Demo", look: {} } });
    screen.send({ type: "views", views: { [seatId]: { parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] } }, timerMs: 5_000 });
    const view = await phone.next("view");
    expect(view["view"]).toEqual({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] });
    expect(view["timerMs"]).toBeLessThanOrEqual(5_000);

    phone.send({ type: "action", action: { type: "tap" } });
    expect(await screen.next("action")).toEqual({ type: "action", seatId, action: { type: "tap" } });
  });
});

test("a finished Match of an Official game, long enough and with enough Players, is counted by the real server", async () => {
  // Its own server, with a clock whose time a test can move (its timers are the real ones) and a
  // database the test can read.
  let offset = 0;
  const clock = { now: () => Date.now() + offset, setTimeout: realClock.setTimeout };
  const database = openDatabase({ file: IN_MEMORY, log: () => undefined });
  const counting = createServer({ clientDist: join(root, "client"), gamesDist: join(root, "games"), siteOrigin: SITE, frameUrl: FRAME_URL, clock, database });
  await new Promise<void>((resolve) => counting.http.listen(0, "127.0.0.1", resolve));
  const at = `127.0.0.1:${(counting.http.address() as AddressInfo).port}`;
  try {
    const screen = await Client.open({ at });
    screen.send({ type: "openRoom", v: 1 });
    const code = ((await screen.next("roomOpened"))["room"] as { code: string }).code;
    const phone = await Client.open({ at });
    phone.send({ type: "join", v: 1, code, name: "Ada" });
    await phone.next("seated");
    screen.send({ type: "startMatch", match: { gameId: "demo", title: "Demo", look: {} } });
    await phone.next("room", 1);
    offset += MIN_COUNTED_MATCH_MS;
    const before = phone.messages.length;
    screen.send({ type: "endMatch", reason: "finished" });
    await phone.next("room", before);
    expect(playsOf(database, { official: "demo" })).toBe(1);
  } finally {
    await counting.close();
    database.close();
  }
});

describe("what the transport does with messages that aren't messages", () => {
  test("something that isn't JSON, or a binary frame, first: refused with badMessage, and the socket closed", async () => {
    for (const [data, binary] of [["not json", false], [Buffer.from([1, 2, 3]), true]] as const) {
      const client = await Client.open();
      client.raw(data, binary);
      expect(await client.next("refused")).toEqual({ type: "refused", reason: "badMessage" });
      expect(await client.closed).toBe(1000);
    }
  });

  test("a first message from an older page: refused with oldPage", async () => {
    const client = await Client.open();
    client.send({ type: "join", v: 0, code: "ABCD", name: "Ada" });
    expect(await client.next("refused")).toEqual({ type: "refused", reason: "oldPage" });
    expect(await client.closed).toBe(1000);
  });

  test(`a message over ${MAX_MESSAGE_BYTES / 1024} KB closes the socket (1009), and the server goes on`, async () => {
    const big = await Client.open();
    big.raw(JSON.stringify({ type: "openRoom", v: 1, pad: "x".repeat(MAX_MESSAGE_BYTES) }));
    expect(await big.closed).toBe(1009);
    const next = await Client.open();
    next.send({ type: "openRoom", v: 1 });
    expect((await next.next("roomOpened"))["type"]).toBe("roomOpened");
  });

  test("a seated phone or a Screen sending more than that is closed (1009) like a dropped socket: its Seat or Room waits", async () => {
    const screen = await Client.open();
    screen.send({ type: "openRoom", v: 1 });
    const { room, hostToken } = (await screen.next("roomOpened")) as unknown as { room: { code: string }; hostToken: string };
    const phone = await Client.open();
    phone.send({ type: "join", v: 1, code: room.code, name: "Ada" });
    await phone.next("seated");
    const before = screen.messages.length;
    phone.raw(JSON.stringify({ type: "action", action: { pad: "x".repeat(MAX_MESSAGE_BYTES) } }));
    expect(await phone.closed).toBe(1009);
    expect(((await screen.next("room", before))["room"] as { seats: { connected: boolean }[] }).seats).toEqual([expect.objectContaining({ connected: false })]);

    screen.raw(JSON.stringify({ type: "views", views: { s1: { pad: "x".repeat(MAX_MESSAGE_BYTES) } }, timerMs: null }));
    expect(await screen.closed).toBe(1009);
    const back = await Client.open();
    back.send({ type: "resumeRoom", v: 1, code: room.code, hostToken });
    expect((await back.next("roomOpened"))["type"]).toBe("roomOpened");
  });

  test("a WebSocket on any other path is turned away", async () => {
    const ws = new WebSocket(`ws://${base}/elsewhere`, { origin: SITE });
    const failed = await new Promise<string>((resolve) => {
      ws.on("error", (error) => resolve(error.message));
      ws.on("open", () => resolve("opened"));
    });
    expect(failed).toContain("404");
  });
});

/** Tries to open a socket and says how it was refused: the HTTP status, or "opened". */
function upgradeStatus(url: string, options: { origin?: string; headers?: Record<string, string> }): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    ws.on("unexpected-response", (_request, response) => resolve(String(response.statusCode)));
    ws.on("error", (error) => resolve(`error: ${error.message}`));
    ws.on("open", () => {
      resolve("opened");
      ws.close();
    });
  });
}

describe("who may open a socket", () => {
  test("only a page of the site's own origin: any other Origin, or none, is refused with 403 before a message is read", async () => {
    expect(await upgradeStatus(`ws://${base}${WEBSOCKET_PATH}`, { origin: "https://evil.example" })).toBe("403");
    expect(await upgradeStatus(`ws://${base}${WEBSOCKET_PATH}`, {})).toBe("403");
    expect(await upgradeStatus(`ws://${base}${WEBSOCKET_PATH}`, { origin: SITE })).toBe("opened");
  });

  test(`at most ${MAX_SOCKETS_PER_ADDRESS} sockets per address, which behind a proxy is the rightmost X-Forwarded-For entry`, async () => {
    // A second server, as main.ts runs it with TRUST_PROXY=1.
    const proxied = createServer({ clientDist: join(root, "client"), gamesDist: join(root, "games"), siteOrigin: SITE, frameUrl: FRAME_URL, addressOf: forwardedAddress });
    await new Promise<void>((resolve) => proxied.http.listen(0, "127.0.0.1", resolve));
    const at = `127.0.0.1:${(proxied.http.address() as AddressInfo).port}`;
    try {
      // Each socket writes a different address at the start of the header, as a client can; the
      // proxy's own entry, on the right, is the same: they all count as one address.
      const open = await Promise.all(
        Array.from({ length: MAX_SOCKETS_PER_ADDRESS }, (_, i) => Client.open({ at, headers: { "x-forwarded-for": `10.0.${i >> 8}.${i & 255}, 203.0.113.7` } })),
      );
      expect(open).toHaveLength(MAX_SOCKETS_PER_ADDRESS);
      expect(await upgradeStatus(`ws://${at}${WEBSOCKET_PATH}`, { origin: SITE, headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" } })).toBe("429");
      // Another address still gets in.
      expect(await upgradeStatus(`ws://${at}${WEBSOCKET_PATH}`, { origin: SITE, headers: { "x-forwarded-for": "203.0.113.8" } })).toBe("opened");
    } finally {
      await proxied.close();
    }
  });
});

test("a phone that stops answering pings is dropped: its Seat shows connected: false and waits for it", async () => {
  const screen = await Client.open();
  screen.send({ type: "openRoom", v: 1 });
  const code = ((await screen.next("roomOpened"))["room"] as { code: string }).code;
  const phone = await Client.open({ autoPong: false });
  phone.send({ type: "join", v: 1, code, name: "Ada" });
  await phone.next("seated");
  const before = screen.messages.length;
  // Silent through one ping round, dropped on the next.
  expect(await phone.closed).toBe(1006);
  const room = (await screen.next("room", before))["room"] as { seats: { name: string; connected: boolean }[] };
  expect(room.seats).toEqual([expect.objectContaining({ name: "Ada", connected: false })]);
});
