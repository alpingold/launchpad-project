import { WebSocket } from 'ws';
import { TokenBucket } from './rateLimiter.js';
import { makeError } from '../protocol/errors.js';

/**
 * Everything the server knows about one open WebSocket.
 *
 * The room layer never touches `ws` directly. It refers to connections by `id`
 * and asks the transport to send messages, which keeps sockets out of room logic.
 */
export class Connection {
  /**
   * @param {string} id     unique per connection, e.g. "c7"
   * @param {WebSocket} ws
   * @param {{ ratePerSec: number, burst: number }} rateLimit
   */
  constructor(id, ws, rateLimit) {
    this.id = id;
    this.ws = ws;

    // Heartbeat: set to false when we ping, back to true when the pong arrives.
    this.isAlive = true;

    // Note: which room this connection is in (and as host or player) is NOT stored here.
    // RoomManager owns that, so there is exactly one copy of the truth. See RoomManager.members.

    // Filled in from the login cookie at connect time (M7).
    this.userId = null;
    this.username = null;

    // Abuse tracking.
    this.badMessageCount = 0;
    this.rateLimitStrikes = 0;
    this.rateLimiter = new TokenBucket(rateLimit);
  }

  /**
   * Sends a message object as JSON. Silently does nothing if the socket is no longer open:
   * a player who just disconnected shouldn't cause errors for everyone else's broadcast.
   * @returns {boolean} whether the message was handed to the socket
   */
  send(msg) {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Shorthand for sending an `error` message. */
  sendError(code, details) {
    return this.send(makeError(code, details));
  }
}
