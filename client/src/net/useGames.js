import { useEffect, useState } from 'react';

/**
 * A game as GET /api/games lists it (server/src/games/catalog.js CatalogGame).
 * @typedef {{ id: string, pageId: string, name: string, description: string, minPlayers: number, maxPlayers: number,
 *   tags: string[], minutes: [number, number] | null, addedAt: number | null, shots: ('host' | 'phone')[],
 *   source: 'official' | 'generated', status?: 'playtest' | 'published', version?: number,
 *   creator: { username: string } | null, votes: { up: number, down: number }, myVote: 1 | -1 | 0,
 *   canEdit: boolean, canVote: boolean }} GameInfo
 *   status and version: AI-generated games only. tags []/minutes null: the game doesn't say.
 *   shots: the main one first. creator null: an official game (made by BoilerGames).
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
