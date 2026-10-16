import { useState } from 'react';
import GameCard from './GameCard.jsx';
import { NO_FILTERS, filterGames, fits, tagsInUse } from './catalogue.js';

const MAX_PLAYERS = 12;

/**
 * The game catalogue (plan §14): search, tag chips, a player count and a sort order above
 * a grid of game cards. Used by the /games page (browse, each card with an action) and by
 * the host lobby (pick one: pass `selectedId` and `onSelect`).
 *
 * @param {{ games: import('../net/useGames.js').GameInfo[],
 *   roomPlayers?: number,
 *   selectedId?: string | null, onSelect?: (id: string) => void,
 *   action?: (game: import('../net/useGames.js').GameInfo) => import('react').ReactNode }} props
 *   roomPlayers: in the lobby, how many people are in the room (offered as a filter, and
 *   cards that don't fit it are dimmed)
 */
export default function GameCatalogue({ games, roomPlayers, selectedId = null, onSelect, action }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const set = (change) => setFilters((f) => ({ ...f, ...change }));
  const shown = filterGames(games, filters);
  const allTags = tagsInUse(games);
  const filtered = filters.search !== '' || filters.tags.length > 0 || filters.players !== null;

  return (
    <div className="catalogue">
      <div className="catalogue-filters">
        <label>
          <span className="visually-hidden">Search games</span>
          <input type="search" placeholder="Search games" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        </label>
        <label>
          <span className="visually-hidden">Players</span>
          <select
            value={filters.players ?? ''}
            onChange={(e) => set({ players: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">Any number of players</option>
            {Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === roomPlayers ? `${n} player${n === 1 ? '' : 's'} (this room)` : `${n} player${n === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="visually-hidden">Sort</span>
          <select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="featured">Featured</option>
            <option value="top">Top rated</option>
            <option value="name">A–Z</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>
      {allTags.length > 0 && (
        <div className="catalogue-tags" role="group" aria-label="Filter by tag">
          {allTags.map((tag) => {
            const on = filters.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className="tag-chip"
                aria-pressed={on}
                onClick={() => set({ tags: on ? filters.tags.filter((t) => t !== tag) : [...filters.tags, tag] })}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
      <p className="muted small" aria-live="polite">
        {shown.length === games.length ? `${games.length} game${games.length === 1 ? '' : 's'}` : `${shown.length} of ${games.length} games`}
        {filtered && (
          <>
            {' · '}
            <button type="button" className="link-button" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </button>
          </>
        )}
      </p>
      {shown.length === 0 ? (
        <p className="muted">No games match.</p>
      ) : (
        <ul className="game-cards" role={onSelect ? 'radiogroup' : undefined} aria-label={onSelect ? 'Game' : undefined}>
          {shown.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              selected={game.id === selectedId}
              onSelect={onSelect}
              misfit={roomPlayers !== undefined && !fits(game, roomPlayers)}
              action={action?.(game)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
