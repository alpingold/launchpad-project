import { useEffect, useState } from 'react';

/**
 * The games this server offers, from GET /api/games.
 * @returns {{id: string, name: string, description: string, minPlayers: number, maxPlayers: number,
 *   source: 'official' | 'generated', status?: 'playtest' | 'published'}[] | null}
 *   null while loading; an empty list if the request failed
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
