import { readFileSync, existsSync } from 'node:fs';
import { GameRegistry } from './registry.js';
import { frameGameOrThrow } from './frameGame.js';

/**
 * The official (hand-made) games, by id. Each is one file: server/src/games/<id>/game.html
 * (plan §13c), plus thumb.jpg, its picture in the catalogue (plan §14; take it with
 * `npm run check-game -- <game.html> --shots <folder>` and keep host.jpg). To add a game:
 * make its folder and add its id here.
 */
export const OFFICIAL_GAMES = ['bumper-blobs', 'tower-dash', 'dungeon-party'];

/** Reads an official game's file. Throws if it's missing or its info is invalid. */
export function readOfficialGame(id) {
  const source = readFileSync(new URL(`./${id}/game.html`, import.meta.url), 'utf8');
  return frameGameOrThrow(source, id);
}

/** An official game's catalogue picture, or null if it has none. */
export function readOfficialThumb(id) {
  const file = new URL(`./${id}/thumb.jpg`, import.meta.url);
  return existsSync(file) ? readFileSync(file) : null;
}

/** The one place that lists the games this server offers. */
export function createDefaultRegistry() {
  const registry = new GameRegistry();
  for (const id of OFFICIAL_GAMES) registry.register(readOfficialGame(id), { thumb: readOfficialThumb(id) });
  return registry;
}
