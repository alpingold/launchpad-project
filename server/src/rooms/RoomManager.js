import { randomInt as cryptoRandomInt } from 'node:crypto';
import { config } from '../config.js';
import { SERVER } from '../protocol/messageTypes.js';
import { Room } from './Room.js';
import { RoomError } from './RoomError.js';
import { generateRoomCode } from './roomCode.js';
import { newToken, newPlayerId, tokensEqual } from './tokens.js';
import { validateName } from './names.js';
import { GameRegistry } from '../games/registry.js';
import { FrameRelay } from '../games/FrameRelay.js';

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
 * A game that ended, for the record of games played. Nothing about who played.
 * @typedef {Object} GamePlayed
 * @property {string} gameId          the game's page id ("g-…" for every version of a generated game)
 * @property {number | null} version  generated games only
 * @property {null | 'host' | 'reload' | 'unresponsive' | 'broken'} stopped  null: the big screen ended it
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
   * @param {GameRegistry} [deps.games]  games that can be started (empty by default)
   * @param {number} [deps.gameWatchdogMs]  stop a game whose big screen stops answering for this long
   * @param {(play: GamePlayed) => void} [deps.onGamePlayed]  told once about every game that ends
   */
  constructor({
    send,
    randomInt = cryptoRandomInt,
    now = () => Date.now(),
    maxRooms = config.MAX_ROOMS,
    hostGraceMs = config.HOST_GRACE_MS,
    playerGraceMs = config.PLAYER_GRACE_MS,
    roomIdleMs = config.ROOM_IDLE_MS,
    games = new GameRegistry(),
    gameWatchdogMs = config.GAME_WATCHDOG_MS,
    onGamePlayed = () => {},
  }) {
    this.send = send;
    this.randomInt = randomInt;
    this.now = now;
    this.maxRooms = maxRooms;
    this.hostGraceMs = hostGraceMs;
    this.playerGraceMs = playerGraceMs;
    this.roomIdleMs = roomIdleMs;
    this.games = games;
    this.gameWatchdogMs = gameWatchdogMs;
    this.onGamePlayed = onGamePlayed;

    /** @type {Map<string, Room>} every live room, by code */
    this.rooms = new Map();

    /** @type {Map<string, Membership>} which room each connection is in, by connection id */
    this.members = new Map();

    /** @type {Map<number, string>} the room each logged-in host account owns (one per account, Q4) */
    this.roomByHostUser = new Map();
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

  /**
   * host:create_room — makes a new room with this connection as its host.
   *
   * One room per host account (Q4): if this account already has a live room, the host is
   * put back into THAT room instead (new tab, other laptop, lost the page). The old tab is
   * told "replaced". To get a fresh room, the host ends the old one first.
   *
   * @param {string} connId
   * @param {{ userId?: number | null }} [owner]  the logged-in account (the router requires one)
   */
  createRoom(connId, owner = {}) {
    const { userId = null } = owner;
    // The router already checks this; repeating it here keeps RoomManager safe on its own.
    if (this.members.has(connId)) throw new RoomError('ALREADY_IN_ROOM');

    const existing = userId !== null ? this.rooms.get(this.roomByHostUser.get(userId)) : undefined;
    if (existing) return this.attachHost(existing, connId);

    if (this.rooms.size >= this.maxRooms) throw new RoomError('SERVER_FULL');
    const code = generateRoomCode((c) => this.rooms.has(c), this.randomInt);
    const room = new Room(code, { hostToken: newToken(), hostConnId: connId, now: this.now() });
    room.host.userId = userId;

    this.rooms.set(code, room);
    if (userId !== null) this.roomByHostUser.set(userId, code);
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
    return this.attachHost(room, connId);
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
    if (room.game) {
      // Mid-game: the phone needs the game again (its page may have reloaded), then its latest state.
      this.send(connId, this.gameStartedMessage(room.game, { resumed: true }));
      room.game.replayState(player.id);
    }
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

  /**
   * host:start_game — starts a game with everyone currently in the room.
   * Players who are disconnected but still within their grace period are included:
   * from now on their spot is kept until the game ends (decision D6).
   */
  startGame(hostConnId, gameId) {
    const membership = this.members.get(hostConnId);
    if (membership?.role !== 'host') throw new RoomError('NOT_HOST');
    const room = this.rooms.get(membership.code);

    if (room.phase !== 'lobby') throw new RoomError('WRONG_PHASE');
    // Playtest games (plan §11) only exist for the account that generated them.
    const game = this.games.get(gameId, { userId: room.host.userId });
    if (!game) throw new RoomError('GAME_NOT_FOUND');
    const count = room.players.size;
    if (count < game.minPlayers || count > game.maxPlayers) throw new RoomError('WRONG_PLAYER_COUNT');

    const players = [...room.players.values()];
    for (const player of players) this.cancelTimer(player); // in-game: no lobby grace timers

    room.phase = 'in_game';
    room.gameId = gameId;
    room.lastActivityAt = this.now();
    // Read now: a playtest version may be gone from the registry by the time the game ends.
    const which = this.games.versionOf(gameId);
    const relay = new FrameRelay({
      game,
      players: players.map((p) => ({ id: p.id, name: p.name })),
      deliver: (target, msg) => this.deliverGameMessage(room, target, msg),
      onEnd: (results) => {
        this.handleGameEnd(room, relay, results);
        this.reportGamePlayed({ ...which, stopped: results.stopped ?? null });
      },
    });
    room.game = relay;

    // Every page gets the game's file and starts it in an iframe: the big screen as the
    // referee, phones as controllers (plan §13b). Who's connected comes from room:state.
    this.broadcast(room, this.gameStartedMessage(relay));
    this.broadcastState(room);
    this.armWatchdog(room);
  }

  /**
   * host:stop_game — the host ends the game early, with no winner.
   * @param {'host' | 'reload' | 'broken'} [why]  reload: the big screen reloaded with no save to
   *   restore; broken: its game loaded another page into its frame
   */
  stopGameByHost(hostConnId, why = 'host') {
    this.hostGame(hostConnId).stop(why);
  }

  /** game:event — a phone's event for the big screen's game. */
  handleGameEvent(connId, data) {
    const membership = this.members.get(connId);
    if (membership?.role !== 'player') throw new RoomError('WRONG_PHASE');
    const room = this.rooms.get(membership.code);
    if (room.phase !== 'in_game' || !room.game) throw new RoomError('WRONG_PHASE');
    room.lastActivityAt = this.now();
    room.game.playerEvent(membership.playerId, data);
  }

  /** game:batch — the big screen's messages and states for phones, and maybe a save. */
  handleHostGameBatch(hostConnId, items, save) {
    this.hostGame(hostConnId).hostBatch(items, save);
  }

  /**
   * game:alive — the big screen's game is still answering: reset the hang watchdog.
   * `paused`: the big screen's tab is in the background (its timers slow right down), so
   * stop watching until it's back.
   */
  handleHostGameAlive(hostConnId, { paused = false } = {}) {
    const room = this.rooms.get(this.members.get(hostConnId)?.code);
    this.hostGame(hostConnId);
    if (paused) this.disarmWatchdog(room);
    else this.armWatchdog(room);
  }

  /** game:end — the big screen's game is over. */
  handleHostGameEnd(hostConnId, results) {
    this.hostGame(hostConnId).hostEnd(results);
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
      this.disarmWatchdog(room); // a missing big screen isn't a hung one: the grace period covers it
    } else {
      const player = room.players.get(membership.playerId);
      player.connId = null;
      player.connected = false;
      // In the lobby, an empty spot blocks the name and a slot, so it expires.
      // During a game, the spot is kept until the game ends (decision D6).
      if (room.phase === 'lobby') this.startPlayerGraceTimer(room, player);
    }
    this.broadcastState(room); // others see "disconnected" right away (the big screen's game too)
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

  /** Cancels every pending timer and running game, and forgets every room (server shutdown and tests). */
  dispose() {
    for (const room of this.rooms.values()) {
      this.cancelRoomTimers(room);
      this.stopGame(room);
    }
    // Forget everything too. Sockets close a moment AFTER this (their 'close' events are
    // asynchronous); with no rooms or members left, those late disconnects find nothing
    // and can't start new grace timers that would keep the process alive.
    this.rooms.clear();
    this.members.clear();
    this.roomByHostUser.clear();
  }

  // --- Helpers ----------------------------------------------------------------

  /**
   * Makes `connId` the host connection of an existing room (resume, or the same account
   * opening /host again). Shared by resumeHost and createRoom.
   */
  attachHost(room, connId) {
    // The host is still connected somewhere else (a second tab): newest tab wins.
    if (room.host.connId) this.detach(room.host.connId, 'replaced');

    this.cancelTimer(room.host);
    room.host.connId = connId;
    room.lastActivityAt = this.now();
    this.members.set(connId, { code: room.code, role: 'host', playerId: null });

    this.send(connId, { type: SERVER.ROOM_CREATED, code: room.code, hostToken: room.host.token });
    this.broadcastState(room); // everyone sees hostConnected: true again
    // Mid-game: tell the page, with the game's latest save. If it still runs the game (the
    // connection only blipped) it carries on; if it reloaded, it restores the save, or stops
    // the game if there's none (plan §13f, F1).
    if (room.game) {
      this.send(connId, this.gameStartedMessage(room.game, { resumed: true, withSnapshot: true }));
      this.armWatchdog(room);
    }
    return room;
  }

  /** Sends one message to everyone connected to the room. */
  broadcast(room, msg) {
    for (const connId of room.connectedIds()) this.send(connId, msg);
  }

  /** Sends the current public room state to everyone connected to the room. */
  broadcastState(room) {
    this.broadcast(room, { type: SERVER.ROOM_STATE, ...room.toPublicState() });
  }

  /** The running game of the room this host is in (for the big screen's game messages). */
  hostGame(hostConnId) {
    const membership = this.members.get(hostConnId);
    if (membership?.role !== 'host') throw new RoomError('NOT_HOST');
    const room = this.rooms.get(membership.code);
    if (room.phase !== 'in_game' || !room.game) throw new RoomError('WRONG_PHASE');
    room.lastActivityAt = this.now();
    return room.game;
  }

  /**
   * game:started: which game, its file and players. serverNow lets pages correct for their
   * clock being off, so timers agree across screens.
   * @param {FrameRelay} relay
   * @param {{ resumed?: boolean, withSnapshot?: boolean }} [opts]
   *   resumed: sent to someone reconnecting mid-game; withSnapshot: the big screen's save (host only)
   */
  gameStartedMessage(relay, { resumed = false, withSnapshot = false } = {}) {
    return { type: SERVER.GAME_STARTED, ...relay.startInfo({ withSnapshot }), resumed, serverNow: this.now() };
  }

  /**
   * (Re)starts the hang watchdog: if the big screen doesn't say its game is alive within
   * gameWatchdogMs, the game is stopped (plan §13e: a hung game freezes the big screen's
   * whole tab, so only the server can notice).
   */
  armWatchdog(room) {
    this.disarmWatchdog(room);
    const relay = room.game;
    room.gameWatchdog = setTimeout(() => {
      room.gameWatchdog = null;
      if (room.game === relay) relay.stop('unresponsive');
    }, this.gameWatchdogMs);
  }

  disarmWatchdog(room) {
    if (room.gameWatchdog) clearTimeout(room.gameWatchdog);
    room.gameWatchdog = null;
  }

  /**
   * Delivers a game message from the relay. Messages to someone who is disconnected are
   * dropped; the relay keeps each phone's latest state and replays it when they're back.
   * @param {import('../games/FrameRelay.js').Target} target
   */
  deliverGameMessage(room, target, msg) {
    const connId = target.to === 'host' ? room.host.connId : room.players.get(target.playerId)?.connId;
    if (connId) this.send(connId, { ...msg, serverNow: this.now() });
  }

  /** The game finished (or crashed): report results and go back to the lobby. */
  handleGameEnd(room, relay, results) {
    if (room.game !== relay) return; // an old game; the room has moved on
    this.disarmWatchdog(room);
    room.game = null;
    room.gameId = null;
    room.phase = 'lobby';
    room.lastActivityAt = this.now();
    this.broadcast(room, { type: SERVER.GAME_ENDED, results });

    // Back in the lobby: players who dropped during the game now get the normal grace period.
    for (const player of room.players.values()) {
      if (!player.connected) this.startPlayerGraceTimer(room, player);
    }
    this.broadcastState(room);
  }

  /**
   * Passes on a game that ended, for the record. A record that can't be saved is only logged:
   * the game has ended for everyone either way (and the watchdog ends games from a timer, where
   * a throw would stop the server).
   * @param {GamePlayed} play
   */
  reportGamePlayed(play) {
    try {
      this.onGamePlayed(play);
    } catch (err) {
      console.error('[rooms] could not record a game played:', err);
    }
  }

  /** Stops a running game without results (the room is closing). */
  stopGame(room) {
    this.disarmWatchdog(room);
    room.game?.dispose();
    room.game = null;
  }

  /** In the lobby, a disconnected player's spot is freed if they don't return in time. */
  startPlayerGraceTimer(room, player) {
    this.cancelTimer(player);
    player.graceTimer = setTimeout(() => {
      this.removePlayer(room, player.id);
      this.broadcastState(room);
    }, this.playerGraceMs);
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
    this.stopGame(room);
    room.phase = 'closed';
    for (const connId of room.connectedIds()) this.detach(connId, reason);
    this.rooms.delete(room.code);
    if (room.host.userId !== null) this.roomByHostUser.delete(room.host.userId);
  }

  /** Removes a player's spot entirely (their name and slot become free). */
  removePlayer(room, playerId) {
    const player = room.players.get(playerId);
    if (!player) return;
    this.cancelTimer(player);
    room.players.delete(playerId);
    room.lastActivityAt = this.now();
    // Mid-game, the big screen's game sees them gone from the next room:state.
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
