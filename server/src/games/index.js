import { readFileSync } from 'node:fs';
import { GameRegistry } from './registry.js';
import { frameGameOrThrow } from './frameGame.js';

/**
 * The official (hand-made) games, by id. Each is one file: server/src/games/<id>/game.html
 * (plan §13c). To add a game: make its folder and add its id here.
 */
export const OFFICIAL_GAMES = [];

/** Reads an official game's file. Throws if it's missing or its info is invalid. */
export function readOfficialGame(id) {
  const source = readFileSync(new URL(`./${id}/game.html`, import.meta.url), 'utf8');
  return frameGameOrThrow(source, id);
}

/** The one place that lists the games this server offers. */
export function createDefaultRegistry() {
  const registry = new GameRegistry();
  for (const id of OFFICIAL_GAMES) registry.register(readOfficialGame(id));
  return registry;
}
