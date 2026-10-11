import { config } from '../config.js';

/**
 * @typedef {Object} Player
 * @property {string} id         public id, safe to broadcast
 * @property {string} token      SECRET, only ever sent to this player
 * @property {string} name
 * @property {string} nameKey    lowercase name, for the uniqueness check
 * @property {string | null} connId     null while disconnected
 * @property {boolean} connected
 * @property {NodeJS.Timeout | null} graceTimer  running while disconnected in the lobby (M4)
 * @property {number} joinedAt
 */

/**
 * The data for one room. Plain state plus small helpers; the rules for changing it
 * (who may join, what happens on disconnect) live in RoomManager.
 */
export class Room {
  /**
   * @param {string} code
   * @param {{ hostToken: string, hostConnId: string, now: number }} init
   */
  constructor(code, { hostToken, hostConnId, now }) {
    this.code = code;
    /** @type {'lobby' | 'in_game' | 'closed'} */
    this.phase = 'lobby';

    this.host = {
      token: hostToken, // SECRET
      connId: hostConnId, // null while the host is disconnected
      userId: null, // logged-in account (M7)
      graceTimer: null, // running while the host is disconnected; closes the room when it fires
    };

    /** @type {Map<string, Player>} keyed by player id; a Map keeps join order */
    this.players = new Map();
    this.maxPlayers = config.MAX_PLAYERS;
    this.game = null; // GameRunner while a game is running
    this.gameId = null;

    this.createdAt = now;
    this.lastActivityAt = now;
  }

  /** Connection ids of everyone currently connected to this room (host first). */
  connectedIds() {
    const ids = [];
    if (this.host.connId) ids.push(this.host.connId);
    for (const player of this.players.values()) {
      if (player.connId) ids.push(player.connId);
    }
    return ids;
  }

  /**
   * The room as everyone is allowed to see it: the body of a `room:state` message.
   * Built field by field on purpose, so secrets (host token, player tokens)
   * can never leak by accident when new fields are added to Room or Player.
   */
  toPublicState() {
    return {
      code: this.code,
      phase: this.phase,
      hostConnected: this.host.connId !== null,
      maxPlayers: this.maxPlayers,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      gameId: this.gameId, // which game is running, or null in the lobby
    };
  }
}
