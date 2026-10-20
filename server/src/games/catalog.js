import { allGamePages, getGamePage, saveGamePage, voteCounts, votesBy, setVote } from '../db/gamePages.js';
import { blockedFields, blockedMessage } from './wordFilter.js';
import { usernamesById } from '../db/users.js';
import { remixOrigins } from '../db/generatedGames.js';
import { tagProblems, minutesProblems } from './frameGame.js';
import { GAME_TAGS, MAX_GAME_TAGS } from './tags.js';

// The game catalogue (plan §14, §16): the registry's games as the site shows them, with what
// their creators changed (their "page"), who made them, and everyone's votes. The registry
// knows which games may run and who may see them; this adds everything the database knows.

export const MAX_ABOUT_LENGTH = 1500;

/** A refusal with an HTTP status and a code the page can show. */
export class CatalogError extends Error {
  /** @param {Record<string, unknown>} [details]  more for the page, sent with the error (e.g. { blocked }) */
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Who's looking. @typedef {{ userId: number | null, isAdmin?: boolean }} Viewer
 */

/**
 * A game as the catalogue shows it.
 * @typedef {Object} CatalogGame
 * @property {string} id               the id to start it with (a playtest version: "g-…-v2")
 * @property {string} pageId           its page and votes ("g-…" for every version of a generated game)
 * @property {string} name
 * @property {string} description
 * @property {number} minPlayers
 * @property {number} maxPlayers
 * @property {string[]} tags
 * @property {[number, number] | null} minutes
 * @property {number | null} addedAt
 * @property {('host' | 'phone')[]} shots  the screenshots it has, the main one first
 * @property {'official' | 'generated'} source
 * @property {'playtest' | 'published'} [status]
 * @property {number} [version]
 * @property {{ username: string } | null} creator   null: an official game (made by BoilerGames)
 * @property {{ up: number, down: number }} votes
 * @property {1 | -1 | 0} myVote
 * @property {boolean} canEdit         this viewer may change its page: its creator, or an admin
 * @property {boolean} canVote         logged in, and not its creator
 * @property {boolean} allowRemix      its creator lets others remix it (plan §45)
 * @property {boolean} canRemix        this viewer may remix it: logged in, not its creator, a public game, allowed
 * @property {{ id: string | null, name: string, creator: { username: string } | null } | null} remixOf
 *   the game it was remixed from; id null once that one isn't public any more (then only its name then)
 */

/**
 * Every game this viewer may see, as the catalogue shows it.
 * @param {import('better-sqlite3').Database} db
 * @param {import('./registry.js').GameRegistry} registry
 * @param {Viewer} viewer
 * @returns {CatalogGame[]}
 */
export function catalogList(db, registry, viewer) {
  const pages = allGamePages(db);
  const votes = voteCounts(db);
  const mine = viewer.userId === null ? new Map() : votesBy(db, viewer.userId);
  const names = usernamesById(db);
  const origins = remixOrigins(db);
  const games = registry.list({ userId: viewer.userId }).map((g) => {
    const page = pages.get(g.baseId) ?? null;
    const isCreator = g.ownerUserId !== null && g.ownerUserId === viewer.userId;
    const main = page?.mainShot && g.shots.includes(page.mainShot) ? page.mainShot : null;
    const allowRemix = page?.allowRemix ?? true;
    const isPublic = g.source === 'official' || g.status === 'published';
    return {
      id: g.id,
      pageId: g.baseId,
      name: page?.name ?? g.name,
      description: page?.description ?? g.description,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      tags: page?.tags ?? g.tags,
      minutes: page?.minutes ?? g.minutes,
      addedAt: g.addedAt,
      shots: main ? [main, ...g.shots.filter((s) => s !== main)] : g.shots,
      source: g.source,
      ...(g.source === 'generated' && { status: g.status, version: g.version }),
      creator: g.ownerUserId === null ? null : { username: names.get(g.ownerUserId) ?? 'someone' },
      votes: votes.get(g.baseId) ?? { up: 0, down: 0 },
      myVote: mine.get(g.baseId) ?? 0,
      canEdit: isCreator || viewer.isAdmin === true,
      canVote: viewer.userId !== null && !isCreator,
      allowRemix,
      canRemix: viewer.userId !== null && !isCreator && isPublic && allowRemix,
      remixOf: origins.get(g.baseId) ?? null,
    };
  });
  // A remix's credit line (plan §45): the original's name and creator now, linked, while it's
  // public; else the name it had when it was remixed.
  for (const game of games) {
    if (game.remixOf === null) continue;
    const { id, name } = game.remixOf;
    const original = games.find((o) => o.id === id && (o.source === 'official' || o.status === 'published'));
    game.remixOf = original ? { id: original.id, name: original.name, creator: original.creator } : { id: null, name, creator: null };
  }
  return games;
}

/**
 * One game's page: everything on its card, plus its "About" text and, for whoever may edit it,
 * what the game file itself says (to show what an empty field falls back to).
 * @returns {CatalogGame & { about: string, fromFile?: { name: string, description: string, tags: string[], minutes: [number, number] | null },
 *   tagChoices?: string[], maxTags?: number }}  tagChoices/maxTags: for the edit form
 */
export function catalogGame(db, registry, viewer, id) {
  const game = catalogList(db, registry, viewer).find((g) => g.id === id);
  if (!game) throw new CatalogError(404, 'NOT_FOUND', 'There is no such game.');
  const page = getGamePage(db, game.pageId);
  const result = { ...game, about: page?.about ?? '' };
  if (game.canEdit) {
    const file = registry.list({ userId: viewer.userId }).find((g) => g.id === id);
    result.fromFile = { name: file.name, description: file.description, tags: file.tags, minutes: file.minutes };
    result.tagChoices = GAME_TAGS;
    result.maxTags = MAX_GAME_TAGS;
  }
  return result;
}

/**
 * Changes a game's page: its creator or an admin. Every field is sent each time; an empty
 * name, description or tag list (or null) means "what the game file says".
 * @param {unknown} input  untrusted: { name, description, about, tags, minutes, mainShot, allowRemix }
 */
export function editGamePage(db, registry, viewer, id, input) {
  const game = catalogGame(db, registry, viewer, id);
  if (!game.canEdit) throw new CatalogError(403, 'NOT_CREATOR', "Only the game's creator (or an admin) can change its page.");
  const page = checkPage(input, game.shots);
  saveGamePage(db, game.pageId, page, viewer.userId);
  return catalogGame(db, registry, viewer, id);
}

/** Checks an edit and turns it into what's stored (null: what the game file says). */
function checkPage(input, shots) {
  if (input === null || typeof input !== 'object') throw new CatalogError(400, 'INVALID_PAGE', 'Send the page as an object.');
  const problems = [];
  const text = (value, field, max, { min = 0 } = {}) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      problems.push(`${field} must be text`);
      return null;
    }
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (trimmed.length < min || trimmed.length > max) problems.push(`${field} must be ${min ? `${min}–` : 'at most '}${max} characters`);
    return trimmed;
  };
  const page = {
    name: text(input.name, 'The name', 40, { min: 1 }),
    description: text(input.description, 'The short description', 200),
    about: text(input.about, '"About this game"', MAX_ABOUT_LENGTH),
    tags: null,
    minutes: null,
    mainShot: null,
    // Others may remix it (plan §45) unless this says false.
    allowRemix: input.allowRemix !== false,
  };
  if (Array.isArray(input.tags) && input.tags.length > 0) {
    problems.push(...tagProblems(input.tags));
    page.tags = input.tags;
  } else if (input.tags !== undefined && input.tags !== null && !Array.isArray(input.tags)) {
    problems.push('tags must be a list');
  }
  if (input.minutes !== undefined && input.minutes !== null) {
    problems.push(...minutesProblems(input.minutes));
    page.minutes = input.minutes;
  }
  if (input.mainShot !== undefined && input.mainShot !== null) {
    if (!shots.includes(input.mainShot)) problems.push("the main screenshot must be one the game has ('host' or 'phone')");
    page.mainShot = input.mainShot;
  }
  if (problems.length > 0) throw new CatalogError(400, 'INVALID_PAGE', `${problems.join('; ')}.`);
  // Games go public without an admin looking (plan §49): what everyone reads about a game
  // mustn't have blocked words.
  const blocked = blockedFields({ name: page.name, description: page.description, about: page.about });
  if (blocked.length > 0) throw new CatalogError(400, 'BLOCKED_WORDS', blockedMessage(blocked), { blocked });
  return page;
}

/**
 * Votes on a game: 1 (up), -1 (down) or 0 (take it back). Logged in; not on your own games.
 * @returns {CatalogGame}
 */
export function voteOnGame(db, registry, viewer, id, value) {
  if (viewer.userId === null) throw new CatalogError(401, 'NOT_AUTHENTICATED', 'Log in to vote.');
  if (value !== 1 && value !== -1 && value !== 0) throw new CatalogError(400, 'INVALID_VOTE', 'A vote is 1, -1 or 0.');
  const game = catalogGame(db, registry, viewer, id);
  if (!game.canVote) throw new CatalogError(403, 'OWN_GAME', "You can't vote on your own game.");
  setVote(db, game.pageId, viewer.userId, value);
  return catalogGame(db, registry, viewer, id);
}
