import { useEffect, useState } from 'react';
import GameScreen from '../game/GameScreen.jsx';
import { usePageTitle } from '../usePageTitle.js';

// THE GAME KIT PAGE (plan §12d): every block a game can put on a screen, live. It's the dev
// kit's documentation, for people and for checking what the AI can use. The definitions
// come from the server (GET /api/kit), the same ones the server checks screens against and
// the AI reads, so this page can't fall out of date.
//
// Each preview is drawn by the real game components. Using an input block or widget shows
// what the phone would send, instead of sending it anywhere.

/** Pretend players, so scoreboard and playerName examples have names. You are Alex. */
const DEMO_PLAYERS = [
  { id: 'p_alex', name: 'Alex' },
  { id: 'p_blake', name: 'Blake' },
];

/** Fields that hold server times. Examples are shifted so they start a moment from now. */
const TIME_FIELDS = ['startedAt', 'startsAt', 'goAt', 'endsAt'];
const START_DELAY_MS = 2000;

/** A copy of an example whose times start shortly after now (so timers and widgets run). */
function liveExample(example) {
  const times = TIME_FIELDS.filter((f) => typeof example[f] === 'number').map((f) => example[f]);
  if (times.length === 0) return example;
  const shift = Date.now() + START_DELAY_MS - Math.min(...times);
  const live = { ...example };
  for (const f of TIME_FIELDS) if (typeof live[f] === 'number') live[f] += shift;
  return live;
}

export default function Kit() {
  usePageTitle('Game kit');
  const [kit, setKit] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/kit')
      .then((res) => res.json())
      .then(setKit)
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="page kit">
      <h1>Game kit</h1>
      <p>
        Every BoilerGames game, hand-made or AI-made, shows things only with these blocks. A game sends each phone and
        the big screen a <strong>screen</strong>: a list of blocks, like{' '}
        <code>{"{ blocks: [{ type: 'text', text: 'Round 1' }, { type: 'button', … }] }"}</code>. Games never send their
        own code to a browser, so these blocks are everything a screen can be.
      </p>
      <p className="muted">
        The previews are live: try the buttons, inputs and widgets to see what a phone sends to the game.
      </p>
      {failed && (
        <p className="error" role="alert">
          Couldn't load the kit.
        </p>
      )}
      {!kit && !failed && <p className="muted">Loading…</p>}
      {kit && (
        <>
          <p className="muted small">
            Limits: at most {kit.limits.maxBlocks} blocks per screen, nested at most {kit.limits.maxDepth} deep, and{' '}
            {kit.limits.maxScreenBytes / 1024} KB as JSON. Drawing colors: {kit.palette.join(', ')}.
          </p>
          <nav aria-label="Block groups" className="kit-nav">
            {kit.groups.map((group) => (
              <a key={group.id} href={`#${group.id}`}>
                {group.title.split(':')[0]}
              </a>
            ))}
          </nav>
          {kit.groups.map((group) => (
            <section key={group.id} id={group.id} aria-labelledby={`${group.id}-heading`}>
              <h2 id={`${group.id}-heading`}>{group.title}</h2>
              {group.blocks.map((block) => (
                <BlockCard key={block.type} block={block} usable={group.id === 'input' || group.id === 'widget'} />
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}

/** One block: what it's for, a live preview, its fields, and an example to copy. */
function BlockCard({ block, usable }) {
  const [run, setRun] = useState(() => ({ key: 1, screen: { blocks: [liveExample(block.example)] } }));
  const [received, setReceived] = useState(null);
  const [copied, setCopied] = useState(false);

  function restart() {
    setReceived(null);
    setRun((r) => ({ key: r.key + 1, screen: { blocks: [liveExample(block.example)] } }));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(block.example, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked (e.g. plain http on another device); the text is right there to select.
    }
  }

  return (
    <article className="card kit-block" id={`block-${block.type}`} aria-labelledby={`block-${block.type}-name`}>
      <h3 id={`block-${block.type}-name`} className="mono">
        {block.type}
      </h3>
      <p>{block.purpose}</p>

      <div className="kit-preview" aria-label={`${block.type} preview`}>
        <GameScreen
          screen={run.screen}
          screenKey={run.key}
          players={DEMO_PLAYERS}
          youId="p_alex"
          onAction={(action, input) => setReceived({ action, input })}
        />
      </div>
      {usable && (
        <div className="kit-received" role="status">
          {received ? (
            <>
              The phone sends: <code>action {JSON.stringify(received.action)}</code>
              {received.input !== undefined && (
                <>
                  , <code>input {JSON.stringify(received.input)}</code>
                </>
              )}
              . The server checks it (and trims text) before the game's onAction gets it.
            </>
          ) : (
            <span className="muted">Use it to see what the phone sends.</span>
          )}{' '}
          <button type="button" className="link-button" onClick={restart}>
            Restart
          </button>
        </div>
      )}

      {block.fields.length > 0 && (
        <>
          <h4>Fields</h4>
          <ul className="kit-fields">
            {block.fields.map((field) => (
              <li key={field.name}>
                <code>{field.name}</code>
                {field.optional && <span className="muted"> (optional)</span>}: {field.type}
              </li>
            ))}
          </ul>
        </>
      )}
      {block.sends && (
        <p>
          <strong>Sends:</strong> <code>action</code>, plus <code>input</code> = {block.sends}.
        </p>
      )}
      <details>
        <summary>Example JSON</summary>
        <pre className="kit-json">
          <code>{JSON.stringify(block.example, null, 2)}</code>
        </pre>
        <button type="button" className="secondary-button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </details>
    </article>
  );
}
