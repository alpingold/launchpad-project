import { useState } from 'react';
import AiBadge from './AiBadge.jsx';

/** "2–12 players", or "4 players" when it's exactly one number. */
export function playersText({ minPlayers, maxPlayers }) {
  return minPlayers === maxPlayers ? `${minPlayers} player${minPlayers === 1 ? '' : 's'}` : `${minPlayers}–${maxPlayers} players`;
}

/** "5–15 min", "about 10 min", or null when the game doesn't say (older games). */
export function minutesText(minutes) {
  if (!minutes) return null;
  return minutes[0] === minutes[1] ? `about ${minutes[0]} min` : `${minutes[0]}–${minutes[1]} min`;
}

/**
 * One game in the catalogue (plan §14): its picture, name, description, players, length and
 * tags. With `onSelect` it's a choice in a group (the host lobby): a radio button, and the
 * whole card can be clicked. `action` is shown at the bottom (e.g. a "Host this game" link).
 *
 * @param {{ game: import('../net/useGames.js').GameInfo, selected?: boolean,
 *   onSelect?: (id: string) => void, misfit?: boolean, action?: import('react').ReactNode }} props
 *   misfit: the room has too few or too many players for it
 */
export default function GameCard({ game, selected = false, onSelect, misfit = false, action }) {
  const length = minutesText(game.minutes);
  const classes = ['card', 'game-card', onSelect && 'game-card-pickable', selected && 'game-card-selected', misfit && 'game-card-misfit'];
  return (
    <li className={classes.filter(Boolean).join(' ')} onClick={onSelect ? () => onSelect(game.id) : undefined}>
      <GameThumb game={game} />
      <h3>
        {onSelect && (
          <input type="radio" name="game" value={game.id} checked={selected} onChange={() => onSelect(game.id)} aria-label={game.name} />
        )}
        {game.name}
        <AiBadge game={game} />
      </h3>
      <p className="game-card-description">{game.description}</p>
      <p className="muted small game-card-facts">
        {playersText(game)}
        {length && ` · ${length}`}
      </p>
      {game.tags.length > 0 && (
        <ul className="game-tags" aria-label="Tags">
          {game.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      {action}
    </li>
  );
}

/**
 * The game's screenshot, or a coloured tile with its first letter when it has none (or the
 * picture fails to load). Decorative: the name is right below it.
 */
function GameThumb({ game }) {
  const [failed, setFailed] = useState(false);
  if (game.hasThumb && !failed) {
    return <img className="game-thumb" src={`/api/games/${encodeURIComponent(game.id)}/thumb`} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <div className="game-thumb game-thumb-tile" style={{ '--tile-hue': hue(game.id) }} aria-hidden="true">
      {game.name.trim().charAt(0).toUpperCase()}
    </div>
  );
}

/** The same colour for the same game every time. */
function hue(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
