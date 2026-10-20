import { existsSync, readFileSync } from 'node:fs';
import { catalogGame, CatalogError } from './catalog.js';
import { frameGameReport } from './frameGame.js';
import { officialGameSource, readOfficialShots } from './index.js';
import { createRemix, getGeneratedGame } from '../db/generatedGames.js';

// Remixing (plan §45): your own copy of a public game, to change with the AI the way you change
// your own games. The copy is version 1 of a new game, ready to play at once (its code already
// passed the checks as the original); nothing is generated until you ask for a change. Official
// games can be remixed too. A remix remembers what it was copied from, for its credit line.

/**
 * Makes a remix of the game `id` for this viewer.
 * @param {import('better-sqlite3').Database} db
 * @param {import('./registry.js').GameRegistry} registry
 * @param {import('./catalog.js').Viewer} viewer
 * @param {string} id  the game as the catalogue lists it
 * @returns {string} the new game's id ("g-…"), to open at /create/<id>
 */
export function remixGame(db, registry, viewer, id) {
  if (viewer.userId === null) throw new CatalogError(401, 'NOT_AUTHENTICATED', 'Log in to remix a game.');
  const game = catalogGame(db, registry, viewer, id);
  if (!game.canRemix) {
    // Logged in, so canVote is false only for its creator.
    if (!game.canVote) throw new CatalogError(409, 'OWN_GAME', "It's your game: change it on /create instead.");
    if (game.source === 'generated' && game.status !== 'published') throw new CatalogError(409, 'NOT_PUBLIC', 'Only a published game can be remixed.');
    throw new CatalogError(403, 'REMIX_OFF', "This game's creator doesn't allow remixes.");
  }
  const copy = game.source === 'official' ? officialCopy(game) : generatedCopy(db, game);
  const remix = createRemix(db, { ownerUserId: viewer.userId, remixOf: { id: game.id, version: copy.version, name: game.name }, ...copy });
  return remix.id;
}

/** An official game: its file, its design (the one it was made from), and its pictures. */
function officialCopy(game) {
  const source = officialGameSource(game.id);
  const designFile = new URL(`../../../generator/spec/designs/${game.id}.md`, import.meta.url);
  const shots = readOfficialShots(game.id);
  const screenshots = Object.fromEntries(Object.entries(shots).map(([which, jpeg]) => [which, `data:image/jpeg;base64,${jpeg.toString('base64')}`]));
  const info = frameGameReport(source).game;
  return {
    version: null,
    prompt: `${game.name}: ${game.description}`,
    design: existsSync(designFile) ? readFileSync(designFile, 'utf8') : null,
    source,
    // What the copy was checked with: the static check now, and the official pictures.
    report: { ...frameGameReport(source), playtest: { screenshots } },
    name: info.name,
    description: info.description,
  };
}

/** A published AI-made game: its published version, with that version's checks and pictures. */
function generatedCopy(db, game) {
  const original = getGeneratedGame(db, game.pageId);
  const version = original?.versions.find((v) => v.version === original.publishedVersion);
  if (!version) throw new CatalogError(409, 'NOT_PUBLIC', 'Only a published game can be remixed.');
  return {
    version: version.version,
    prompt: original.prompt,
    design: original.versions[0]?.design ?? null, // the game's own design is version 1's
    source: version.source,
    report: version.report,
    name: version.name,
    description: version.description,
    model: version.model,
  };
}
