import { CLIENT } from './protocol/messageTypes.js';
import { RoomError } from './rooms/RoomError.js';

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
 * @param {import('./rooms/RoomManager.js').RoomManager} rooms
 */
export function createRouter(rooms) {
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
    [CLIENT.HOST_START_GAME]: {
      sender: 'host',
      run: (conn, msg) => rooms.startGame(conn.id, msg.gameId, msg.options ?? {}),
    },
    [CLIENT.GAME_ACTION]: { sender: 'player', run: (conn, msg) => rooms.handleGameAction(conn.id, msg.action) },
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

      try {
        route.run(conn, msg);
      } catch (err) {
        // Expected failures (room full, name taken, ...) become a normal error reply.
        // Anything else is a bug: rethrow so the transport logs it and sends INTERNAL_ERROR.
        if (err instanceof RoomError) conn.sendError(err.code, { requestType });
        else throw err;
      }
    },

    /** @param {import('./transport/connection.js').Connection} conn */
    handleDisconnect(conn) {
      rooms.handleDisconnect(conn.id);
    },
  };
}
