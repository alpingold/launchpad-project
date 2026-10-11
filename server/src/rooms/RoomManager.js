import { randomInt as cryptoRandomInt } from 'node:crypto';
import { config } from '../config.js';
import { SERVER } from '../protocol/messageTypes.js';
import { Room } from './Room.js';
import { RoomError } from './RoomError.js';
import { generateRoomCode } from './roomCode.js';
import { newToken, newPlayerId, tokensEqual } from './tokens.js';
import { validateName } from './names.js';

/**
 * @typedef {Object} Membership   what a connection is doing right now
 * @property {string} code               room code
 * @property {'host' | 'player'} role
 * @property {string | null} playerId    set when role is 'player'
 */

/**
 * Why a room (or one person's place in it) ended. Sent in `room:closed`.
 * @typedef {'host_left' | 'host_timeout' | 'idle' | 'left' | 'kicked' | 'replaced'} ClosedReason
 */

/**
 * Owns every room on the server and all the rules for changing them.
 *
 * It does NOT import `ws` or know what a socket is. It talks to the outside world only
 * through the `send(connId, msg)` function it is given. That's why tests can drive it
 * with plain function calls and a fake `send` that just records messages.
 *
 * Grace timers use the global setTimeout/clearTimeout and time comes from `now()`,
 * so tests can replace both with node:test's mock timers and skip ahead 30 seconds instantly.
 */
export class RoomManager {
  /**
   * @param {Object} deps
   * @param {(connId: string, msg: object) => void} deps.send  delivers a message to one connection
   * @param {(max: number) => number} [deps.randomInt]  for room codes (tests inject a fixed sequence)
   * @param {() => number} [deps.now]
   * @param {number} [deps.maxRooms]
   * @param {number} [deps.hostGraceMs]
   * @param {number} [deps.playerGraceMs]
   * @param {number} [deps.roomIdleMs]
   */
  constructor({
    send,
    randomInt = cryptoRandomInt,
    now = () => Date.now(),
    maxRooms = config.MAX_ROOMS,
    hostGraceMs = config.HOST_GRACE_MS,
    playerGraceMs = config.PLAYER_GRACE_MS,
    roomIdleMs = config.ROOM_IDLE_MS,
  }) {
    this.send = send;
    this.randomInt = randomInt;
    this.now = now;
    this.maxRooms = maxRooms;
    this.hostGraceMs = hostGraceMs;
    this.playerGraceMs = playerGraceMs;
    this.roomIdleMs = roomIdleMs;

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

    // The host token goes ONLY to the host. It's what lets the host reclaim the room
    // after a page refresh (see resumeHost).
    this.send(connId, { type: SERVER.ROOM_CREATED, code, hostToken: room.host.token });
    this.broadcastState(room);
    return room;
  }

  /**
   * host:resume — a host reconnects (page refresh, laptop woke up) and reclaims their room.
   * Must prove they're the host with the secret token from room:created.
   */
  resumeHost(connId, code, hostToken) {
    if (this.members.has(connId)) throw new RoomError('ALREADY_IN_ROOM');
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND');
    if (!tokensEqual(room.host.token, hostToken)) throw new RoomError('INVALID_TOKEN');

    // The same host is still connected somewhere else (a second tab): newest tab wins.
    if (room.host.connId) this.detach(room.host.connId, 'replaced');

    this.cancelTimer(room.host);
    room.host.connId = connId;
    room.lastActivityAt = this.now();
    this.members.set(connId, { code, role: 'host', playerId: null });

    this.send(connId, { type: SERVER.ROOM_CREATED, code, hostToken: room.host.token });
    this.broadcastState(room); // everyone sees hostConnected: true again
    return room;
  }

  /**
   * player:join — adds this connection to a room as a new player.
   * Checks run in the order a person would want to hear about them:
   * wrong code → game already running → room full → bad name → name taken.
   */
  joinRoom(connId, code, rawName) {
    if (this.members.has(connId)) throw new RoomError('ALREADY_IN_ROOM');

    const room = this.rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND');
    if (room.phase !== 'lobby') throw new RoomError('GAME_IN_PROGRESS');
    // Disconnected players still waiting out their grace period count: their spot is reserved.
    if (room.players.size >= room.maxPlayers) throw new RoomError('ROOM_FULL');

    const checked = validateName(rawName);
    if (!checked.ok) throw new RoomError('NAME_INVALID');
    for (const player of room.players.values()) {
      if (player.nameKey === checked.nameKey) throw new RoomError('NAME_TAKEN');
    }

    let playerId = newPlayerId();
    while (room.players.has(playerId)) playerId = newPlayerId();

    /** @type {import('./Room.js').Player} */
    const player = {
      id: playerId,
      token: newToken(), // SECRET: lets this player reclaim their spot after a refresh
      name: checked.name,
      nameKey: checked.nameKey,
      connId,
      connected: true,
      graceTimer: null,
      joinedAt: this.now(),
    };
    room.players.set(playerId, player);
    room.lastActivityAt = this.now();
    this.members.set(connId, { code, role: 'player', playerId });

    // The token goes only to this player; everyone (including them) gets the new list.
    this.send(connId, { type: SERVER.ROOM_JOINED, code, playerId, token: player.token, name: player.name });
    this.broadcastState(room);
    return player;
  }

