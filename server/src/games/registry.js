import { validateGameModule } from './contract.js';

/**
 * The list of games the server can run, by id.
 *
 * A class (instead of one shared global list) so each test can make its own registry
 * with exactly the games it needs, e.g. the test-only count game.
 *
 * Extension point (§5, E3): AI-generated games would be registered here too, marked
 * untrusted, and started inside a sandboxed runner instead of the normal GameRunner.
 */
export class GameRegistry {
  constructor() {
    /** @type {Map<string, import('./contract.js').GameModule>} */
    this.games = new Map();
  }

  /**
   * Adds a game. Throws if it breaks the contract or its id is already used, so a bad game
   * stops the server at startup instead of failing halfway through a party.
   */
  register(mod) {
    const problems = validateGameModule(mod);
    if (problems.length > 0) {
      throw new Error(`Game "${mod?.id}" does not follow the game contract:\n - ${problems.join('\n - ')}`);
    }
    if (this.games.has(mod.id)) throw new Error(`A game with id "${mod.id}" is already registered`);
    this.games.set(mod.id, mod);
  }

  /** @returns {import('./contract.js').GameModule | undefined} */
  get(id) {
    return this.games.get(id);
  }

  /** Public info for the host's game picker (no functions). */
  list() {
    return [...this.games.values()].map(({ id, name, description, minPlayers, maxPlayers }) => ({
      id,
      name,
      description,
      minPlayers,
      maxPlayers,
    }));
  }
}
