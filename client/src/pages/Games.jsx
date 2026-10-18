import { useGames } from '../net/useGames.js';
import { usePageTitle } from '../usePageTitle.js';
import { useCurrentUser } from '../net/auth.js';
import GameCatalogue from '../components/GameCatalogue.jsx';

// The public game catalogue (plan §14): browse every game, then host one. Hosting needs an
// account, so logged-out visitors go through the login page and come back to the lobby
// with that game chosen.
export default function Games() {
  usePageTitle('Games');
  const games = useGames();
  const user = useCurrentUser(); // undefined while checking, then a user or null

  const hostUrl = (id) => {
    const lobby = `/host?game=${encodeURIComponent(id)}`;
    return user ? lobby : `/login?next=${encodeURIComponent(lobby)}`;
  };

  return (
    <main className="page games-page">
      <h1>Games</h1>
      <p className="muted">
        Every game runs on one big screen, with phones as controllers. Not seeing the one you want?{' '}
        <a href="/create">Describe it and the AI makes it</a>.
      </p>
      {games === null && <p className="muted">Loading…</p>}
      {games?.length === 0 && <p className="muted">No games available right now.</p>}
      {games?.length > 0 && (
        <GameCatalogue
          games={games}
          action={(game) => (
            <a className="primary-button game-card-action" href={hostUrl(game.id)} aria-label={`Host ${game.name}`}>
              Host this game
            </a>
          )}
        />
      )}
    </main>
  );
}
