import { config } from '../config.js';
import { isPlainObject } from '../protocol/validate.js';
import { RoomError } from '../rooms/RoomError.js';

/**
 * Where a relayed game message goes.
 * @typedef {{ to: 'host' } | { to: 'player', playerId: string }} Target
 */

/**
 * The server's part of one running frame game (plan §13f). It runs NO game code: the game
 * runs in the big screen's browser (the referee) and on the phones (controllers), and this
 * only passes their messages along, checking each one:
 *
 *   phone ──game:event──▶ big screen        "I pressed jump" (any small JSON)
 *   big screen ──game:batch──▶ phone(s)     in one message, in order:
 *       { to, data }   a one-off message ("you were hit!")
 *       { to, state }  what the phone should show now; the LATEST one is kept and sent
 *                      again when the phone reconnects
 *     plus `save`: a snapshot of the big screen's game, kept to hand back if that page
 *     reloads (F1). Only the big screen ever gets it back: it may hold secrets (answers).
 *   big screen ──game:end──▶ everyone       the results, checked like endGame always was
 *
 * The data inside is the game's business. The relay checks who sent it, who it's for, its
 * size, and the results' shape. A phone can only talk to the big screen, never to other phones.
 *
 * It sits where GameRunner used to (§5, E2), so RoomManager talks to it the same way.
 */
export class FrameRelay {
  /**
   * @param {Object} opts
   * @param {import('./frameGame.js').FrameGame} opts.game
   * @param {{id: string, name: string}[]} opts.players  everyone in the game
   * @param {(target: Target, msg: object) => void} opts.deliver
   * @param {(results: object) => void} opts.onEnd  called exactly once
   */
  constructor({ game, players, deliver, onEnd }) {
    this.game = game;
    this.players = Object.freeze(players.map((p) => Object.freeze({ id: p.id, name: p.name })));
    this.playerIds = new Set(this.players.map((p) => p.id));
    this.deliver = deliver;
    this.onEnd = onEnd;
    this.ended = false;
    /** Changes with every game, so a page can tell a new game from the one it's showing. */
    this.runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    /** @type {Map<string, unknown>} the latest state the big screen gave each phone */
    this.lastStates = new Map();
    /** The big screen's latest save (party.save), or none yet. */
    this.snapshot = undefined;
  }

  /**
   * What a page needs to show this game: sent to everyone at the start, and on reconnect.
   * @param {{ withSnapshot?: boolean }} [opts]  true only for the big screen coming back
   */
  startInfo({ withSnapshot = false } = {}) {
    const info = { gameId: this.game.id, runId: this.runId, players: this.players, source: this.game.source };
    if (withSnapshot && this.snapshot !== undefined) info.snapshot = this.snapshot;
    return info;
  }

  /** game:event from a phone: passed to the big screen with who sent it. */
  playerEvent(playerId, data) {
    if (this.ended || !this.playerIds.has(playerId)) return;
    if (jsonBytes(data) > config.GAME_EVENT_MAX_BYTES) throw new RoomError('GAME_DATA_TOO_BIG');
    this.deliver({ to: 'host' }, { type: 'game:event', from: playerId, data });
  }

  /**
   * game:batch from the big screen. Every target is checked first, so a bad batch delivers
   * nothing; then each item goes out in order. States are remembered per phone.
   * @param {({ to: string, data: unknown } | { to: string, state: unknown })[]} items
   * @param {unknown} [save]  a snapshot to keep for a reload (undefined: no change)
   */
  hostBatch(items, save) {
    if (this.ended) return;
    const routed = items.map((item) => ({ item, playerIds: this.targets(item.to) }));
    for (const { item, playerIds } of routed) {
      for (const playerId of playerIds) {
        if ('state' in item) {
          this.lastStates.set(playerId, item.state);
          this.deliver({ to: 'player', playerId }, { type: 'game:state', state: item.state });
        } else {
          this.deliver({ to: 'player', playerId }, { type: 'game:message', data: item.data });
        }
      }
    }
    if (save !== undefined) this.snapshot = save;
  }

  /** A phone is back (refresh, new connection): give it its latest state again. */
  replayState(playerId) {
    if (this.ended || !this.lastStates.has(playerId)) return;
    this.deliver({ to: 'player', playerId }, { type: 'game:state', state: this.lastStates.get(playerId) });
  }

  /** game:end from the big screen. Bad results are refused (the game keeps running). */
  hostEnd(results) {
    if (this.ended) return;
    this.finish(this.checkResults(results));
  }

  /**
   * The game ends with no winner: the host stopped it, or the big screen can't carry on.
   * @param {'host' | 'reload' | 'unresponsive' | 'broken'} [why]  broken: the game left its frame
   */
  stop(why = 'host') {
    this.finish({ stopped: why });
  }

  /** Forgets the game without reporting results (the room closed). Safe to call twice. */
  dispose() {
    this.ended = true;
    this.lastStates.clear();
    this.snapshot = undefined;
  }

  // --- Internals ------------------------------------------------------------------

  finish(results) {
    if (this.ended) return;
    this.dispose();
    this.onEnd(results);
  }

  /** 'all' or one player id → the players a big-screen message goes to. */
  targets(to) {
    if (to === 'all') return this.playerIds;
    if (!this.playerIds.has(to)) throw new RoomError('PLAYER_NOT_FOUND');
    return [to];
  }

  /** The same rules endGame always had: known players, each ranked once, numeric scores. */
  checkResults({ rankings, scores }) {
    if (!Array.isArray(rankings)) throw new RoomError('INVALID_RESULTS');
    if (rankings.some((id) => !this.playerIds.has(id)) || new Set(rankings).size !== rankings.length) {
      throw new RoomError('INVALID_RESULTS');
    }
    if (scores === undefined) return { rankings: [...rankings] };
    if (!isPlainObject(scores)) throw new RoomError('INVALID_RESULTS');
    for (const [id, score] of Object.entries(scores)) {
      if (!this.playerIds.has(id) || typeof score !== 'number' || !Number.isFinite(score)) {
        throw new RoomError('INVALID_RESULTS');
      }
    }
    return { rankings: [...rankings], scores: { ...scores } };
  }
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value) ?? '');
}
