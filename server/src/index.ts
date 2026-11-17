/**
 * The server: the site (HTTP and Rooms over WebSockets) on one port. The game domain, which serves
 * only the Game frame, is a separate server (createFrameServer) on its own port or domain.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import type { Clock } from "./rooms.js";
import { createSite, type SiteOptions } from "./site.js";
import { attachRooms } from "./transport.js";

export interface ServerOptions extends SiteOptions {
  /** The real clock unless a test passes its own. */
  readonly clock?: Clock;
  /** Where a socket came from, for the join limit. The socket's own address unless set. */
  readonly addressOf?: (request: IncomingMessage) => string;
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
  const http = createHttpServer(createSite(options));
  const { stop } = attachRooms(http, {
    clock: options.clock ?? realClock,
    addressOf: options.addressOf ?? ((request) => request.socket.remoteAddress ?? "unknown"),
  });
  return {
    http,
    async close() {
      stop();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/**
 * The address a request came from when the server runs behind a proxy (Caddy) that appends it to
 * X-Forwarded-For: the last entry, the one the proxy added. Only for that setup: without a proxy,
 * anyone could write the header and dodge the join limit.
 */
export function forwardedAddress(request: IncomingMessage): string {
  const header = request.headers["x-forwarded-for"];
  const last = (Array.isArray(header) ? header.join(",") : (header ?? "")).split(",").at(-1)?.trim();
  return last !== undefined && last !== "" ? last : (request.socket.remoteAddress ?? "unknown");
}

export { createFrameServer, frameContentSecurityPolicy, inlineScriptHash, type FrameServerOptions } from "./frame-origin.js";
export { Rooms, type Clock } from "./rooms.js";
export { WEBSOCKET_PATH } from "./transport.js";
