import { validateFrameGame } from './frameGame.js';

/**
 * Where a registered game came from, and who may see it.
 * @typedef {Object} GameMeta
 * @property {'official' | 'generated'} source
 *   official: hand-made, in the repo. generated: AI-made, stored in the database (plan §11).
 * @property {'playtest' | 'published' | null} status
 *   generated games only. playtest: only its owner can see and start it. published: everyone.
 * @property {number | null} ownerUserId   generated games only: who generated it
 * @property {number | null} version       generated games only: which version of it this is
 * @property {number | null} addedAt       generated games only: when it was made (ms), for "newest"
 */

/**
 * The list of games the server can run, by id.
 *
 * A class (instead of one shared global list) so each test can make its own registry
 * with exactly the games it needs, e.g. the test-only count game.
 */
export class GameRegistry {
  constructor() {
    /** @type {Map<string, { game: import('./frameGame.js').FrameGame, meta: GameMeta }>} */
    this.entries = new Map();
  }

  /**
   * Adds a game. Throws if its info is invalid or its id is already used, so a bad game
   * stops the server at startup instead of failing halfway through a party.
   * @param {import('./frameGame.js').FrameGame} game
   * @param {Partial<GameMeta>} [meta]  defaults to an official game
   * @param {{ replace?: boolean }} [opts]  replace: swap out a game already using this id
   *   (a newly published version); the old one stays if the new one is invalid
   */
  register(game, { source = 'official', status = null, ownerUserId = null, version = null, addedAt = null } = {}, { replace = false } = {}) {
    const problems = validateFrameGame(game);
    if (problems.length > 0) {
      throw new Error(`Game "${game?.id}" can't be registered:\n - ${problems.join('\n - ')}`);
    }
    if (this.entries.has(game.id) && !replace) throw new Error(`A game with id "${game.id}" is already registered`);
    this.entries.set(game.id, { game, meta: { source, status, ownerUserId, version, addedAt } });
  }

  /** Removes a game (e.g. a generated game that was rejected). @returns {boolean} */
  unregister(id) {
    return this.entries.delete(id);
  }

  /**
   * A game, if this user may start it.
   * @param {string} id
   * @param {{ userId?: number | null }} [viewer]  the logged-in host, if any
   * @returns {import('./frameGame.js').FrameGame | undefined}
   */
  get(id, { userId = null } = {}) {
    const entry = this.entries.get(id);
    return entry && isVisible(entry.meta, userId) ? entry.game : undefined;
  }

  /**
   * Public info for the catalogue (not the game files), only the games this user may see.
   * Games without tags or a length (older ones) get [] and null.
   * @param {{ userId?: number | null }} [viewer]
   */
  list({ userId = null } = {}) {
    return [...this.entries.values()]
      .filter(({ meta }) => isVisible(meta, userId))
      .map(({ game: { id, name, description, minPlayers, maxPlayers, tags, minutes }, meta }) => ({
        id,
        name,
        description,
        minPlayers,
        maxPlayers,
        tags: tags ?? [],
        minutes: minutes ?? null,
        addedAt: meta.addedAt,
        source: meta.source,
        ...(meta.source === 'generated' && { status: meta.status, version: meta.version }),
      }));
  }
}

/** Official and published games are for everyone; a playtest game only for its owner. */
function isVisible(meta, userId) {
  if (meta.source === 'official' || meta.status === 'published') return true;
  return meta.status === 'playtest' && userId !== null && userId === meta.ownerUserId;
}
