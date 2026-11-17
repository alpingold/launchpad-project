/**
 * The WebSocket side of Rooms: `ws` sockets on one path, each message parsed as JSON, checked against
 * the schema for its socket's side, and handed to the rooms layer. Nothing here throws on what a
 * socket sends: a message that fails is handed over as a failure, and the rooms layer refuses it.
 */
import type { IncomingMessage, Server } from "node:http";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, phoneToServer, screenToServer } from "@boilergames/protocol";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { Rooms, type Clock, type Incoming } from "./rooms.js";

/** The one WebSocket path, for the Screen and the phones alike: a socket's first message says which it is. */
export const WEBSOCKET_PATH = "/ws";

const FIRST_TYPES = new Set(["openRoom", "resumeRoom", "join", "rejoin"]);

export interface TransportOptions {
  readonly clock: Clock;
  /** The address a socket came from, for the join limit. */
  readonly addressOf: (request: IncomingMessage) => string;
}

/** Serves Rooms over WebSockets on `server`. Returns the rooms layer and a function that stops it all. */
export function attachRooms(server: Server, options: TransportOptions): { readonly rooms: Rooms; readonly stop: () => void } {
  const sockets = new Map<string, WebSocket>();
  let opened = 0;

  const rooms = new Rooms({
    clock: options.clock,
    send(id, message) {
      const socket = sockets.get(id);
      if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
    close(id) {
      const socket = sockets.get(id);
      sockets.delete(id);
      // A normal close: anything sent just before it (a `refused`, a `closed`) goes out first.
      socket?.close(1000);
    },
  });

  // maxPayload: a bigger message closes the socket (code 1009) before any of it is read.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  wss.on("error", (error) => console.error("WebSocket server error:", error));

  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    if (new URL(request.url ?? "/", "http://site").pathname !== WEBSOCKET_PATH) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      // A new id for every socket, never reused, so a late event from an old socket can't be
      // mistaken for a new one.
      const id = `c${++opened}`;
      sockets.set(id, ws);
      rooms.connected(id, options.addressOf(request));
      ws.on("message", (data, isBinary) => rooms.received(id, parse(data, isBinary, rooms.sideOf(id))));
      ws.on("close", () => {
        sockets.delete(id);
        rooms.disconnected(id);
      });
      // Too big, bad UTF-8, a broken connection: ws closes the socket itself, and "close" follows.
      ws.on("error", () => undefined);
    });
  });

  return {
    rooms,
    stop() {
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
