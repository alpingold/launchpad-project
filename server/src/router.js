import { SERVER } from './protocol/messageTypes.js';

/**
 * Decides what to do with each validated message.
 *
 * TEMPORARY (M1): every valid message is echoed back as `debug:echo` so you can see
 * exactly what the validator produced (trimmed/uppercased code, extra fields dropped).
 * In M2 this becomes a table mapping each message type to a RoomManager method,
 * plus the "who may send this" checks (host vs player).
 */
export function createRouter() {
  return {
    /** @param {import('./transport/connection.js').Connection} conn */
    handleMessage(conn, msg) {
      conn.send({ type: SERVER.DEBUG_ECHO, connectionId: conn.id, received: msg });
    },

    /** @param {import('./transport/connection.js').Connection} conn */
    handleDisconnect(conn) {
      console.log(`[router] ${conn.id} disconnected`);
    },
  };
}
