import { GameRegistry } from './registry.js';

/**
 * The one place that lists the games this server offers.
 * To add a game: import its folder and register it here.
 */
export function createDefaultRegistry() {
  const registry = new GameRegistry();
  // M5b: registry.register(reactionRace);
  return registry;
}
