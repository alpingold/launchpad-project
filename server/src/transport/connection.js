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
   * @param {{ maxBufferedBytes?: number }} [limits]  unsent data held for this socket before it's dropped
   */
  constructor(id, ws, rateLimit, { maxBufferedBytes = Infinity } = {}) {
    this.id = id;
    this.ws = ws;
    this.maxBufferedBytes = maxBufferedBytes;

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
   * A socket that isn't reading what it's sent (more than maxBufferedBytes waiting) is
   * dropped instead (plan §59): terminate(), not close(), since a close message would only
   * wait behind the rest. Its 'close' event then cleans up as for any disconnect.
   * @returns {boolean} whether the message was handed to the socket
   */
  send(msg) {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    const json = JSON.stringify(msg);
    if (this.ws.bufferedAmount + Buffer.byteLength(json) > this.maxBufferedBytes) {
      console.warn(`[ws] ${this.id} isn't reading its messages (${this.ws.bufferedAmount} bytes waiting): dropped`);
      this.ws.terminate();
      return false;
    }
    this.ws.send(json);
    return true;
  }

  /** Shorthand for sending an `error` message. */
  sendError(code, details) {
    return this.send(makeError(code, details));
  }
}
