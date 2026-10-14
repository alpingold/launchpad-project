import { GameRegistry } from './registry.js';
import reactionRace from './reaction-race/index.js';
import majorityRules from './majority-rules/index.js';
import sketchGuess from './sketch-guess/index.js';
import fillTheBlank from './fill-the-blank/index.js';

/**
 * The one place that lists the games this server offers.
 * To add a game: import its folder and register it here.
 */
export function createDefaultRegistry() {
  const registry = new GameRegistry();
  registry.register(reactionRace);
  registry.register(majorityRules);
  registry.register(sketchGuess);
  registry.register(fillTheBlank);
  return registry;
}
