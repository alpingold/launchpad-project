import { useEffect } from 'react';
import { useCurrentUser } from '../net/auth.js';
import { useOwnGamesApi } from '../net/admin.js';
import { usePageTitle } from '../usePageTitle.js';
import { GameMaker } from './Admin.jsx';

// Make your own games with AI (plan §15), for any account, with your own GenAI Studio key.
// The same tool as the admin page, on your own games only. The server enforces all of it.

const LOGIN_URL = '/login?next=/create';

export default function Create() {
  usePageTitle('Make a game');
  useOwnGamesApi(); // this page talks to /api/generations (each page load is a fresh start: D12)
  const user = useCurrentUser();

  useEffect(() => {
    if (user === null) window.location.replace(LOGIN_URL);
  }, [user]);

  if (!user) {
    return (
      <main className="page">
        <h1>Checking your login…</h1>
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
          time. Your games are only for you: start them from the <a href="/host">host page</a>. The site admin decides
          which ones everyone can play.
        </p>
      }
    />
  );
}
