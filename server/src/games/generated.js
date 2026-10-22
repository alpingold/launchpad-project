import { listLiveVersions, sha256 } from '../db/generatedGames.js';
import { frameGameOrThrow } from './frameGame.js';

/**
 * The id a live version of a generated game runs under:
 *   published: the game's own id ("g-k3x9m2qa"), so it stays the same from version to version
 *   playtest:  the id plus the version ("g-k3x9m2qa-v3"), so it can run next to the
 *              published one while its owner tries it (plan §12e, Q14)
 */
export function liveGameId(gameId, as, version) {
  return as === 'published' ? gameId : `${gameId}-v${version}`;
}

/**
 * The screenshots from a version's final check, as JPEGs (plan §14, §16): the big screen and a
 * phone. None for an imported game, or one checked before screenshots were kept.
 * @param {import('../games/frameGame.js').CheckReport | null} report
 * @returns {{ host?: Buffer, phone?: Buffer }}
 */
export function shotsFromReport(report) {
  const prefix = 'data:image/jpeg;base64,';
  const shots = {};
  for (const which of ['host', 'phone']) {
    const url = report?.playtest?.screenshots?.[which];
    if (typeof url === 'string' && url.startsWith(prefix)) shots[which] = Buffer.from(url.slice(prefix.length), 'base64');
  }
  return shots;
}

/**
 * How a game was made, for its label (plan §57): 'upload' when someone brought the file and the
 * site's AI never built a version of it; else 'ai' (games from before uploads, and remixes of them, too).
 * @param {import('../db/generatedGames.js').GeneratedGame} game
 * @returns {'ai' | 'upload'}
 */
export function madeBy(game) {
  const uploaded = game.versions.some((v) => v.kind === 'upload');
  return uploaded && !game.versions.some((v) => v.model !== null) ? 'upload' : 'ai';
}

/**
 * Checks one version's game file and adds it to the registry under its live id.
 * Throws (with a readable message) if the file was changed since it was reviewed, or if
 * its game info is invalid (e.g. a block game from before frame games: plan §13).
 * The file itself is never run on the server.
 * @param {import('./registry.js').GameRegistry} registry
 * @param {import('../db/generatedGames.js').GeneratedGame} game
 * @param {import('../db/generatedGames.js').GameVersion} version
 * @param {'published' | 'playtest'} as
 * @param {{ replace?: boolean }} [opts]  replace whatever runs under that id now (only once this version has loaded)
 */
export async function registerVersion(registry, game, version, as, { replace = false } = {}) {
  if (!version.source || sha256(version.source) !== version.sourceSha256) {
    throw new Error("its code doesn't match the code that was reviewed");
  }
  const id = liveGameId(game.id, as, version.version);
  const frameGame = frameGameOrThrow(version.source, id);
  const meta = { source: 'generated', status: as, ownerUserId: game.ownerUserId, version: version.version, addedAt: game.createdAt, shots: shotsFromReport(version.report), baseId: game.id, madeBy: madeBy(game) };
  registry.register(frameGame, meta, { replace });
  return id;
}

/**
 * Loads the AI-generated games' live versions (published and playtest) from the database
 * into the registry. Runs once at startup, before the server takes connections.
 *
 * Each version is checked again on the way in. One that fails is skipped with a warning,
 * never allowed to stop the server: official games and every other room keep working.
 *  - Its code must still match the fingerprint saved when it was generated and reviewed,
 *    so code edited directly in the database is not run.
 *  - Its game info must be valid. Block games made before frame games (plan §13) fail
 *    here and are skipped, not deleted: main can still run them from the same database.
 *
 * A game runs under its database id (see liveGameId), so a generated game can never take
 * over an official game's id.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('./registry.js').GameRegistry} registry
 * @param {{ warn?: (message: string) => void }} [opts]
 * @returns {Promise<{ loaded: string[], skipped: { id: string, reason: string }[] }>}
 */
export async function loadGeneratedGames(db, registry, { warn = (m) => console.warn(m) } = {}) {
  const loaded = [];
  const skipped = [];
  for (const { game, version, as } of listLiveVersions(db)) {
    try {
      loaded.push(await registerVersion(registry, game, version, as));
    } catch (err) {
      const id = liveGameId(game.id, as, version.version);
      const reason = err instanceof Error ? err.message.split('\n').join(' ') : String(err);
      skipped.push({ id, reason });
      warn(`[games] skipped generated game ${id}: ${reason}`);
    }
  }
  return { loaded, skipped };
}
