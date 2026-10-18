import http from 'node:http';
import { config } from './config.js';
import { createApp } from './http/app.js';
import { attachWebSocketServer } from './transport/wsServer.js';
import { RoomManager } from './rooms/RoomManager.js';
import { createRouter } from './router.js';
import { createDefaultRegistry } from './games/index.js';
import { openDatabase } from './db/database.js';
import { GenerationService } from './generation/service.js';
import { BrowserSlot } from './generation/browserSlot.js';
import { createKeyVault } from './auth/keyVault.js';
import { createUserKeys } from './generation/userKeys.js';
import { randomBytes } from 'node:crypto';
import { deleteExpiredSessions } from './db/sessions.js';
import { currentUser } from './auth/currentUser.js';

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
 * @param {Object} [deps]
 * @param {import('./games/registry.js').GameRegistry} [deps.games]  tests pass their own games
 * @param {import('better-sqlite3').Database} [deps.db]  index.js passes the real database file;
 *   tests leave it out and get a fresh in-memory database
 * @param {typeof import('./generation/sandbox.js').runGeneratorInSandbox} [deps.runGenerator]  tests pass a fake instead of the real OpenShell sandbox
 * @param {Buffer} [deps.keySecret]  opens users' saved GenAI Studio keys (index.js loads the real one; tests get a random one)
 * @param {(key: string) => Promise<'ok' | 'rejected' | 'unreachable'>} [deps.checkKey]  tests pass a fake GenAI Studio key check
 */
export function createGameServer(overrides = {}, { games = createDefaultRegistry(), db, runGenerator, keySecret = randomBytes(32), checkKey } = {}) {
  const cfg = { ...config, ...overrides };
  const ownsDb = !db;
  db ??= openDatabase(':memory:');

  // AI-generated games (plan §11): a queue that runs the generator in OpenShell sandboxes.
  const userKeys = createUserKeys({ db, vault: createKeyVault(keySecret), checkKey });
  const generation = new GenerationService({
    db,
    games,
    enabled: cfg.GENERATION_ENABLED,
    runGenerator,
    userKeys,
    maxRunning: cfg.GENERATION_MAX_RUNNING,
    browserSlot: new BrowserSlot({ size: cfg.GENERATION_BROWSER_CHECKS, maxHoldMs: cfg.GENERATION_BROWSER_MAX_HOLD_MS }),
  });
  generation.recoverInterrupted(); // anything "generating" was cut off by the last restart

  // For /api/status (deploy/update.sh). Like `send` below, it only runs once `rooms` and
  // `transport` exist.
  const activity = () => ({
    rooms: rooms.rooms.size,
    playing: [...rooms.rooms.values()].filter((room) => room.phase === 'in_game').length,
    connections: transport.connections.size,
    generating: generation.running.size + generation.queue.length,
  });
  const httpServer = http.createServer(createApp({ games, db, cfg, generation, userKeys, activity }));

  // RoomManager needs a way to send messages, but the transport (which owns the sockets)
  // is created after it. This function only runs later, once `transport` exists,
  // so it's safe to refer to it here.
  const rooms = new RoomManager({
    send: (connId, msg) => transport.connections.get(connId)?.send(msg),
    hostGraceMs: cfg.HOST_GRACE_MS,
    playerGraceMs: cfg.PLAYER_GRACE_MS,
    roomIdleMs: cfg.ROOM_IDLE_MS,
    gameWatchdogMs: cfg.GAME_WATCHDOG_MS,
    games,
  });

  // Every few minutes, close rooms nobody has touched in hours, and clear out expired logins.
  const sweeper = setInterval(() => {
    rooms.sweepIdleRooms();
    deleteExpiredSessions(db);
  }, cfg.ROOM_SWEEP_INTERVAL_MS);

  const router = createRouter(rooms);

  const transport = attachWebSocketServer(
    httpServer,
    {
      onMessage: (conn, msg) => router.handleMessage(conn, msg),
      onDisconnect: (conn) => router.handleDisconnect(conn),
      // Who's logged in, from the login cookie sent with the WebSocket upgrade.
      identify: (req) => currentUser(db, req.headers.cookie).user,
    },
    overrides,
  );

  /** Stops everything (tests use this between runs; index.js on shutdown). */
  function close() {
    clearInterval(sweeper);
    rooms.dispose(); // pending grace timers would otherwise keep the process alive
    transport.close();
    httpServer.closeAllConnections();
    return new Promise((resolve) => httpServer.close(resolve)).then(() => {
      if (ownsDb) db.close();
    });
  }

  return { httpServer, rooms, transport, db, generation, close };
}
