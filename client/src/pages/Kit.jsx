import { useEffect, useState } from 'react';
import Markdown from '../components/Markdown.jsx';
import { usePageTitle } from '../usePageTitle.js';

// THE GAME KIT PAGE (plan §13l, F5): how BoilerGames games are made. It shows the guide the
// server sends (GET /api/kit), which is the exact text the AI reads before it designs or
// writes a game (generator/spec/), so this page can't fall out of date.

export default function Kit() {
  usePageTitle('Game kit');
  const [guide, setGuide] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/kit')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setGuide)
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="page kit">
      <h1>Game kit</h1>
      <p className="muted">
        Every BoilerGames game is one web page that runs on the big screen and on every phone. This is the guide for
        writing one, by hand or with the AI: the AI reads exactly this text before it designs or writes a game.
      </p>
      {failed && (
        <p className="error" role="alert">
          Could not load the guide. Is the server running?
        </p>
      )}
      {!guide && !failed && <p className="muted">Loading…</p>}
      {guide && (
        <>
          <nav aria-label="Sections">
            <ul>
              {guide.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ul>
          </nav>
          {guide.sections.map((s) => (
            <section key={s.id} id={s.id} className="card kit-section" aria-label={s.title}>
              <Markdown text={s.markdown} headingOffset={1} />
            </section>
          ))}
        </>
      )}
    </main>
  );
}
