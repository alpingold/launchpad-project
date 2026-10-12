import { useState } from 'react';
import { useGames } from '../net/useGames.js';
import { usePageTitle } from '../usePageTitle.js';

// The public front page: what this is, how it works, and the two ways in.
// (M7 will ask hosts to log in before /host; joining stays open to guests.)
export default function Home() {
  usePageTitle(null);
  const games = useGames();
  const [code, setCode] = useState('');

  function goJoin(event) {
    event.preventDefault();
    // The join page reads ?code= and fills it in, so players only type their name there.
    window.location.href = code ? `/join?code=${encodeURIComponent(code)}` : '/join';
  }

  return (
    <main className="page home">
      <section className="hero">
        <h1>BoilerGames</h1>
        <p className="tagline">Party games on one big screen, played from everyone's phones.</p>
        <p className="muted">Made for Purdue LaunchPad. No app to install: just a browser.</p>
      </section>

      <section className="home-actions" aria-label="Get started">
        <div className="card">
          <h2>Join a game</h2>
          <p className="muted">Got a room code from the big screen?</p>
          <form onSubmit={goJoin} className="home-join-form">
            <label className="visually-hidden" htmlFor="home-code">
              Room code
            </label>
            <input
              id="home-code"
              className="mono code-input"
              placeholder="CODE"
              value={code}
              // Keep letters only, THEN cut to 4. (maxLength would cut first, so pasting
              // "bc-df" would lose a letter.)
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <button type="submit" className="primary-button">
              Join
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Host a game</h2>
          <p className="muted">Open a room on a laptop or TV everyone can see.</p>
          <a className="primary-button" href="/host">
            Host a game
          </a>
        </div>
      </section>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works">How it works</h2>
        <ol className="steps">
          <li>
            <strong>The host opens a room</strong> on a big screen. It shows a 4-letter room code.
          </li>
          <li>
            <strong>Everyone else joins from their phone</strong> at <span className="mono">{window.location.host}/join</span>{' '}
            with the code and a name.
          </li>
          <li>
            <strong>The host picks a game</strong>, and your phone becomes the controller.
          </li>
        </ol>
      </section>

      <section aria-labelledby="games-heading">
        <h2 id="games-heading">Games</h2>
        {games === null && <p className="muted">Loading…</p>}
        {games?.length === 0 && <p className="muted">No games available right now.</p>}
        <ul className="game-cards">
          {games?.map((game) => (
            <li key={game.id} className="card">
              <h3>{game.name}</h3>
              <p>{game.description}</p>
              <p className="muted small">
                {game.minPlayers === game.maxPlayers
                  ? `${game.minPlayers} players`
                  : `${game.minPlayers}–${game.maxPlayers} players`}
              </p>
            </li>
          ))}
        </ul>
        <p className="muted small">More games, including a Mario Party-style board game, are on the way.</p>
      </section>
    </main>
  );
}