  /**
   * player:resume — a player reconnects and gets their old spot (same id, same name) back.
   * Allowed even during a game: it's the same player returning, not a new one joining.
   */
  resumePlayer(connId, code, token) {
    if (this.members.has(connId)) throw new RoomError('ALREADY_IN_ROOM');
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND');

    // At most 12 players, so a simple loop is clearer than keeping a separate token index.
    const player = [...room.players.values()].find((p) => tokensEqual(p.token, token));
    if (!player) throw new RoomError('SESSION_EXPIRED');

    // Still connected in another tab: newest tab wins.
    if (player.connId) this.detach(player.connId, 'replaced');

    this.cancelTimer(player);
    player.connId = connId;
    player.connected = true;
    room.lastActivityAt = this.now();
    this.members.set(connId, { code, role: 'player', playerId: player.id });

    this.send(connId, { type: SERVER.ROOM_JOINED, code, playerId: player.id, token: player.token, name: player.name });
    this.broadcastState(room);
    return player;
  }

  /**
   * room:leave — a deliberate exit (a button press), unlike a disconnect.
   * Host: ends the room for everyone now. Player: removed now, no grace period.
   */
  leaveRoom(connId) {
    const membership = this.members.get(connId);
    if (!membership) throw new RoomError('NOT_IN_ROOM');
    const room = this.rooms.get(membership.code);

    if (membership.role === 'host') {
      this.closeRoom(room, 'host_left');
      return;
    }
    this.detach(connId, 'left');
    this.removePlayer(room, membership.playerId);
    this.broadcastState(room);
  }

  /** host:kick — the host removes a player (e.g. an inappropriate name). */
  kickPlayer(hostConnId, playerId) {
    const membership = this.members.get(hostConnId);
    if (membership?.role !== 'host') throw new RoomError('NOT_HOST');
    const room = this.rooms.get(membership.code);

    const player = room.players.get(playerId);
    if (!player) throw new RoomError('PLAYER_NOT_FOUND');

    if (player.connId) this.detach(player.connId, 'kicked');
    // Removing the player also throws away their token, so they can't resume their way back in.
    // (They could join again under a new name; a ban list is a possible later feature.)
    this.removePlayer(room, playerId);
    this.broadcastState(room);
  }

  // --- Connection events ------------------------------------------------------

  /**
   * Called by the transport whenever a socket closes, for any reason (tab closed,
   * refresh, phone asleep, heartbeat timeout). Unlike leaveRoom, this might be temporary,
   * so the person's place is held for a grace period instead of being removed.
   */
  handleDisconnect(connId) {
    const membership = this.members.get(connId);
    if (!membership) return; // never joined anything, or already detached
    this.members.delete(connId);

    const room = this.rooms.get(membership.code);
    if (!room) return;
    room.lastActivityAt = this.now();

    if (membership.role === 'host') {
      room.host.connId = null;
      room.host.graceTimer = setTimeout(() => this.closeRoom(room, 'host_timeout'), this.hostGraceMs);
    } else {
      const player = room.players.get(membership.playerId);
      player.connId = null;
      player.connected = false;
      // In the lobby, an empty spot blocks the name and a slot, so it expires.
      // During a game, the spot is kept until the game ends (decision D6).
      if (room.phase === 'lobby') {
        player.graceTimer = setTimeout(() => {
          this.removePlayer(room, player.id);
          this.broadcastState(room);
        }, this.playerGraceMs);
      }
    }
    this.broadcastState(room); // others see "disconnected" right away
  }

  /**
   * Closes rooms nobody has touched for a long time (e.g. a host page left open overnight).
   * server.js calls this on an interval.
   * @returns {number} how many rooms were closed
   */
  sweepIdleRooms() {
    const cutoff = this.now() - this.roomIdleMs;
    let closed = 0;
    for (const room of [...this.rooms.values()]) {
      if (room.lastActivityAt < cutoff) {
        this.closeRoom(room, 'idle');
        closed++;
      }
    }
    return closed;
  }

  /** Cancels every pending timer (server shutdown and tests), so nothing fires afterwards. */
  dispose() {
    for (const room of this.rooms.values()) this.cancelRoomTimers(room);
  }

  // --- Helpers ----------------------------------------------------------------

  /** Sends the current public room state to everyone connected to the room. */
  broadcastState(room) {
    const msg = { type: SERVER.ROOM_STATE, ...room.toPublicState() };
    for (const connId of room.connectedIds()) this.send(connId, msg);
  }

  /**
   * Ends a room: cancels its timers, tells everyone still connected why, frees their
   * memberships so they can join or create another room on the same socket, and
   * forgets the room.
   * @param {Room} room
   * @param {ClosedReason} reason
   */
  closeRoom(room, reason) {
    this.cancelRoomTimers(room);
    room.phase = 'closed';
    for (const connId of room.connectedIds()) this.detach(connId, reason);
    this.rooms.delete(room.code);
  }

  /** Removes a player's spot entirely (their name and slot become free). */
  removePlayer(room, playerId) {
    const player = room.players.get(playerId);
    if (!player) return;
    this.cancelTimer(player);
    room.players.delete(playerId);
    room.lastActivityAt = this.now();
  }

  /**
   * Cuts one connection loose from its room: tells it why with room:closed and drops its
   * membership. The socket itself stays open, so that browser could join another room.
   * The room's own records (host.connId / player.connId) are updated by the caller.
   * @param {ClosedReason} reason
   */
  detach(connId, reason) {
    this.send(connId, { type: SERVER.ROOM_CLOSED, reason });
    this.members.delete(connId);
  }

  /** Stops the host's and every player's grace timer in one room. */
  cancelRoomTimers(room) {
    this.cancelTimer(room.host);
    for (const player of room.players.values()) this.cancelTimer(player);
  }

  /** Stops a grace timer if one is running. Works for the host object or a player. */
  cancelTimer(holder) {
    if (holder.graceTimer) {
      clearTimeout(holder.graceTimer);
      holder.graceTimer = null;
    }
  }
}
