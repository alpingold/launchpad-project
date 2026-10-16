import { useState } from 'react';
import { useGames } from '../net/useGames.js';
import GameCatalogue from './GameCatalogue.jsx';
import { playersText } from './GameCard.jsx';
import { fits } from './catalogue.js';

/**
 * Lets the host choose a game from the catalogue (plan §14) and start it. The list comes
 * from GET /api/games. The Start button is disabled when the player count doesn't fit the
 * game; the server checks again anyway (WRONG_PLAYER_COUNT), since it's the authority.
 *
 * @param {{ playerCount: number, onStart: (gameId: string) => void, disabled?: boolean,
 *   initialGameId?: string | null }} props
 *   initialGameId: chosen at first, e.g. from /host?game=… (the /games page's "Host this game")
 */
export default function GamePicker({ playerCount, onStart, disabled = false, initialGameId = null }) {
  const games = useGames(); // null while loading
  const [chosenId, setChosenId] = useState(initialGameId); // null (or an unknown id) = the first game

  if (games === null) return <p className="muted">Loading games…</p>;
  if (games.length === 0) return <p className="muted">No games installed yet.</p>;

  const selected = games.find((g) => g.id === chosenId) ?? games[0];
  const ok = fits(selected, playerCount);

  return (
    <section className="game-picker" aria-labelledby="game-picker-heading">
      <div className="game-picker-bar">
        <h2 id="game-picker-heading">
          Next game: <span className="game-picker-choice">{selected.name}</span>
        </h2>
        {!ok && <p className="muted">Needs {playersText(selected)}.</p>}
        <button type="button" className="primary-button" disabled={!ok || disabled} onClick={() => onStart(selected.id)}>
          Start game
        </button>
      </div>
      <GameCatalogue games={games} roomPlayers={playerCount} selectedId={selected.id} onSelect={setChosenId} />
    </section>
  );
}
