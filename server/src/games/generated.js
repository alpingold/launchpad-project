import { listLiveVersions, sha256 } from '../db/generatedGames.js';
import { loadGameSource } from './loadSource.js';

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
 * Checks one version's code and adds it to the registry under its live id.
 * Throws (with a readable message) if the code was changed since it was tested, or if it
 * doesn't load as a valid game.
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
  const mod = await loadGameSource(version.source, `${id}.js`);
  const meta = { source: 'generated', status: as, ownerUserId: game.ownerUserId, version: version.version };
  registry.register({ ...mod, id }, meta, { replace });
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
 *  - It must load and pass validateGameModule (e.g. after a contract version change).
 *
 * A game runs under its database id (see liveGameId), whatever id its own code declares,
 * so a generated game can never take over an official game's id.
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
