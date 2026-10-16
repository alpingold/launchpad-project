import { useEffect, useState } from 'react';

/**
 * A game as GET /api/games lists it (server/src/games/registry.js list()).
 * @typedef {{ id: string, name: string, description: string, minPlayers: number, maxPlayers: number,
 *   tags: string[], minutes: [number, number] | null, addedAt: number | null, hasThumb: boolean,
 *   source: 'official' | 'generated', status?: 'playtest' | 'published', version?: number }} GameInfo
 *   status and version: AI-generated games only. tags []/minutes null: the game doesn't say.
 */

/**
 * The games this server offers, from GET /api/games.
 * @returns {GameInfo[] | null} null while loading; an empty list if the request failed
 */
export function useGames() {
  const [games, setGames] = useState(null);
  useEffect(() => {
    let current = true;
    fetch('/api/games')
      .then((res) => res.json())
      .then((data) => current && setGames(data.games))
      .catch(() => current && setGames([]));
    return () => {
      current = false;
    };
  }, []);
  return games;
}
