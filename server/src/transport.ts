/**
 * The WebSocket side of Rooms: `ws` sockets on one path, each message parsed as JSON, checked against
 * the schema for its socket's side, and handed to the rooms layer. Nothing here throws on what a
 * socket sends: a message that fails is handed over as a failure, and the rooms layer refuses it.
 */
import type { IncomingMessage, Server } from "node:http";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, phoneToServer, screenToServer } from "@boilergames/protocol";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { Rooms, type Clock, type Incoming, type RoomsOptions } from "./rooms.js";

/** The one WebSocket path, for the Screen and the phones alike: a socket's first message says which it is. */
export const WEBSOCKET_PATH = "/ws";
/**
 * How often every socket is pinged. One that hasn't answered the last ping by the next is dropped:
 * a phone that vanished without closing (out of range, battery out) would otherwise stay
 * `connected` until the operating system noticed, which can take many minutes.
 */
export const PING_INTERVAL_MS = 30_000;
/** How many sockets one address may hold open at once. A campus's phones can share a few addresses. */
export const MAX_SOCKETS_PER_ADDRESS = 200;
/**
 * How much may wait unsent on one socket before it is dropped: one largest message. A socket that
 * doesn't read what it is sent would otherwise make the server hold it all.
 */
export const MAX_UNSENT_BYTES = MAX_MESSAGE_BYTES;

const FIRST_TYPES = new Set(["openRoom", "resumeRoom", "join", "rejoin"]);

export interface TransportOptions {
  readonly clock: Clock;
  /** The address a socket came from, for the per-address limits. */
  readonly addressOf: (request: IncomingMessage) => string;
  /** The site's own origin. A socket opened by any other page is refused before it is accepted. */
  readonly siteOrigin: string;
  /** How many Rooms may be open at once. */
  readonly maxRooms?: number;
  /** PING_INTERVAL_MS unless a test wants it shorter. */
  readonly pingIntervalMs?: number;
  /** Told when a Match ends (Rooms' onMatchEnd): the site counts plays with it. */
  readonly onMatchEnd?: RoomsOptions["onMatchEnd"];
}

/** Serves Rooms over WebSockets on `server`. Returns the rooms layer and a function that stops it all. */
export function attachRooms(server: Server, options: TransportOptions): { readonly rooms: Rooms; readonly stop: () => void } {
  const sockets = new Map<string, WebSocket>();
  /** Open sockets by address. */
  const perAddress = new Map<string, number>();
  /** Sockets that haven't answered the latest ping. */
  const silent = new Set<WebSocket>();
  let opened = 0;

  const rooms = new Rooms({
    clock: options.clock,
    ...(options.maxRooms === undefined ? {} : { maxRooms: options.maxRooms }),
    ...(options.onMatchEnd === undefined ? {} : { onMatchEnd: options.onMatchEnd }),
    send(id, message) {
      const socket = sockets.get(id);
      if (socket === undefined || socket.readyState !== socket.OPEN) return;
      if (socket.bufferedAmount > MAX_UNSENT_BYTES) {
        // It isn't reading what it is sent. Dropped, like a lost connection: its Seat or Room waits.
        socket.terminate();
        return;
      }
      socket.send(JSON.stringify(message));
    },
    close(id) {
      const socket = sockets.get(id);
      sockets.delete(id);
      // A normal close: anything sent just before it (a `refused`, a `closed`) goes out first.
      socket?.close(1000);
    },
  });

  // maxPayload: a bigger message closes the socket (code 1009) before any of it is read.
  // autoPong off: ws 8.22.1 answers every ping it gets, and a client that floods pings while not
  // reading the answers can make it buffer them until the process runs out of memory (fixed in
  // ws 8.23.0). Browsers never send pings, so the server has nothing to answer.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, autoPong: false });
  wss.on("error", (error) => console.error("WebSocket server error:", error));

  const refuse = (socket: { end(data: string): void }, status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);

  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    if (new URL(request.url ?? "/", "http://site").pathname !== WEBSOCKET_PATH) return refuse(socket, "404 Not Found");
    // Only the site's own pages may open a socket. Browsers always send Origin on a WebSocket; a
    // page on another site can't fake it.
    if (request.headers.origin !== options.siteOrigin) return refuse(socket, "403 Forbidden");
    const address = options.addressOf(request);
    if ((perAddress.get(address) ?? 0) >= MAX_SOCKETS_PER_ADDRESS) return refuse(socket, "429 Too Many Requests");
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    let counted = true;
    const uncount = () => {
      if (!counted) return;
      counted = false;
      const left = (perAddress.get(address) ?? 1) - 1;
      if (left === 0) perAddress.delete(address);
      else perAddress.set(address, left);
    };
    socket.once("close", uncount);
    wss.handleUpgrade(request, socket, head, (ws) => {
      // A new id for every socket, never reused, so a late event from an old socket can't be
      // mistaken for a new one.
      const id = `c${++opened}`;
      sockets.set(id, ws);
      rooms.connected(id, address);
      ws.on("pong", () => silent.delete(ws));
      ws.on("message", (data, isBinary) => rooms.received(id, parse(data, isBinary, rooms.sideOf(id))));
      ws.on("close", () => {
        sockets.delete(id);
        silent.delete(ws);
        uncount();
        rooms.disconnected(id);
      });
      // Too big, bad UTF-8, a broken connection: ws closes the socket itself, and "close" follows.
      ws.on("error", () => undefined);
    });
  });

  // Each round: a socket still silent since the last ping is dropped; the rest are pinged again.
  const pinging = setInterval(() => {
    for (const ws of sockets.values()) {
      if (silent.has(ws)) {
        ws.terminate();
        continue;
      }
      silent.add(ws);
      ws.ping();
    }
  }, options.pingIntervalMs ?? PING_INTERVAL_MS);
  pinging.unref();

  return {
    rooms,
    stop() {
      clearInterval(pinging);
      rooms.stop();
      for (const ws of sockets.values()) ws.terminate();
      sockets.clear();
      wss.close();
    },
  };
}

/** One message from a socket, as the rooms layer wants it. */
function parse(data: RawData, isBinary: boolean, side: "screen" | "phone" | undefined): Incoming {
  const bad = { ok: false, refusal: "badMessage" } as const;
  if (isBinary) return bad;
  let value: unknown;
  try {
    value = JSON.parse(Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data as ArrayBuffer).toString("utf8"));
  } catch {
    return bad;
  }
  // A first message from an older or newer page: say so, so the page can tell its Player to reload.
  if (typeof value === "object" && value !== null && FIRST_TYPES.has(String((value as { type?: unknown }).type))) {
    const v = (value as { v?: unknown }).v;
    if (v !== PROTOCOL_VERSION && typeof v === "number") return { ok: false, refusal: "oldPage" };
  }
  // Before the first message, either side's: the rooms layer refuses what can't come first.
  const schemas = side === "screen" ? [screenToServer] : side === "phone" ? [phoneToServer] : [screenToServer, phoneToServer];
  for (const schema of schemas) {
    const checked = schema.safeParse(value);
    // The parsed value, not the raw one: the schema trims names, among other things.
    if (checked.success) return { ok: true, message: checked.data };
  }
  return bad;
}
