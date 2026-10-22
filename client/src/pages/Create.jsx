import { useEffect, useState } from 'react';
import { useCurrentUser } from '../net/auth.js';
import { useOwnGamesApi, listGenerations, startGeneration, uploadGame } from '../net/admin.js';
import { usePageTitle } from '../usePageTitle.js';
import GenaiStatus from '../components/GenaiStatus.jsx';
import { MiniTrack, whereIsSummary } from './CreateGame.jsx';
import { timeAgo } from '../components/timeAgo.js';
import { EXAMPLE_IDEAS } from '../components/exampleIdeas.js';
import UploadForm from '../components/generation/UploadForm.jsx';

// Make your own games with AI (plan §15, guided flow §19), for any account, with your own
// GenAI Studio key: describe a game here, then each game has its own page, /create/<id>,
// that walks you through Idea → Design → Build → Play. The server enforces all of it.
// Logged out: this page says what you need (an account, then a key) instead of redirecting.
// /create?idea=… (from the home page's idea box, plan §42) starts with that idea filled in, and
// keeps it through signing up or logging in.
// Or upload a game file you made yourself, or with an AI of your own (plan §57): no key needed.

/** The idea typed on the home page, if any. */
const ideaFromAddress = () => new URLSearchParams(window.location.search).get('idea')?.slice(0, 2000) ?? '';

/** Back to /create afterwards (as a ?next= value), with the idea still filled in. */
const createNext = () => {
  const idea = ideaFromAddress();
  return idea ? encodeURIComponent(`/create?idea=${encodeURIComponent(idea)}`) : '/create';
};

/** What a game is doing, in a few words, for the list. */
const STATUS_WORDS = {
  designing: 'The AI is writing the design',
  design: 'The design is ready to read',
  generating: 'The AI is building it',
  checking: 'Checking your file',
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
          own Purdue GenAI Studio API key (the account page shows how to get one). Made a game file yourself, or with
          another AI? With an account you can upload it too, no key needed.
        </p>
        <GenaiStatus />
        <p className="create-actions">
          <a className="primary-button" href={`/login?mode=signup&next=${createNext()}`}>
            Create an account
          </a>
          <a href={`/login?next=${createNext()}`}>I already have one: log in</a>
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
      <GenaiStatus />
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {info && <IdeaForm info={info} />}
      {info && <UploadSection info={info} />}
      {games && <YourGames games={games} />}
    </main>
  );
}

function IdeaForm({ info }) {
  const [idea, setIdea] = useState(ideaFromAddress);
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

/** Upload a game file of your own (plan §57). */
function UploadSection({ info }) {
  async function upload(source) {
    const res = await uploadGame(source);
    if (res.ok) window.location.assign(`/create/${encodeURIComponent(res.game.id)}`);
    return res;
  }
  return (
    <section className="create-upload page-section" aria-labelledby="upload-heading">
      <h2 id="upload-heading">Or upload a game file</h2>
      <p>
        Wrote a game yourself, or made one with ChatGPT, Claude or another AI (copy the prompt on{' '}
        <a href="/kit#prompt-kit-heading">the kit page</a>)? Upload the file. It's checked the same way as any game, in a
        hidden browser with pretend phones, before you play it. No AI and no API key are needed.
      </p>
      <UploadForm info={info} onUpload={upload} />
    </section>
  );
}

function YourGames({ games }) {
  return (
    <section className="create-games page-section" aria-labelledby="your-games-heading">
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
                    {game.progress?.queuePosition > 0
                      ? 'Waiting in line'
                      : (STATUS_WORDS[game.status === 'generating' && game.kind === 'upload' ? 'checking' : game.status] ?? game.status)}
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
