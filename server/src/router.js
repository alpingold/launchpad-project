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
    [CLIENT.HOST_CREATE_ROOM]: { sender: 'outsider', run: (conn) => rooms.createRoom(conn.id) },
    // M3: player:join · M4: host:resume, player:resume, room:leave, host:kick · M5: host:start_game, game:action
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
