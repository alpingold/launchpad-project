import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { Connection } from './connection.js';
import { parseClientMessage } from '../protocol/validate.js';
import { isAllowedOrigin } from './origin.js';
import { clientIp } from './clientIp.js';

// WebSocket close codes we use (defined by the WebSocket standard, RFC 6455).
const CLOSE_POLICY_VIOLATION = 1008; // client broke the rules (spam, garbage)
const CLOSE_GOING_AWAY = 1001; // server shutting down

/**
 * @typedef {Object} TransportHandlers
 * @property {(conn: Connection, msg: {type: string}) => void} onMessage
 *   Called with every message that passed validation and the rate limit.
 * @property {(conn: Connection) => void} [onDisconnect]
 *   Called once when a connection closes for any reason (left, crashed, heartbeat timeout).
 * @property {(req: import('node:http').IncomingMessage) => ({ id: number, username: string } | null)} [identify]
 *   Who is logged in, from the upgrade request's cookies (M7). Stored on the Connection.
 */

/**
 * Attaches a WebSocket server to an existing http.Server.
 *
 * This is the transport layer: it handles sockets, heartbeats, limits and errors,
 * and hands clean, validated messages to `handlers`. It knows nothing about rooms.
 *
 * @param {import('node:http').Server} httpServer
 * @param {TransportHandlers} handlers
 * @param {Partial<typeof config>} [overrides]  lets tests use e.g. a 50ms heartbeat
 */
export function attachWebSocketServer(httpServer, handlers, overrides = {}) {
  const cfg = { ...config, ...overrides };

  /** @type {Map<string, Connection>} every open connection, by id */
  const connections = new Map();
  /** @type {Map<string, number>} open sockets per IP address */
  const openPerIp = new Map();
  let nextId = 1;

  // `noServer: true` means WE decide which HTTP upgrade requests become WebSockets
  // (see the 'upgrade' handler below). That gives us one place to check the path now,
  // and the login cookie and Origin header in M7.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: cfg.WS_MAX_PAYLOAD_BYTES, // `ws` closes oversized frames with code 1009
  });

  function onUpgrade(req, socket, head) {
    // A network error on the raw socket during the handshake must not crash the server.
    socket.on('error', (err) => console.warn('[ws] upgrade socket error:', err.message));

    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== cfg.WS_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    // Only pages from our own site may connect (see origin.js: cross-site WebSocket hijacking).
    if (!isAllowedOrigin(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    // Only so many open sockets per address (plan §59).
    const ip = clientIp(req, cfg.TRUST_PROXY);
    if ((openPerIp.get(ip) ?? 0) >= cfg.MAX_CONNECTIONS_PER_IP) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  }
  httpServer.on('upgrade', onUpgrade);

  wss.on('connection', (ws, req, ip) => {
    const conn = new Connection(
      `c${nextId++}`,
      ws,
      { ratePerSec: cfg.RATE_LIMIT_PER_SEC, burst: cfg.RATE_LIMIT_BURST },
      { maxBufferedBytes: cfg.WS_MAX_BUFFERED_BYTES },
    );
    // The login is read once, when the socket opens. Logging out elsewhere doesn't affect an
    // already-open socket; it ends when the page closes or reloads.
    const user = handlers.identify?.(req) ?? null;
    conn.userId = user?.id ?? null;
    conn.username = user?.username ?? null;
    conn.ip = ip;
    openPerIp.set(ip, (openPerIp.get(ip) ?? 0) + 1);
    connections.set(conn.id, conn);

    // REQUIRED: in Node, an 'error' event with no listener crashes the whole process.
    // One misbehaving client (bad frame, reset connection) must only affect itself.
    ws.on('error', (err) => console.warn(`[ws] ${conn.id} error:`, err.message));

    ws.on('pong', () => {
      conn.isAlive = true;
    });

    ws.on('message', (data, isBinary) => handleFrame(conn, data, isBinary));

    ws.on('close', () => {
      connections.delete(conn.id);
      const left = (openPerIp.get(ip) ?? 1) - 1;
      if (left > 0) openPerIp.set(ip, left);
      else openPerIp.delete(ip);
      try {
        handlers.onDisconnect?.(conn);
      } catch (err) {
        console.error(`[ws] onDisconnect failed for ${conn.id}:`, err);
      }
    });
  });

  /** Runs for every frame a client sends: rate limit → validate → hand off. */
  function handleFrame(conn, data, isBinary) {
    // 1. Rate limit. Over the limit: drop the message. Only the first drop in a row
    //    gets an error reply, so a spammer can't make us send a flood back.
    if (!conn.rateLimiter.tryRemoveToken()) {
      conn.rateLimitStrikes++;
      if (conn.rateLimitStrikes === 1) conn.sendError('RATE_LIMITED');
      if (conn.rateLimitStrikes >= cfg.MAX_RATE_LIMIT_STRIKES) {
        conn.ws.close(CLOSE_POLICY_VIOLATION, 'rate limit');
      }
      return;
    }
    conn.rateLimitStrikes = 0;

    // 2. Validate. Bad messages get an error reply and the socket stays open,
    //    but too many of them means the client is broken or hostile.
    const result = parseClientMessage(data, { isBinary });
    if (!result.ok) {
      conn.badMessageCount++;
      conn.sendError(result.code, { requestType: result.requestType, field: result.field });
      if (conn.badMessageCount > cfg.MAX_BAD_MESSAGES) {
        conn.ws.close(CLOSE_POLICY_VIOLATION, 'too many invalid messages');
      }
      return;
    }

    // 3. Hand off. If OUR code has a bug and throws, log it and tell the client,
    //    but keep the server (and everyone else's game) running.
    try {
      handlers.onMessage(conn, result.msg);
    } catch (err) {
      console.error(`[ws] handler failed for ${conn.id} (${result.msg.type}):`, err);
      conn.sendError('INTERNAL_ERROR', { requestType: result.msg.type });
    }
  }

  // Heartbeat: phones that lose signal or sleep often vanish without closing the socket.
  // Every interval: anyone who didn't answer the last ping is terminated (which fires
  // 'close' → onDisconnect, the normal cleanup path). Everyone else gets a new ping.
  // Browsers answer pings automatically; no client code is needed.
  const heartbeat = setInterval(() => {
    for (const conn of connections.values()) {
      if (!conn.isAlive) {
        conn.ws.terminate();
        continue;
      }
      conn.isAlive = false;
      conn.ws.ping();
    }
  }, cfg.HEARTBEAT_INTERVAL_MS);

  /** Stops the heartbeat and closes every connection (used on shutdown and in tests). */
  function close() {
    clearInterval(heartbeat);
    httpServer.off('upgrade', onUpgrade);
    for (const conn of connections.values()) conn.ws.close(CLOSE_GOING_AWAY, 'server shutting down');
    wss.close();
  }

  return { connections, close };
}
