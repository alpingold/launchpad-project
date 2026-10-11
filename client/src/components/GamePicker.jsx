import { useState } from 'react';
import { useGames } from '../net/useGames.js';

/**
 * Lets the host choose a game and start it. The list comes from GET /api/games.
 * The Start button is disabled when the player count doesn't fit the game; the server
 * checks again anyway (WRONG_PLAYER_COUNT), since it's the authority.
 *
 * @param {{ playerCount: number, onStart: (gameId: string) => void, disabled?: boolean }} props
 */
export default function GamePicker({ playerCount, onStart, disabled = false }) {
  const games = useGames(); // null while loading
  const [chosenId, setChosenId] = useState(null); // null = the first game in the list

  if (games === null) return <p className="muted">Loading games…</p>;
  if (games.length === 0) return <p className="muted">No games installed yet.</p>;

  const selectedId = chosenId ?? games[0].id;

  const selected = games.find((g) => g.id === selectedId);
  const fits = selected && playerCount >= selected.minPlayers && playerCount <= selected.maxPlayers;

  return (
    <div className="game-picker">
      <label>
        Game{' '}
        <select value={selectedId} onChange={(e) => setChosenId(e.target.value)}>
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
