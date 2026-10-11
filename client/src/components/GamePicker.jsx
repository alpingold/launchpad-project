import { useEffect, useState } from 'react';

/**
 * Lets the host choose a game and start it. The list comes from GET /api/games.
 * The Start button is disabled when the player count doesn't fit the game; the server
 * checks again anyway (WRONG_PLAYER_COUNT), since it's the authority.
 *
 * @param {{ playerCount: number, onStart: (gameId: string) => void, disabled?: boolean }} props
 */
export default function GamePicker({ playerCount, onStart, disabled = false }) {
  const [games, setGames] = useState(null); // null while loading
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    fetch('/api/games')
      .then((res) => res.json())
      .then((data) => {
        setGames(data.games);
        if (data.games.length > 0) setSelectedId(data.games[0].id);
      })
      .catch(() => setGames([]));
  }, []);

  if (games === null) return <p className="muted">Loading games…</p>;
  if (games.length === 0) return <p className="muted">No games installed yet.</p>;

  const selected = games.find((g) => g.id === selectedId);
  const fits = selected && playerCount >= selected.minPlayers && playerCount <= selected.maxPlayers;

  return (
    <div className="game-picker">
      <label>
        Game{' '}
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {selected && <p className="muted">{selected.description}</p>}
      {selected && !fits && (
        <p className="muted">
          Needs {selected.minPlayers}–{selected.maxPlayers} players.
        </p>
      )}
      <button type="button" className="primary-button" disabled={!fits || disabled} onClick={() => onStart(selectedId)}>
        Start game
      </button>
    </div>
  );
}
