import { CLIENT } from './protocol/messageTypes.js';
import { RoomError } from './rooms/RoomError.js';
import { AttemptLimiter } from './auth/attemptLimiter.js';
import { config } from './config.js';

// Requests that need a room code or a token, and the answers that mean it was wrong
// (plan §59): those count toward the limits on guessing (config.JOIN_FAILURES_*).
const GUESSABLE = new Set([CLIENT.HOST_RESUME, CLIENT.PLAYER_JOIN, CLIENT.PLAYER_RESUME]);
const WRONG_GUESS = new Set(['ROOM_NOT_FOUND', 'INVALID_TOKEN', 'SESSION_EXPIRED']);
const CLOSE_POLICY_VIOLATION = 1008;

/**
 * Who is allowed to send a message type:
 *  - 'outsider': a connection not in any room yet (creating or joining one)
 *  - 'host':     the host of the room this connection is in
 *  - 'player':   a player in the room this connection is in
 *  - 'member':   host or player
 * @typedef {'outsider' | 'host' | 'player' | 'member'} Sender
 */

/**
 * Routes each validated message to the RoomManager.
 *
 * The router answers "WHO may send this?" (from the table below).
 * RoomManager answers "is this allowed RIGHT NOW?" (room exists, name free, ...).
 *
 * Wrong room codes and tokens are counted per IP address and per socket: past the limit, an
 * address gets TOO_MANY_ATTEMPTS for a while, and a socket is closed.
 *
 * @param {import('./rooms/RoomManager.js').RoomManager} rooms
 * @param {{ cfg?: typeof config }} [opts]
 */
export function createRouter(rooms, { cfg = config } = {}) {
  const wrongGuesses = new AttemptLimiter({ max: cfg.JOIN_FAILURES_PER_WINDOW, windowMs: cfg.JOIN_FAILURES_WINDOW_MS });

  function countWrongGuess(conn) {
    wrongGuesses.record(conn.ip);
    conn.failedJoins = (conn.failedJoins ?? 0) + 1;
    if (conn.failedJoins >= cfg.MAX_JOIN_FAILURES_PER_CONNECTION) conn.ws.close(CLOSE_POLICY_VIOLATION, 'too many wrong codes');
  }

  /** @type {Record<string, { sender: Sender, run: (conn: any, msg: any) => void }>} */
  const routes = {
    [CLIENT.HOST_CREATE_ROOM]: {
      sender: 'outsider',
      run: (conn) => {
        // Hosting needs an account (M7); the login comes from the cookie when the socket opened.
        if (conn.userId === null || conn.userId === undefined) throw new RoomError('NOT_AUTHENTICATED');
        rooms.createRoom(conn.id, { userId: conn.userId });
      },
    },
    [CLIENT.HOST_RESUME]: { sender: 'outsider', run: (conn, msg) => rooms.resumeHost(conn.id, msg.code, msg.hostToken) },
    [CLIENT.PLAYER_JOIN]: { sender: 'outsider', run: (conn, msg) => rooms.joinRoom(conn.id, msg.code, msg.name) },
    [CLIENT.PLAYER_RESUME]: { sender: 'outsider', run: (conn, msg) => rooms.resumePlayer(conn.id, msg.code, msg.token) },
    [CLIENT.ROOM_LEAVE]: { sender: 'member', run: (conn) => rooms.leaveRoom(conn.id) },
    [CLIENT.HOST_KICK]: { sender: 'host', run: (conn, msg) => rooms.kickPlayer(conn.id, msg.playerId) },
    [CLIENT.HOST_START_GAME]: { sender: 'host', run: (conn, msg) => rooms.startGame(conn.id, msg.gameId) },
    [CLIENT.HOST_STOP_GAME]: { sender: 'host', run: (conn, msg) => rooms.stopGameByHost(conn.id, msg.reason) },
    // Frame games (plan §13f): phones talk to the big screen, the big screen to phones.
    [CLIENT.GAME_EVENT]: { sender: 'player', run: (conn, msg) => rooms.handleGameEvent(conn.id, msg.data) },
    [CLIENT.GAME_BATCH]: { sender: 'host', run: (conn, msg) => rooms.handleHostGameBatch(conn.id, msg.items, msg.save) },
    [CLIENT.GAME_ALIVE]: { sender: 'host', run: (conn, msg) => rooms.handleHostGameAlive(conn.id, { paused: msg.paused }) },
    [CLIENT.GAME_END]: {
      sender: 'host',
      run: (conn, msg) => rooms.handleHostGameEnd(conn.id, { rankings: msg.rankings, scores: msg.scores }),
    },
  };

  /** Returns an error code if this connection may not send this kind of message, else null. */
  function checkSender(sender, membership) {
    if (sender === 'outsider') return membership ? 'ALREADY_IN_ROOM' : null;
    if (!membership) return 'NOT_IN_ROOM';
    if (sender === 'host' && membership.role !== 'host') return 'NOT_HOST';
    if (sender === 'player' && membership.role !== 'player') return 'WRONG_PHASE';
    return null;
  }

  return {
    /**
     * @param {import('./transport/connection.js').Connection} conn
     * @param {{ type: string }} msg  already validated by protocol/validate.js
     */
    handleMessage(conn, msg) {
      const requestType = msg.type;
      const route = Object.hasOwn(routes, requestType) ? routes[requestType] : null;
      if (!route) {
        conn.sendError('NOT_SUPPORTED', { requestType });
        return;
      }

      const senderError = checkSender(route.sender, rooms.getMembership(conn.id));
      if (senderError) {
        conn.sendError(senderError, { requestType });
        return;
      }

      const guessable = GUESSABLE.has(requestType);
      if (guessable && wrongGuesses.isBlocked(conn.ip)) {
        conn.sendError('TOO_MANY_ATTEMPTS', { requestType });
        return;
      }

      try {
        route.run(conn, msg);
      } catch (err) {
        // Expected failures (room full, name taken, ...) become a normal error reply.
        // Anything else is a bug: rethrow so the transport logs it and sends INTERNAL_ERROR.
        if (!(err instanceof RoomError)) throw err;
        conn.sendError(err.code, { requestType });
        if (guessable && WRONG_GUESS.has(err.code)) countWrongGuess(conn);
      }
    },

    /** @param {import('./transport/connection.js').Connection} conn */
    handleDisconnect(conn) {
      rooms.handleDisconnect(conn.id);
    },
  };
}
