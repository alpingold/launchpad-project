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

/** A game's own page (plan §16). */
export const gamePath = (game) => `/games/${encodeURIComponent(game.id)}`;

/** Who made it: a link to their profile, or BoilerGames for the official games (plan §16). */
export function Creator({ game, link = true }) {
  if (!game.creator) return <span className="game-creator">by BoilerGames</span>;
  const name = game.creator.username;
  return (
    <span className="game-creator">
      by {link ? <a href={`/u/${encodeURIComponent(name)}`}>{name}</a> : name}
    </span>
  );
}

/** "▲ 4 · ▼ 1", or nothing before anyone has voted. (▲▼, not emoji: every font has them.) */
export function VoteCount({ votes }) {
  if (votes.up + votes.down === 0) return null;
  return (
    <span className="game-votes" aria-label={`${votes.up} up, ${votes.down} down`}>
      ▲ {votes.up} · ▼ {votes.down}
    </span>
  );
}

/**
 * One game in the catalogue (plan §14, §16): its picture, name, creator, description, players,
 * length, votes and tags.
 * - Browsing (no `onSelect`): the whole card opens the game's page; the creator's name opens
 *   their profile.
 * - Choosing (the host lobby, with `onSelect`): a radio button, and the whole card chooses it.
 *   No links there, so a click never leaves the room page.
 * `action` is shown at the bottom (e.g. a "Host this game" link).
 *
 * @param {{ game: import('../net/useGames.js').GameInfo, selected?: boolean,
 *   onSelect?: (id: string) => void, misfit?: boolean, action?: import('react').ReactNode }} props
 *   misfit: the room has too few or too many players for it
 */
export default function GameCard({ game, selected = false, onSelect, misfit = false, action }) {
  const length = minutesText(game.minutes);
  const browsing = !onSelect;
  const classes = ['card', 'game-card', browsing ? 'game-card-link' : 'game-card-pickable', selected && 'game-card-selected', misfit && 'game-card-misfit'];
  return (
    <li className={classes.filter(Boolean).join(' ')} onClick={onSelect ? () => onSelect(game.id) : undefined}>
      <GameThumb game={game} />
      <h3>
        {onSelect && (
          <input type="radio" name="game" value={game.id} checked={selected} onChange={() => onSelect(game.id)} aria-label={game.name} />
        )}
        {browsing ? (
          <a className="game-card-title" href={gamePath(game)}>
            {game.name}
          </a>
        ) : (
          game.name
        )}
        <AiBadge game={game} />
      </h3>
      <p className="muted small game-card-by">
        <Creator game={game} link={browsing} />
        <VoteCount votes={game.votes} />
      </p>
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
 * The game's main screenshot, or a coloured tile with its first letter when it has none (or the
 * picture fails to load). Decorative: the name is right below it.
 */
export function GameThumb({ game }) {
  const [failed, setFailed] = useState(false);
  if (game.shots.length > 0 && !failed) {
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
