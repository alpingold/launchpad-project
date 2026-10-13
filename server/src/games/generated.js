import { listLoadableGames, sha256 } from '../db/generatedGames.js';
import { loadGameSource } from './loadSource.js';

/**
 * Loads the AI-generated games the admin has approved (playtest or published) from the
 * database into the registry. Runs once at startup, before the server takes connections.
 *
 * Each game is checked again on the way in. A game that fails is skipped with a warning,
 * never allowed to stop the server: official games and every other room keep working.
 *  - Its code must still match the fingerprint saved when it was generated and reviewed,
 *    so code edited directly in the database is not run.
 *  - It must load and pass validateGameModule (e.g. after a contract version change).
 *
 * The game runs under its database id ("g-…"), whatever id its own code declares, so a
 * generated game can never take over an official game's id.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('./registry.js').GameRegistry} registry
 * @param {{ warn?: (message: string) => void }} [opts]
 * @returns {Promise<{ loaded: string[], skipped: { id: string, reason: string }[] }>}
 */
export async function loadGeneratedGames(db, registry, { warn = (m) => console.warn(m) } = {}) {
  const loaded = [];
  const skipped = [];
  for (const row of listLoadableGames(db)) {
    const skip = (reason) => {
      skipped.push({ id: row.id, reason });
      warn(`[games] skipped generated game ${row.id}: ${reason}`);
    };
    if (sha256(row.source) !== row.sourceSha256) {
      skip("its code doesn't match the code that was reviewed");
      continue;
    }
    try {
      const mod = await loadGameSource(row.source, `${row.id}.js`);
      registry.register({ ...mod, id: row.id }, { source: 'generated', status: row.status, ownerUserId: row.ownerUserId });
      loaded.push(row.id);
    } catch (err) {
      skip(err instanceof Error ? err.message.split('\n').join(' ') : String(err));
    }
  }
  return { loaded, skipped };
}
