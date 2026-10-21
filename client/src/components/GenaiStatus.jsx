import { useEffect, useState } from 'react';

/** How often the page asks the server again (the server itself asks Purdue once a minute). */
const EVERY_MS = 60_000;

/**
 * Is Purdue GenAI Studio up (plan §53)? Every game is made there, so when it's down, making or
 * changing a game can't work: say so before anyone tries. Up: one quiet line. Down: a notice.
 * Nothing while it's not known yet, or on a server that doesn't make games.
 */
export default function GenaiStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let stopped = false;
    const ask = () =>
      fetch('/api/genai-status')
        .then((res) => (res.ok ? res.json() : null))
        .then((s) => !stopped && setStatus(s))
        .catch(() => {});
    ask();
    const timer = setInterval(ask, EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (!status?.enabled || status.up === null) return null;
  if (status.up) {
    return (
      <p className="genai-status genai-up small" role="status">
        <span className="genai-dot" aria-hidden="true" /> The AI game maker is online.
      </p>
    );
  }
  return (
    <p className="genai-status genai-down banner" role="status">
      <span className="genai-dot" aria-hidden="true" /> <strong>The AI game maker is down right now:</strong> Purdue GenAI
      Studio, which makes the games, isn't answering. Making and changing games won't work until it's back; playing games
      works as usual.
    </p>
  );
}
