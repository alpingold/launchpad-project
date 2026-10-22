import { useEffect, useState } from 'react';
import Markdown from '../components/Markdown.jsx';
import { usePageTitle } from '../usePageTitle.js';

// THE GAME KIT PAGE (plan §13l, F5): a short overview of how BoilerGames games are made. The
// full guides the AI reads (generator/spec/, sent by GET /api/kit) sit folded at the bottom,
// so the details can't fall out of date.

const SKELETON = `<script type="application/json" id="game-info">
  { "name": "Star Catch", "description": "Catch the stars.",
    "minPlayers": 1, "maxPlayers": 12,
    "tags": ["action"], "minutes": [1, 3] }
</script>
<style> /* the game's own look */ </style>
<div id="app"></div>
<script>
  party.ready(({ role, me, restored }) =>
    role === 'host' ? bigScreen(restored) : phone(me));
</script>`;

const SDK = [
  [
    'Both',
    [
      ['party.ready(fn)', 'start here: role, me, players, and the last save after a reload'],
      ['party.now()', 'server time, for every timer and deadline'],
      ['party.sound(name)', 'a short sound: a tap, a coin, a win'],
    ],
  ],
  [
    'Phone',
    [
      ['party.send(data)', 'to the big screen'],
      ["party.on('state', fn)", 'what to show now (comes back after a reload)'],
    ],
  ],
  [
    'Big screen',
    [
      ["party.on('event', fn)", "a phone's party.send"],
      ['party.setState(id | all, state)', 'what a phone shows now'],
      ['party.save(g)', 'keep the game, to pick up after a reload'],
      ['party.end({ rankings })', 'the game is over'],
    ],
  ],
];

/**
 * The prompt kit (plan §57): one prompt for any AI chat (ChatGPT, Claude, Gemini…) that makes a
 * game this site accepts. The prompt itself comes from the server (/api/kit/prompt), made from the
 * same rulebook the site's own AI reads.
 */
function PromptKit() {
  const [copied, setCopied] = useState(null); // null, 'yes' or 'no'

  async function copy() {
    try {
      const res = await fetch('/api/kit/prompt');
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  }

  return (
    <section className="card kit-section" aria-labelledby="prompt-kit-heading">
      <h2 id="prompt-kit-heading">Making one with any AI</h2>
      <p>
        Use ChatGPT, Claude, Gemini or another AI you like: copy this prompt into a new chat, write your idea where it
        says so at the end, and send it. The AI writes a short design for you to check, then the game file. Then upload
        that file on <a href="/create">Make a game</a>: it's checked the same way as any game before you play it.
      </p>
      <p className="gen-actions">
        <button type="button" className="primary-button" onClick={copy}>
          Copy the prompt
        </button>
        <a className="secondary-button" href="/api/kit/prompt?download=1" download>
          Download it
        </a>
      </p>
      {copied === 'yes' && <p role="status">Copied. Paste it into a new chat, and add your idea at the end.</p>}
      {copied === 'no' && (
        <p className="error" role="alert">
          Couldn't copy it here: use Download instead.
        </p>
      )}
      <p className="muted small">
        It's the same rulebook the site's own AI follows (the full guides below), plus how to write a design and the
        pictures a game may use. Games you write by hand work too.
      </p>
    </section>
  );
}

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
      <p className="muted">How a BoilerGames game works, in short.</p>

      <section className="card kit-section" aria-label="One file, two roles">
        <h2>One file, two roles</h2>
        <p>
          A game is one HTML file. The same file runs on the big screen and on every phone, each in a locked-down frame
          with no network.
        </p>
        <ul>
          <li>
            <strong>The big screen is the referee:</strong> rules, timers, scores and secrets live there, and it tells
            each phone what to show.
          </li>
          <li>
            <strong>Phones are controllers:</strong> they show what they're told and send taps, choices and drawings.
          </li>
          <li>
            <strong>The server only passes messages along</strong>, checking each one. It never runs the game.
          </li>
        </ul>
        <pre>
          <code>{SKELETON}</code>
        </pre>
      </section>

      <section className="card kit-section" aria-label="The party SDK">
        <h2>The party SDK</h2>
        <table className="kit-sdk">
          {SDK.map(([where, calls]) => (
            <tbody key={where}>
              <tr>
                <th colSpan={2} scope="colgroup">
                  {where}
                </th>
              </tr>
              {calls.map(([call, what]) => (
                <tr key={call}>
                  <td>
                    <code>{call}</code>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        <p>
          <code>party.ui</code> has the pieces that are hard to build for a touch screen: a joystick, a gamepad, text
          input, a timer bar, a 3-2-1 countdown and a drawing pad.
        </p>
      </section>

      <section className="card kit-section" aria-label="The rules">
        <h2>The rules</h2>
        <ul>
          <li>No network, outside files, storage or pop-ups, and never leave the page.</li>
          <li>Secrets go only to their own phone. The big screen is a TV the whole room can see.</li>
          <li>Never trust what a phone sends: the big screen checks every event.</li>
          <li>Nothing waits forever: every wait has a timer, and a player who left is skipped.</li>
          <li>It works with 1 to 12 players, and survives a big screen or a phone reloading.</li>
        </ul>
      </section>

      <section className="card kit-section" aria-label="Making one with AI">
        <h2>Making one with the site's AI</h2>
        <p>
          <a href="/create">Start from an idea</a>: the AI writes a short design for you to read and change, then the
          code. Every game is checked (its code is read for anything not allowed, then it's played in a browser by
          bot phones) before you can playtest it, and you choose when to publish.
        </p>
      </section>

      <PromptKit />

      <section className="kit-section page-section" aria-label="The full guides">
        <h2>The full guides</h2>
        <p className="muted">The exact text the AI reads before it designs or writes a game.</p>
        {failed && (
          <p className="error" role="alert">
            Could not load the guides. Is the server running?
          </p>
        )}
        {!guide && !failed && <p className="muted">Loading…</p>}
        {guide?.sections.map((s) => (
          <details key={s.id} id={s.id} className="card kit-guide">
            <summary>{s.title}</summary>
            <Markdown text={s.markdown} headingOffset={2} />
          </details>
        ))}
      </section>
    </main>
  );
}
