// The game catalogue's filters (plan §14), as plain functions so they're easy to test.
// The list is small (tens of games), so everything is worked out in the browser.

/**
 * @typedef {Object} CatalogueFilters
 * @property {string} search       part of the name or description; '' for all
 * @property {string[]} tags       games must have every one of these
 * @property {number | null} players  games this many people can play; null for any
 * @property {'featured' | 'name' | 'newest'} sort
 *   featured: the server's order (official games first); newest: AI-made games by when
 *   they were made, official games after them
 */

/** @type {CatalogueFilters} */
export const NO_FILTERS = { search: '', tags: [], players: null, sort: 'featured' };

/** Can this many players play it? */
export function fits(game, players) {
  return players >= game.minPlayers && players <= game.maxPlayers;
}

/**
 * The games to show, in order.
 * @template {{ name: string, description: string, tags: string[], minPlayers: number, maxPlayers: number, addedAt: number | null }} G
 * @param {G[]} games
 * @param {CatalogueFilters} filters
 * @returns {G[]}
 */
export function filterGames(games, { search, tags, players, sort }) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = games.filter(
    (g) =>
      words.every((w) => `${g.name} ${g.description}`.toLowerCase().includes(w)) &&
      tags.every((t) => g.tags.includes(t)) &&
      (players === null || fits(g, players)),
  );
  if (sort === 'name') return shown.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'newest') return shown.sort((a, b) => (b.addedAt ?? -1) - (a.addedAt ?? -1));
  return shown;
}

/** Every tag the games use, most used first (ties A–Z), for the filter chips. */
export function tagsInUse(games) {
  const counts = new Map();
  for (const g of games) for (const t of g.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
