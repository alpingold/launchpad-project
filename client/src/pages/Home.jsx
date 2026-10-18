import { useState } from 'react';
import { useGames } from '../net/useGames.js';
import { usePageTitle } from '../usePageTitle.js';
import { useCurrentUser, logOut } from '../net/auth.js';
import GameCard from '../components/GameCard.jsx';
import { filterGames, NO_FILTERS } from '../components/catalogue.js';
import { EXAMPLE_IDEAS } from './Create.jsx';

/** How many games each row of the front page shows; the rest are on /games. */
const HOME_GAMES = 3;

/** The four spaces of making a game, as /create's track shows them (plan §19). */
const MAKING = [
  ['Idea', 'You describe it in a few sentences.'],
  ['Design', 'The AI writes the rules. You read them and ask for changes.'],
  ['Build', 'It codes the game and plays it with bot phones until it works.'],
  ['Play', 'The big screen is the board. Phones are the controllers.'],
];

// The public front page (plan §42): making a game with AI first, since that's what the site
// is for; a room code box beside it for people arriving to play; then the most-voted games,
// games players made, and how hosting works.
export default function Home() {
  usePageTitle(null);
  const games = useGames();
  const user = useCurrentUser(); // undefined while checking, then a user or null

  // Everyone's games: not playtest versions (those only show to their maker).
  const listed = games?.filter((g) => g.status !== 'playtest') ?? null;
  const top = listed && filterGames(listed, { ...NO_FILTERS, sort: 'top' }).slice(0, HOME_GAMES);
  const anyVotes = listed?.some((g) => g.votes.up + g.votes.down > 0);
  const madeWithAi = listed && filterGames(listed.filter((g) => g.source === 'generated'), { ...NO_FILTERS, sort: 'newest' }).slice(0, HOME_GAMES);

  return (
    <main className="page home">
      <div className="home-top">
        <IdeaHero />
        <JoinBox user={user} />
      </div>

      <section className="home-row" aria-labelledby="top-games-heading">
        <div className="home-row-head">
          <h2 id="top-games-heading">{anyVotes ? 'Most-voted games' : 'Games'}</h2>
          {anyVotes && <p className="muted small">Players vote on each game's page. These three are ahead.</p>}
        </div>
        {games === null && <p className="muted">Loading…</p>}
        {listed?.length === 0 && <p className="muted">No games available right now.</p>}
        <ul className="game-cards">
          {top?.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </ul>
        {listed?.length > 0 && (
          <p>
            <a className="primary-button" href="/games">
              {listed.length > HOME_GAMES ? `See all ${listed.length} games` : 'Browse the games'}
            </a>
          </p>
        )}
      </section>

      {madeWithAi && (
        <section className="home-row" aria-labelledby="ai-games-heading">
          <div className="home-row-head">
            <h2 id="ai-games-heading">Made by players, with AI</h2>
            {madeWithAi.length > 0 && <p className="muted small">The newest games people described and published.</p>}
          </div>
          {madeWithAi.length > 0 ? (
            <ul className="game-cards">
              {madeWithAi.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </ul>
          ) : (
            <p className="empty-invite">
              Nobody has published one yet. <a href="#home-idea">Describe yours</a> and it could be the first.
            </p>
          )}
        </section>
      )}

      <section className="home-row" aria-labelledby="how-it-works">
        <h2 id="how-it-works">How a game night works</h2>
        <ol className="how-track">
          <li>
            <span className="how-dot" aria-hidden="true">1</span>
            <p>
              <strong>The host picks a game and opens a room</strong> on a big screen. It shows a 4-letter room code.
            </p>
          </li>
          <li>
            <span className="how-dot" aria-hidden="true">2</span>
            <p>
              <strong>Everyone else joins from their phone</strong> at <span className="mono">{window.location.host}/join</span>{' '}
              with the code and a name.
            </p>
          </li>
          <li>
            <span className="how-dot" aria-hidden="true">3</span>
            <p>
              <strong>The host starts the game</strong>, and your phone becomes the controller.
            </p>
          </li>
        </ol>
        <p className="muted small">
          Fair warning: it's a demo, so things will break. Tell me when they do: I want your input on everything. Made for
          Purdue LaunchPad; no app to install, just a browser. Curious how games work inside? See the <a href="/kit">docs</a>.
        </p>
      </section>
    </main>
  );
}

/** The idea box, on the first space of the making track: it opens /create with the idea filled in. */
function IdeaHero() {
  const [idea, setIdea] = useState('');

  function start(event) {
    event.preventDefault();
    const text = idea.trim();
    window.location.href = text ? `/create?idea=${encodeURIComponent(text)}` : '/create';
  }

  return (
    <section className="home-make" aria-labelledby="home-make-heading">
      <h1 id="home-make-heading">Describe a party game. The AI builds it.</h1>
      <p className="home-make-lede">
        Games for one big screen, played from everyone's phones. Write what happens and how you win; play it once it's
        built.
      </p>
      <form className="home-idea" onSubmit={start}>
        <label htmlFor="home-idea">Your game idea</label>
        <textarea
          id="home-idea"
          rows={3}
          maxLength={1000}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="Everyone secretly picks a number on their phone. The big screen reveals them one by one…"
        />
        <div className="home-idea-row">
          <div className="home-idea-examples">
            <span className="muted small">Or start from:</span>
            {EXAMPLE_IDEAS.slice(0, 3).map((example) => (
              <button key={example.label} type="button" className="tag-chip" onClick={() => setIdea(example.idea)}>
                {example.label}
              </button>
            ))}
          </div>
          <button type="submit" className="primary-button home-idea-go">
            Make this game
          </button>
        </div>
      </form>
      <ol className="home-track" aria-label="How a game gets made">
        {MAKING.map(([name, what], i) => (
          <li key={name} className="home-track-space">
            <span className="home-track-dot" aria-hidden="true">
              {i + 1}
            </span>
            <strong>{name}</strong>
            <span className="muted small">{what}</span>
          </li>
        ))}
        {/* Your game, as on /create: it starts on Idea. */}
        <span className="home-track-token" aria-hidden="true">
          ✎
        </span>
      </ol>
      <p className="muted small home-make-needs">
        Free account, plus your own Purdue GenAI Studio key (the account page shows how to get one). Building takes about
        5–10 minutes.
      </p>
    </section>
  );
}

/** For people who came to play: the room code box, and the host's way in. */
function JoinBox({ user }) {
  const [code, setCode] = useState('');

  function goJoin(event) {
    event.preventDefault();
    // The join page reads ?code= and fills it in, so players only type their name there.
    window.location.href = code ? `/join?code=${encodeURIComponent(code)}` : '/join';
  }

  return (
    <aside className="home-join" aria-label="Join or host">
      <h2>Got a room code?</h2>
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
      <div className="home-host">
        <h2>Hosting?</h2>
        {user ? (
          <>
            <a className="secondary-button" href="/games">
              Pick a game
            </a>
            <p className="muted small">
              Logged in as {user.username} · <a href="/account">Account</a> ·{' '}
              {user.isAdmin && (
                <>
                  <a href="/admin">AI games</a> ·{' '}
                </>
              )}
              <button
                type="button"
                className="link-button"
                onClick={async () => {
                  await logOut();
                  window.location.reload();
                }}
              >
                Log out
              </button>
            </p>
          </>
        ) : (
          <>
            <a className="secondary-button" href="/login?next=/games">
              Log in to host
            </a>
            <p className="muted small">Hosts need a free account. Players don't.</p>
          </>
        )}
      </div>
    </aside>
  );
}
