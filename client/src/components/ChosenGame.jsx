import AiBadge from './AiBadge.jsx';
import { GameThumb, playersText, minutesText } from './GameCard.jsx';
import { fits } from './catalogue.js';

/**
 * The game this room will play (plan §17): chosen in the catalogue before the room opened.
 * Start is disabled while the player count doesn't fit; the server checks again anyway
 * (WRONG_PLAYER_COUNT). "Change game" ends the room and goes back to the catalogue.
 *
 * @param {{ game: import('../net/useGames.js').GameInfo, playerCount: number, onStart: () => void,
 *   onChange: () => void, disabled?: boolean }} props
 */
export default function ChosenGame({ game, playerCount, onStart, onChange, disabled = false }) {
  const ok = fits(game, playerCount);
  const length = minutesText(game.minutes);
  return (
    <section className="game-picker chosen-game" aria-labelledby="chosen-game-heading">
      <GameThumb game={game} />
      <div className="chosen-game-info">
        <h2 id="chosen-game-heading">
          Next game: <span className="game-picker-choice">{game.name}</span>
          <AiBadge game={game} />
        </h2>
        <p className="muted">
          {playersText(game)}
          {length && ` · ${length}`}
        </p>
        {!ok && <p className="muted">Needs {playersText(game)}.</p>}
        <div className="chosen-game-buttons">
          <button type="button" className="primary-button" disabled={!ok || disabled} onClick={onStart}>
            Start game
          </button>
          <button type="button" className="secondary-button" disabled={disabled} onClick={onChange}>
            Change game
          </button>
        </div>
      </div>
    </section>
  );
}
