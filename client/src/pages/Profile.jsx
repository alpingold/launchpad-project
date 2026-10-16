import { useEffect, useState } from 'react';
import { usePageTitle } from '../usePageTitle.js';
import { useCurrentUser } from '../net/auth.js';
import GameCard from '../components/GameCard.jsx';

// Someone's profile (plan §16): their bio and the games of theirs you can see.

/** @param {{ username: string }} props  from the address */
export default function Profile({ username }) {
  const [data, setData] = useState(undefined); // undefined: loading; null: no such account
  const me = useCurrentUser();
  usePageTitle(data?.profile.username ?? username);

  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(username)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [username]);

  if (data === undefined) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (data === null) {
    return (
      <main className="page">
        <h1>No such account</h1>
        <p>
          Nobody here is called {username}. See <a href="/games">all the games</a>.
        </p>
      </main>
    );
  }
  const { profile, games } = data;
  const mine = me?.username === profile.username;
  return (
    <main className="page games-page profile-page">
      <h1>{profile.username}</h1>
      <p className="muted small">Joined {new Date(profile.joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</p>
      {profile.bio ? <p className="profile-bio">{profile.bio}</p> : <p className="muted">No bio yet.</p>}
      {mine && (
        <p className="small">
          <a href="/account">Edit your bio</a> · <a href="/create">Make a game</a>
        </p>
      )}
      <h2>Games</h2>
      {games.length === 0 ? (
        <p className="muted">{mine ? "You haven't made a game yet." : 'No games yet.'}</p>
      ) : (
        <ul className="game-cards">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </ul>
      )}
    </main>
  );
}
