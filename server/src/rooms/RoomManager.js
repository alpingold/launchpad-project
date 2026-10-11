import { randomInt as cryptoRandomInt } from 'node:crypto';
import { config } from '../config.js';
import { SERVER } from '../protocol/messageTypes.js';
import { Room } from './Room.js';
import { RoomError } from './RoomError.js';
import { generateRoomCode } from './roomCode.js';
import { newToken } from './tokens.js';

/**
 * @typedef {Object} Membership   what a connection is doing right now
 * @property {string} code               room code
 * @property {'host' | 'player'} role
 * @property {string | null} playerId    set when role is 'player' (M3)
 */

/**
 * Owns every room on the server and all the rules for changing them.
 *
 * It does NOT import `ws` or know what a socket is. It talks to the outside world only
 * through the `send(connId, msg)` function it is given. That's why tests can drive it
 * with plain function calls and a fake `send` that just records messages.
 */
export class RoomManager {
  /**
   * @param {Object} deps
   * @param {(connId: string, msg: object) => void} deps.send  delivers a message to one connection
   * @param {(max: number) => number} [deps.randomInt]  for room codes (tests inject a fixed sequence)
   * @param {() => number} [deps.now]
   * @param {number} [deps.maxRooms]
   */
  constructor({ send, randomInt = cryptoRandomInt, now = Date.now, maxRooms = config.MAX_ROOMS }) {
    this.send = send;
    this.randomInt = randomInt;
    this.now = now;
    this.maxRooms = maxRooms;

    /** @type {Map<string, Room>} every live room, by code */
    this.rooms = new Map();

    /** @type {Map<string, Membership>} which room each connection is in, by connection id */
    this.members = new Map();
  }

  /** @returns {Membership | undefined} */
  getMembership(connId) {
    return this.members.get(connId);
  }

  /** @returns {Room | undefined} */
  getRoom(code) {
    return this.rooms.get(code);
  }

  // --- Requests from clients --------------------------------------------------

  /** host:create_room — makes a new room with this connection as its host. */
  createRoom(connId) {
    // The router already checks this; repeating it here keeps RoomManager safe on its own.
    if (this.members.has(connId)) throw new RoomError('ALREADY_IN_ROOM');
    if (this.rooms.size >= this.maxRooms) throw new RoomError('SERVER_FULL');

    const code = generateRoomCode((c) => this.rooms.has(c), this.randomInt);
    const room = new Room(code, { hostToken: newToken(), hostConnId: connId, now: this.now() });

    this.rooms.set(code, room);
    this.members.set(connId, { code, role: 'host', playerId: null });

    // The host token goes ONLY to the host, in this one message. It's what lets the
    // host reclaim the room after a page refresh (M4).
    this.send(connId, { type: SERVER.ROOM_CREATED, code, hostToken: room.host.token });
    this.broadcastState(room);
    return room;
  }

  // --- Connection events ------------------------------------------------------

  /** Called by the transport whenever a socket closes, for any reason. */
  handleDisconnect(connId) {
    const membership = this.members.get(connId);
    if (!membership) return; // never joined anything; nothing to clean up
    this.members.delete(connId);

    const room = this.rooms.get(membership.code);
    if (!room) return;

    if (membership.role === 'host') {
      // TEMPORARY (M2): the room closes as soon as the host's socket closes.
      // M4 replaces this with a 30-second grace period so a refresh doesn't end the party.
      room.host.connId = null;
      this.closeRoom(room, 'host_left');
    }
  }

  // --- Helpers ----------------------------------------------------------------

  /** Sends the current public room state to everyone connected to the room. */
  broadcastState(room) {
    const msg = { type: SERVER.ROOM_STATE, ...room.toPublicState() };
    for (const connId of room.connectedIds()) this.send(connId, msg);
  }

  /**
   * Ends a room: tells everyone still connected why, frees their memberships so they can
   * join or create another room on the same socket, and forgets the room.
   * @param {Room} room
   * @param {'host_left' | 'host_timeout' | 'idle'} reason
   */
  closeRoom(room, reason) {
    room.phase = 'closed';
    for (const connId of room.connectedIds()) {
      this.send(connId, { type: SERVER.ROOM_CLOSED, reason });
      this.members.delete(connId);
    }
    this.rooms.delete(room.code);
  }
}
