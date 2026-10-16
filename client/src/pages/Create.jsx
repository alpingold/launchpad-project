import { useCurrentUser } from '../net/auth.js';
import { useOwnGamesApi } from '../net/admin.js';
import { usePageTitle } from '../usePageTitle.js';
import { GameMaker } from './Admin.jsx';

// Make your own games with AI (plan §15), for any account, with your own GenAI Studio key.
// The same tool as the admin page, on your own games only. The server enforces all of it.
// Logged out: this page says what you need (an account, then a key) instead of redirecting.

const SIGN_UP_URL = '/login?mode=signup&next=/create';
const LOG_IN_URL = '/login?next=/create';

export default function Create() {
  usePageTitle('Make a game');
  useOwnGamesApi(); // this page talks to /api/generations (each page load is a fresh start: D12)
  const user = useCurrentUser();

  if (user === undefined) {
    return (
      <main className="page">
        <h1>Checking your login…</h1>
      </main>
    );
  }
  if (user === null) {
    return (
      <main className="page">
        <h1>Make a game</h1>
        <p>
          Describe a game and the AI designs and builds it for you. To do that you need a free account, and then your own
          Purdue GenAI Studio API key (the account page shows how to get one).
        </p>
        <p className="create-actions">
          <a className="primary-button" href={SIGN_UP_URL}>
            Create an account
          </a>
          <a href={LOG_IN_URL}>I already have one: log in</a>
        </p>
      </main>
    );
  }
  return (
    <GameMaker
      heading="Make a game"
      intro={
        <p className="muted">
          Describe a game and the AI designs it: read the design, ask for changes, then press Build it. The AI writes the
          game and tests it in a hidden browser. It runs on <a href="/account">your own GenAI Studio key</a>, one game at a
          time. Your games are only for you: host them from their page in the <a href="/games">catalogue</a>. The site admin decides
          which ones everyone can play.
        </p>
      }
    />
  );
}
