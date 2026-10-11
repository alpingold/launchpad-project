import http from 'node:http';
import { createApp } from './http/app.js';
import { attachWebSocketServer } from './transport/wsServer.js';
import { RoomManager } from './rooms/RoomManager.js';
import { createRouter } from './router.js';

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
 */
export function createGameServer(overrides = {}) {
  const httpServer = http.createServer(createApp());

  // RoomManager needs a way to send messages, but the transport (which owns the sockets)
  // is created after it. This function only runs later, once `transport` exists,
  // so it's safe to refer to it here.
  const rooms = new RoomManager({
    send: (connId, msg) => transport.connections.get(connId)?.send(msg),
  });

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
    transport.close();
    httpServer.closeAllConnections();
    return new Promise((resolve) => httpServer.close(resolve));
  }

  return { httpServer, rooms, transport, close };
}
