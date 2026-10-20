import { readFileSync, existsSync } from 'node:fs';
import { GameRegistry } from './registry.js';
import { frameGameOrThrow } from './frameGame.js';

/**
 * The official (hand-made) games, by id. Each is one file: server/src/games/<id>/game.html
 * (plan §13c), plus host.jpg and phone.jpg, its pictures in the catalogue (plan §14, §16; take
 * them with `npm run check-game -- <game.html> --shots <folder>`). To add a game: make its
 * folder and add its id here.
 */
export const OFFICIAL_GAMES = ['bumper-blobs', 'stowaways', 'punchline', 'doodle-drift', 'ballpark', 'claim-jumpers', 'comet-crew'];

/** An official game's file, as text (e.g. to remix it, plan §45). */
export function officialGameSource(id) {
  return readFileSync(new URL(`./${id}/game.html`, import.meta.url), 'utf8');
}

/** Reads an official game's file. Throws if it's missing or its info is invalid. */
export function readOfficialGame(id) {
  return frameGameOrThrow(officialGameSource(id), id);
}

/** An official game's catalogue pictures (those it has). @returns {{ host?: Buffer, phone?: Buffer }} */
export function readOfficialShots(id) {
  const shots = {};
  for (const which of ['host', 'phone']) {
    const file = new URL(`./${id}/${which}.jpg`, import.meta.url);
    if (existsSync(file)) shots[which] = readFileSync(file);
  }
  return shots;
}

/** The one place that lists the games this server offers. */
export function createDefaultRegistry() {
  const registry = new GameRegistry();
  for (const id of OFFICIAL_GAMES) registry.register(readOfficialGame(id), { shots: readOfficialShots(id) });
  return registry;
}
