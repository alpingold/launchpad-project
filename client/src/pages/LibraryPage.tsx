// /library: every Official game and every published Game, as cards, with a search box, a "how many
// of you are there?" filter and three sort orders. The whole list comes in one response and is
// searched here (library/shown.ts).
import { useEffect, useMemo, useState } from "react";
import { lookStyle } from "../kit/look-style.js";
import { aboutPlays, library, playerCount, type LibraryEntry } from "../library/library-api.js";
import { shown, type LibrarySort } from "../library/shown.js";

/** The site's own cap on a Room's Seats: nobody can be more people than this. */
const MOST_PEOPLE = 16;

const SORTS: readonly { readonly value: LibrarySort; readonly label: string }[] = [
  { value: "az", label: "A–Z" },
  { value: "newest", label: "Newest" },
  { value: "played", label: "Most played" },
];

export function LibraryPage() {
  const [entries, setEntries] = useState<readonly LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<number | null>(null);
  const [sort, setSort] = useState<LibrarySort>("az");
  useEffect(() => {
    void library().then((reply) => (reply.ok ? setEntries(reply.value) : setError(reply.error)));
  }, []);
  const games = useMemo(() => (entries === null ? [] : shown(entries, { search, people, sort })), [entries, search, people, sort]);

  return (
    <main className="page library">
      <p>
        <a href="/">BoilerGames</a>
      </p>
      <h1>Library</h1>
      <p>Every Game you can host: the site's own, and the ones Creators have published.</p>
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      <div className="library-controls">
        <label>
          Search
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="A title, a word, a Creator" />
        </label>
        <label>
          How many of you are there?
          <select value={people ?? ""} onChange={(e) => setPeople(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">Any number</option>
            {Array.from({ length: MOST_PEOPLE }, (_, index) => index + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {entries === null ? null : (
        <p role="status">{games.length === entries.length ? `${entries.length} Games` : `${games.length} of ${entries.length} Games`}</p>
      )}
      <ul className="library-cards">
        {games.map((game) => (
          <LibraryCard key={game.id} game={game} />
        ))}
      </ul>
    </main>
  );
}

/**
 * One Game's card, in its own Look's background and text colours: a ready Version's Look has been
 * checked for readable contrast between exactly those two.
 */
function LibraryCard({ game }: { game: LibraryEntry }) {
  return (
    <li className="library-card" aria-label={game.title} style={lookStyle(game.look)}>
      <h2>
        <a href={`/library/${encodeURIComponent(game.id)}`}>{game.title}</a>
      </h2>
      <p className="library-card-facts">
        <span>{playerCount(game.players)}</span>
        <span>{game.creator === null ? "Official" : `by ${game.creator}`}</span>
        <span>{aboutPlays(game.plays)}</span>
      </p>
      {game.description === "" ? null : <p className="library-card-description">{game.description}</p>}
    </li>
  );
}
