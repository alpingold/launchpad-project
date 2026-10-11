import http from 'node:http';
import { config } from './config.js';
import { createApp } from './http/app.js';
import { attachWebSocketServer } from './transport/wsServer.js';
import { RoomManager } from './rooms/RoomManager.js';
import { createRouter } from './router.js';
import { createDefaultRegistry } from './games/index.js';

/**
 * Builds the whole server (HTTP + WebSocket + rooms) without starting to listen.
 * index.js calls this for the real server; integration tests call it to get a fresh
 * server on a random port.
 *
 * How the layers connect:
 *   socket frame → transport (validate, limits) → router (who may send?) → RoomManager (rules)
 *   RoomManager → send(connId, msg) → transport → socket
 *
 * @param {Partial<typeof import('./config.js').config>} [overrides]  e.g. a short heartbeat in tests
 * @param {{ games?: import('./games/registry.js').GameRegistry }} [deps]  tests pass their own games
 */
export function createGameServer(overrides = {}, { games = createDefaultRegistry() } = {}) {
  const cfg = { ...config, ...overrides };
  const httpServer = http.createServer(createApp({ games }));

  // RoomManager needs a way to send messages, but the transport (which owns the sockets)
  // is created after it. This function only runs later, once `transport` exists,
  // so it's safe to refer to it here.
  const rooms = new RoomManager({
    send: (connId, msg) => transport.connections.get(connId)?.send(msg),
    hostGraceMs: cfg.HOST_GRACE_MS,
    playerGraceMs: cfg.PLAYER_GRACE_MS,
    roomIdleMs: cfg.ROOM_IDLE_MS,
    games,
  });

  // Every few minutes, close rooms nobody has touched in hours.
  const sweeper = setInterval(() => rooms.sweepIdleRooms(), cfg.ROOM_SWEEP_INTERVAL_MS);

  const router = createRouter(rooms);

  const transport = attachWebSocketServer(
    httpServer,
    {
      onMessage: (conn, msg) => router.handleMessage(conn, msg),
      onDisconnect: (conn) => router.handleDisconnect(conn),
    },
    overrides,
  );

  /** Stops everything (tests use this between runs; index.js on shutdown). */
  function close() {
    clearInterval(sweeper);
    rooms.dispose(); // pending grace timers would otherwise keep the process alive
    transport.close();
    httpServer.closeAllConnections();
    return new Promise((resolve) => httpServer.close(resolve));
  }

  return { httpServer, rooms, transport, close };
}
