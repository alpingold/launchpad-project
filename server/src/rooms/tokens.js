import { randomBytes, timingSafeEqual } from 'node:crypto';

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

/**
 * Compares a token from a client with the real one.
 *
 * A normal `===` stops at the first different character, so in theory an attacker could
 * time many guesses to learn a token one character at a time. timingSafeEqual always
 * takes the same time. Over a WebSocket this attack is impractical, but the safe version
 * costs nothing, so we use it for every secret comparison.
 */
export function tokensEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * A new PUBLIC player id like "p_3f9a01bc". Not a secret: it's broadcast to everyone in
 * the room so they can refer to players (kick, game moves). Only needs to be unique
 * within a room; RoomManager checks for the (very unlikely) collision.
 */
export function newPlayerId() {
  return `p_${randomBytes(4).toString('hex')}`;
}
