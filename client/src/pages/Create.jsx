import { useEffect, useState } from 'react';
import { useCurrentUser } from '../net/auth.js';
import { useOwnGamesApi, listGenerations, startGeneration } from '../net/admin.js';
import { usePageTitle } from '../usePageTitle.js';
import { MiniTrack, whereIsSummary, timeAgo } from './CreateGame.jsx';

// Make your own games with AI (plan §15, guided flow §19), for any account, with your own
// GenAI Studio key: describe a game here, then each game has its own page, /create/<id>,
// that walks you through Idea → Design → Build → Play. The server enforces all of it.
// Logged out: this page says what you need (an account, then a key) instead of redirecting.

const SIGN_UP_URL = '/login?mode=signup&next=/create';
const LOG_IN_URL = '/login?next=/create';

/** Ideas to start from: games that fit a big screen and phones (plan §18). */
const EXAMPLE_IDEAS = [
  {
    label: 'Find the spy',
    idea: 'Everyone but one player sees the same secret place on their phone; the spy sees nothing. Take turns answering a question about it, then vote for who the spy is.',
  },
  {
    label: 'Draw and guess',
    idea: 'One player draws a secret word on their phone while it appears on the big screen; everyone else types guesses. Faster right guesses score more.',
  },
  {
    label: 'Think alike',
    idea: 'Each round asks a question like "name a pizza topping". Everyone answers secretly on their phone; you score a point for every other player who wrote the same thing.',
  },
  {
    label: 'Bluff the answer',
    idea: 'Show a strange trivia question. Everyone writes a fake answer that sounds true, then everyone votes for the real one among all of them. Points for finding it and for fooling others.',
  },
];

/** What a game is doing, in a few words, for the list. */
const STATUS_WORDS = {
  designing: 'The AI is writing the design',
  design: 'The design is ready to read',
  generating: 'The AI is building it',
  failed: "Didn't work: see what happened",
  review: 'Ready to play',
  playtest: 'Ready to play',
  published: 'Everyone can play it',
};

export default function Create() {
  usePageTitle('Make a game');
  useOwnGamesApi(); // this page talks to /api/generations (each page load is a fresh start: D12)
  const user = useCurrentUser();

  if (user === undefined) {
    return (
      <main className="page create">
        <p className="muted">Checking your login…</p>
      </main>
    );
  }
  if (user === null) {
    return (
      <main className="page create">
        <h1 className="create-title">Make a game</h1>
        <p>
          Describe a party game and the AI designs and builds it for you. To do that you need a free account, and then your
          own Purdue GenAI Studio API key (the account page shows how to get one).
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
  return <Maker />;
}

function Maker() {
  const [info, setInfo] = useState(null);
  const [games, setGames] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    listGenerations().then((res) => {
      if (!res.ok) return setLoadError(res.message ?? 'Could not load your games.');
      setInfo(res.info);
      setGames(res.games);
    });
  }, []);

  return (
    <main className="page create">
      <h1 className="create-title">Make a game</h1>
      <p className="create-lede">
        Describe a party game in a few sentences. The AI writes a design for you to read, then builds the game and tests it.
        You play it on a big screen, and your friends join on their phones.
      </p>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {info && <IdeaForm info={info} />}
      {games && <YourGames games={games} />}
    </main>
  );
}

function IdeaForm({ info }) {
  const [idea, setIdea] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Switched on here, and this person's jobs can run (their own key, or an admin: plan §15).
  const ready = info.enabled && info.canGenerate !== false;
  const length = idea.trim().length;
  const fits = length >= info.minIdeaLength && length <= info.maxIdeaLength;

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await startGeneration(idea, info.defaultModel);
    if (!res.ok) {
      setBusy(false);
      setError(res.message ?? 'Something went wrong. Please try again.');
      return;
    }
    window.location.assign(`/create/${encodeURIComponent(res.game.id)}`);
  }

  return (
    <section className="create-idea-box" aria-label="Your idea">
      {!info.enabled && (
        <p className="banner" role="status">
          {info.disabledReason}
        </p>
      )}
      {info.enabled && info.canGenerate === false && (
        <div className="banner create-key-banner" role="status">
          <p>
            <strong>Add your API key first.</strong> Making games runs on your own Purdue GenAI Studio API key. It takes a
            minute, and the account page shows how to get one.
          </p>
          <a className="primary-button" href="/account">
            Add your API key
          </a>
        </div>
      )}
      <form className="admin-form" onSubmit={handleSubmit}>
        <label>
          Game idea
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={4}
            maxLength={info.maxIdeaLength}
            placeholder="What do players do on their phones, what does the big screen show, and how do you win?"
            disabled={!ready || busy}
          />
        </label>
        <div className="create-examples">
          <span className="muted small">Or start from one:</span>
          {EXAMPLE_IDEAS.map((example) => (
            <button key={example.label} type="button" className="tag-chip" disabled={!ready || busy} onClick={() => setIdea(example.idea)}>
              {example.label}
            </button>
          ))}
        </div>
        <p className="muted small create-fit">
          Works best: secret choices, votes, words and drawings on the phones, with the big screen as the show. Not so well:
          anything that needs split-second timing, since a phone's taps reach the screen a little late.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="create-submit">
          <button type="submit" className="primary-button" disabled={!ready || !fits || busy}>
            {busy ? 'Starting…' : 'Write the design'}
          </button>
          <span className="muted small">
            {length < info.minIdeaLength ? `At least ${info.minIdeaLength} characters` : `${length}/${info.maxIdeaLength}`}
          </span>
        </div>
      </form>
    </section>
  );
}

function YourGames({ games }) {
  return (
    <section className="create-games" aria-labelledby="your-games-heading">
      <h2 id="your-games-heading">Your games</h2>
      {games.length === 0 ? (
        <p className="muted">Nothing yet. Your first game shows up here as soon as you start it.</p>
      ) : (
        <ul className="create-game-list">
          {games.map((game) => {
            const where = whereIsSummary(game);
            return (
              <li key={game.id}>
                <a href={`/create/${encodeURIComponent(game.id)}`} className="create-game-row">
                  <span className="create-game-name">{game.name ?? game.prompt}</span>
                  <MiniTrack at={where.at} state={where.state} />
                  <span className={`create-game-status status-${where.state}`}>
                    {game.progress?.queuePosition > 0 ? 'Waiting in line' : STATUS_WORDS[game.status] ?? game.status}
                  </span>
                  <span className="muted small create-game-when">started {timeAgo(game.createdAt)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
