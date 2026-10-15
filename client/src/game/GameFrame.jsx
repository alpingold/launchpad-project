import { useEffect, useMemo, useRef, useState } from 'react';
import { buildFrameDocument } from './frame/frameDocument.js';
import { loadManifest } from './assets.js';

// Mirrors the server's limits (config.js), so a game that sends too much hears about it
// here instead of getting the whole connection closed.
const PHONE_EVENT_MAX_BYTES = 24 * 1024; // GAME_EVENT_MAX_BYTES
const HOST_MESSAGE_MAX_BYTES = 30 * 1024; // under WS_MAX_PAYLOAD_BYTES (32 KB) with room for the envelope
const RATE_PER_SEC = 20; // RATE_LIMIT_PER_SEC
const RATE_BURST = 40; // RATE_LIMIT_BURST

/**
 * Shows a running frame game (plan §13) in a sandboxed iframe, and is the ONLY door between
 * the game and the rest of the site:
 *
 *   the game ──postMessage──▶ here: checked (right iframe? known kind of message? size?
 *                                   rate?) ──▶ the socket ──▶ the server (which checks again)
 *   the server ──▶ the socket ──▶ here (run.channel) ──postMessage──▶ the game
 *
 * sandbox="allow-scripts" WITHOUT allow-same-origin gives the game an anonymous origin: it
 * can run code and draw in its box, but can't read this page, the login cookie, or the room
 * tokens in sessionStorage, and can't redirect this page. frameDocument.js adds the
 * security policy that blocks the network.
 *
 * Render it with key={run.runId}, so every new game gets a fresh iframe.
 *
 * @param {Object} props
 * @param {import('./useGameMessages.js').GameRun} props.run
 * @param {'host' | 'player'} props.role
 * @param {string | null} [props.me]               this phone's player id
 * @param {{ id: string, connected: boolean }[]} props.roomPlayers  from room:state
 * @param {(msg: object) => void} props.send       sends a message to the server
 */
export default function GameFrame({ run, role, me = null, roomPlayers, send }) {
  const iframeRef = useRef(null);
  const theme = useResolvedTheme();
  const srcDoc = useMemo(() => buildFrameDocument(run.source, window.location.origin), [run.source]);

  // The game's players (fixed at the start), with who's connected right now.
  const players = useMemo(
    () =>
      run.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: roomPlayers.find((r) => r.id === p.id)?.connected ?? false,
      })),
    [run.players, roomPlayers],
  );

  // What the message handlers need, always current, without re-subscribing.
  const live = useRef(null);
  live.current ??= { ready: false, queue: [], tokens: RATE_BURST, refilledAt: Date.now() };
  Object.assign(live.current, { players, theme, send, role, me });

  useEffect(() => {
    const state = live.current;
    const frameWindow = () => iframeRef.current?.contentWindow;
    // '*': the sandboxed frame's origin is "null", so it can't be named. Safe, because the
    // message goes to this one window object and nowhere else.
    const post = (msg) => frameWindow()?.postMessage(msg, '*');
    const deliver = (msg) => (state.ready ? post(msg) : state.queue.push(msg));
    const refuse = (reason) => post({ type: 'refused', reason });

    function takeToken() {
      const now = Date.now();
      state.tokens = Math.min(RATE_BURST, state.tokens + ((now - state.refilledAt) / 1000) * RATE_PER_SEC);
      state.refilledAt = now;
      if (state.tokens < 1) return false;
      state.tokens -= 1;
      return true;
    }

    /** A message from the game → the server message it stands for, or a reason to refuse it. */
    function fromGame(msg) {
      const limit = state.role === 'host' ? HOST_MESSAGE_MAX_BYTES : PHONE_EVENT_MAX_BYTES;
      const payload = msg.type === 'setState' ? msg.state : msg.type === 'end' ? msg.results : msg.data;
      const json = JSON.stringify(payload);
      if (json === undefined) return { refused: `${msg.type}: needs a JSON value` };
      if (new Blob([json]).size > limit) return { refused: `${msg.type}: too big (the limit is ${limit} bytes)` };

      if (state.role === 'player') {
        if (msg.type === 'send') return { out: { type: 'game:event', data: msg.data } };
      } else if (msg.type === 'sendTo') {
        return { out: { type: 'game:send', to: msg.to, data: msg.data } };
      } else if (msg.type === 'setState') {
        return { out: { type: 'game:state', to: msg.to, state: msg.state } };
      } else if (msg.type === 'end') {
        const results = msg.results ?? {};
        return { out: { type: 'game:end', rankings: results.rankings, scores: results.scores } };
      }
      return { refused: `${msg.type}: not allowed on the ${state.role === 'host' ? 'big screen' : 'phone'}` };
    }

    function onMessage(event) {
      if (!frameWindow() || event.source !== frameWindow()) return; // only OUR game's iframe
      const msg = event.data;
      if (msg === null || typeof msg !== 'object' || typeof msg.type !== 'string') return;

      if (msg.type === 'loaded') {
        // The SDK is listening: tell the game who it is, then pass on what arrived meanwhile.
        loadManifest().then((manifest) => {
          const assets = {};
          for (const [id, asset] of manifest) assets[id] = `${window.location.origin}/game-assets/${asset.file}`;
          post({
            type: 'init',
            role: state.role,
            me: state.me,
            players: state.players,
            theme: state.theme,
            assets,
            clockOffset: run.clockOffset,
          });
          state.ready = true;
          for (const queued of state.queue.splice(0)) post(queued);
        });
        return;
      }

      const { out, refused } = fromGame(msg);
      if (refused) return refuse(refused);
      if (!takeToken()) return refuse(`${msg.type}: too many messages (at most ${RATE_PER_SEC} a second)`);
      state.send(out);
    }

    window.addEventListener('message', onMessage);
    // Messages from the server for the game: a phone's event (on the big screen), or the
    // big screen's messages and state (on a phone).
    const stopListening = run.channel.listen((msg) => {
      const clockOffset = msg.clockOffset;
      if (msg.type === 'game:event') deliver({ type: 'event', from: msg.from, data: msg.data, clockOffset });
      else if (msg.type === 'game:message') deliver({ type: 'message', data: msg.data, clockOffset });
      else if (msg.type === 'game:state') deliver({ type: 'state', state: msg.state, clockOffset });
    });
    return () => {
      window.removeEventListener('message', onMessage);
      stopListening();
    };
  }, [run]);

  // Who's connected, and the theme, can change during a game.
  useEffect(() => {
    if (live.current.ready) iframeRef.current?.contentWindow?.postMessage({ type: 'players', players }, '*');
  }, [players]);
  useEffect(() => {
    if (live.current.ready) iframeRef.current?.contentWindow?.postMessage({ type: 'theme', theme }, '*');
  }, [theme]);

  return (
    <iframe
      ref={iframeRef}
      className={`game-frame game-frame-${role}`}
      title="Game"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
    />
  );
}

/** 'light' or 'dark': what the site shows right now (settings/theme.js sets it on <html>). */
function useResolvedTheme() {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
