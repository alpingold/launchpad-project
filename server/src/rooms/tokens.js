import { randomBytes } from 'node:crypto';

/**
 * A new secret token: 16 random bytes (128 bits) as 22 URL-safe characters.
 *
 * Tokens prove "I am the host of this room" or "I am this player" when a browser
 * reconnects after a refresh. They are secrets, so they must come from crypto
 * (unguessable), never from Math.random, and must never appear in a broadcast.
 */
export function newToken() {
  return randomBytes(16).toString('base64url');
}
