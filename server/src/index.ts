/**
 * The server: the site (HTTP and Rooms over WebSockets) on one port. The game domain, which serves
 * only the Game frame, is a separate server (createFrameServer) on its own port or domain.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import type { PlaytestRunner } from "@boilergames/playtest/client";
import { IN_MEMORY, openDatabase, type Database } from "./db/database.js";
import { RecordedMail, type Mail } from "./mail.js";
import type { Clock } from "./rooms.js";
import { createSite, type SiteOptions } from "./site.js";
import { attachRooms } from "./transport.js";

export interface ServerOptions extends SiteOptions {
  /** The site's own origin, such as https://boilergames.party. Only its pages may open a socket. */
  readonly siteOrigin: string;
  /** How many Rooms may be open at once (DEFAULT_MAX_ROOMS unless set). */
  readonly maxRooms?: number;
  /** The real clock unless a test passes its own. */
  readonly clock?: Clock;
  /** Where a socket came from, for the per-address limits. The socket's own address unless set. */
  readonly addressOf?: (request: IncomingMessage) => string;
  /** How often sockets are pinged (PING_INTERVAL_MS unless a test wants it shorter). */
  readonly pingIntervalMs?: number;
  /** The database, opened and up to date (main.ts opens it). A fresh one in memory unless given. */
  readonly database?: Database;
  /** How emails are sent (mail.ts). Recorded, and sent nowhere, unless given. */
  readonly mail?: Mail;
  /**
   * How a Playtest is run (config.ts, playtestFrom), for Uploads (BUILD-PLAN Step 14). Null: there
   * is none, and Uploads are refused.
   */
  readonly playtest?: PlaytestRunner | null;
}

export interface RunningServer {
  readonly http: Server;
  /** Closes every socket, cancels every timer and stops listening. */
  readonly close: () => Promise<void>;
}

/** The real clock. Its timers don't keep the process alive on their own. */
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(run, ms) {
    const timer = setTimeout(run, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export function createServer(options: ServerOptions): RunningServer {
  // A database this server opened itself is closed with it; one it was given belongs to the caller.
  const ownDatabase = options.database === undefined;
  const database = options.database ?? openDatabase({ file: IN_MEMORY, log: () => undefined });
  const clock = options.clock ?? realClock;
  const addressOf = options.addressOf ?? ((request: IncomingMessage) => request.socket.remoteAddress ?? "unknown");
  const site = createSite({ ...options, database, clock, addressOf, mail: options.mail ?? new RecordedMail() });
  const http = createHttpServer(site.app);
  const { stop } = attachRooms(http, {
    clock,
    addressOf,
    siteOrigin: options.siteOrigin,
    ...(options.maxRooms === undefined ? {} : { maxRooms: options.maxRooms }),
    ...(options.pingIntervalMs === undefined ? {} : { pingIntervalMs: options.pingIntervalMs }),
  });
  return {
    http,
    async close() {
      stop();
      site.stop();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      if (ownDatabase) database.close();
    },
  };
}

/**
 * The address a request came from when the server runs behind a proxy (Caddy) that puts it in
 * X-Forwarded-For: the rightmost entry, the one the proxy added. Caddy, trusting no one in front of
 * it, replaces any X-Forwarded-For a visitor sent with their address alone (index.test.ts); a proxy
 * that appends instead leaves the visitor's own text on the left, so never read the leftmost. Only
 * for that setup: without a proxy, anyone could write the header and dodge the per-address limits.
 */
export function forwardedAddress(request: IncomingMessage): string {
  const header = request.headers["x-forwarded-for"];
  const last = (Array.isArray(header) ? header.join(",") : (header ?? "")).split(",").at(-1)?.trim();
  return last !== undefined && last !== "" ? last : (request.socket.remoteAddress ?? "unknown");
}

export { createFrameServer, frameContentSecurityPolicy, inlineScriptHash, type FrameServerOptions } from "./frame-origin.js";
export { IN_MEMORY, openDatabase, transaction, type Database } from "./db/database.js";
export { RecordedMail, type Mail, type Message } from "./mail.js";
export { DEFAULT_MAX_ROOMS, Rooms, type Clock } from "./rooms.js";
export { MAX_SOCKETS_PER_ADDRESS, WEBSOCKET_PATH } from "./transport.js";
