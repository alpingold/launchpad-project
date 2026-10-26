import { existsSync, readFileSync } from 'node:fs';
import { catalogGame, CatalogError } from './catalog.js';
import { frameGameReport, GAME_INFO_RE } from './frameGame.js';
import { officialGameSource, readOfficialShots } from './index.js';
import { createRemix, getGeneratedGame, countGamesOwnedBy } from '../db/generatedGames.js';
import { madeBy } from './generated.js';
import { config } from '../config.js';

// Remixing (plan §45): your own copy of a public game, to change with the AI the way you change
// your own games. The copy is version 1 of a new game, ready to play at once (its code already
// passed the checks as the original); nothing is generated until you ask for a change. Official
// games can be remixed too. A remix remembers what it was copied from, for its credit line, and
// is called "<name> - Remixed" (in its game file, so the name stays through later changes).

const REMIXED = ' - Remixed';
/** A game's name is at most 40 characters (frameGame.js). */
const MAX_NAME = 40;

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
  // Each remix is a whole copy of the game (plan §59): an account has at most so many games.
  if (!viewer.isAdmin && countGamesOwnedBy(db, viewer.userId) >= config.MAX_GAMES_PER_ACCOUNT) {
    throw new CatalogError(409, 'TOO_MANY_GAMES', `You have ${config.MAX_GAMES_PER_ACCOUNT} games, the most an account can have. Delete one to make another.`);
  }
  const copy = game.source === 'official' ? officialCopy(game) : generatedCopy(db, game);
  const name = remixedName(copy.name);
  const remix = createRemix(db, {
    ownerUserId: viewer.userId,
    remixOf: { id: game.id, version: copy.version, name: game.name },
    ...copy,
    name,
    source: renamed(copy.source, name),
  });
  return remix.id;
}

/** "Stowaways" → "Stowaways - Remixed", shortened at a word to fit; a remix of a remix doesn't say it twice. */
export function remixedName(name) {
  if (name.endsWith(REMIXED)) return name;
  const room = MAX_NAME - REMIXED.length;
  let base = name;
  if (base.length > room) {
    base = base.slice(0, room);
    // Cut in the middle of a word: drop that word (unless it's the only one).
    if (name[room] !== ' ') base = base.replace(/\s+\S*$/, '') || base;
  }
  return `${base.trimEnd()}${REMIXED}`;
}

/** The game file with this name in its game info (only there: the rest of the file is untouched). */
function renamed(source, name) {
  const withName = (info) => info.replace(/"name"\s*:\s*"(?:[^"\\]|\\.)*"/, () => `"name": ${JSON.stringify(name)}`);
  return source.replace(GAME_INFO_RE, (block, info) => block.replace(info, () => withName(info)));
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
    // Its label carries over (plan §60): a copy of an uploaded game still says "Uploaded".
    madeBy: madeBy(original),
  };
}
