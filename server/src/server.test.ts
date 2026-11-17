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
import { createServer, WEBSOCKET_PATH, type RunningServer } from "./index.js";

let server: RunningServer;
let base: string;
let root: string;
const GAME = { id: "demo", title: "Demo", players: { min: 1, max: 4 } };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "site-"));
  await mkdir(join(root, "client"));
  await mkdir(join(root, "games"));
  await writeFile(join(root, "client/index.html"), "<!doctype html><title>BoilerGames</title>");
  await writeFile(join(root, "games/games.json"), JSON.stringify([GAME]));
  await writeFile(join(root, "games/demo.js"), "var BoilerGamesGame = {};");
  server = createServer({ clientDist: join(root, "client"), gamesDist: join(root, "games") });
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

  static async open(): Promise<Client> {
    const ws = new WebSocket(`ws://${base}${WEBSOCKET_PATH}`);
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
    expect(bundle.headers.get("content-type")).toContain("text/javascript");
    expect(await bundle.text()).toBe("var BoilerGamesGame = {};");
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
    const ws = new WebSocket(`ws://${base}/elsewhere`);
    const failed = await new Promise<string>((resolve) => {
      ws.on("error", (error) => resolve(error.message));
      ws.on("open", () => resolve("opened"));
    });
    expect(failed).toContain("404");
  });
});
