import { useEffect, useMemo, useRef, useState } from 'react';
import { buildFrameDocument } from './frame/frameDocument.js';
import { loadManifest } from './assets.js';

// Mirrors the server's limits (config.js), so a game that sends too much hears about it
// here instead of getting the whole connection closed.
const PHONE_EVENT_MAX_BYTES = 48 * 1024; // GAME_EVENT_MAX_BYTES
const HOST_MESSAGE_MAX_BYTES = 120 * 1024; // under WS_MAX_PAYLOAD_BYTES (128 KB) with room for the envelope
const RATE_PER_SEC = 20; // RATE_LIMIT_PER_SEC
const RATE_BURST = 40; // RATE_LIMIT_BURST
const ALIVE_EVERY_MS = 2000; // how often the big screen tells the server its game still answers

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
 * It also watches for two ways a game can break out of its normal life (plan §13e):
 *  - it loads another page into its frame (a second `load` event): the frame is removed and
 *    onBroken('navigated') is called. That can't stop the first request, only what follows.
 *  - on the big screen, it hangs: then this whole page hangs too (the frame shares its
 *    thread), so the server's watchdog notices instead. This passes the SDK's heartbeat on
 *    as game:alive, and pauses the watch while the tab is in the background.
 *
 * Render it with key={run.runId}, so every new game gets a fresh iframe.
 *
 * @param {Object} props
 * @param {import('./useGameMessages.js').GameRun} props.run
 * @param {'host' | 'player'} props.role
 * @param {string | null} [props.me]               this phone's player id
 * @param {{ id: string, connected: boolean }[]} props.roomPlayers  from room:state
 * @param {(msg: object) => void} props.send       sends a message to the server
 * @param {(reason: 'navigated') => void} props.onBroken  the game left its frame; it's been removed
 */
export default function GameFrame({ run, role, me = null, roomPlayers, send, onBroken }) {
  const iframeRef = useRef(null);
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
  live.current ??= { ready: false, queue: [], tokens: RATE_BURST, refilledAt: Date.now(), aliveSentAt: 0, loads: 0 };
  Object.assign(live.current, { players, send, role, me, onBroken });
  const [broken, setBroken] = useState(false);

  // While a game is on screen, the site's links at the top stay out of the way (plan §16);
  // a phone hides the whole header and uses a slim bar under the game instead (Join.jsx).
  useEffect(() => {
    document.body.classList.add('in-game', `in-game-${role}`);
    return () => document.body.classList.remove('in-game', `in-game-${role}`);
  }, [role]);

  // Keep the screen on while a game runs (plan §21): a phone waiting for its turn shouldn't
  // lock and drop out. The browser lets go of the lock when the page is hidden, so take it
  // again when it comes back. Needs HTTPS (or localhost); elsewhere it quietly does nothing.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return undefined;
    let lock = null;
    let gone = false;
    const take = () => {
      if (gone || document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (gone) l.release();
          else lock = l;
        })
        .catch(() => {}); // not allowed here (e.g. no HTTPS, battery saver): the screen may sleep
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', take);
      lock?.release().catch(() => {});
    };
  }, []);

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
      let out = null;
      if (state.role === 'player') {
        if (msg.type === 'send') out = { type: 'game:event', data: msg.data };
      } else if (msg.type === 'batch' && Array.isArray(msg.items)) {
        out = { type: 'game:batch', items: msg.items };
        if ('save' in msg) out.save = msg.save;
      } else if (msg.type === 'end') {
        const results = msg.results ?? {};
        out = { type: 'game:end', rankings: results.rankings, scores: results.scores };
      }
      if (!out) return { refused: `${msg.type}: not allowed on the ${state.role === 'host' ? 'big screen' : 'phone'}` };

      // The server checks the details (targets, results); here, just that it's JSON and small enough.
      const json = JSON.stringify(out);
      const limit = state.role === 'host' ? HOST_MESSAGE_MAX_BYTES : PHONE_EVENT_MAX_BYTES;
      if (msg.type === 'send' && msg.data === undefined) return { refused: 'send: needs a JSON value' };
      if (new Blob([json]).size > limit) return { refused: `${msg.type}: too big (the limit is ${limit} bytes)` };
      return { out };
    }

    /** The SDK's heartbeat (big screen only), passed on to the server's watchdog now and then. */
    function alive() {
      if (state.role !== 'host' || document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - state.aliveSentAt < ALIVE_EVERY_MS) return;
      state.aliveSentAt = now;
      state.send({ type: 'game:alive' });
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
            theme: 'dark', // always (plan §34); games written before that may still read it
            assets,
            restored: run.restored, // the big screen's save, if this page reloaded mid-game
            clockOffset: run.clockOffset,
          });
          state.ready = true;
          for (const queued of state.queue.splice(0)) post(queued);
        });
        return;
      }

      if (msg.type === 'alive') return alive();

      const { out, refused } = fromGame(msg);
      if (refused) return refuse(refused);
      if (!takeToken()) return refuse(`${msg.type}: too many messages (at most ${RATE_PER_SEC} a second)`);
      state.send(out);
    }

    window.addEventListener('message', onMessage);
    // A big screen in a background tab: its timers slow right down, so ask the server to
    // pause the watchdog until it's back in front.
    function onVisibility() {
      if (state.role !== 'host') return;
      if (document.visibilityState === 'hidden') state.send({ type: 'game:alive', paused: true });
      else {
        state.aliveSentAt = 0;
        alive();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
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
      document.removeEventListener('visibilitychange', onVisibility);
      stopListening();
    };
  }, [run]);

  // Who's connected can change during a game.
  useEffect(() => {
    if (live.current.ready) iframeRef.current?.contentWindow?.postMessage({ type: 'players', players }, '*');
  }, [players]);

  // The first load is our document. Any later one means the game loaded another page into
  // its frame (or reloaded itself): it's no longer the game that was reviewed. Remove it.
  function onLoad() {
    live.current.loads += 1;
    if (live.current.loads > 1 && !broken) {
      setBroken(true);
      live.current.onBroken?.('navigated');
    }
  }

  if (broken) return null;
  return (
    <iframe
      ref={iframeRef}
      className={`game-frame game-frame-${role}`}
      title="Game"
      sandbox="allow-scripts"
      // Sound (plan §21): pass this page's permission to play audio on to the game, so the big
      // screen (where nobody taps inside the frame) can play it.
      allow="autoplay"
      srcDoc={srcDoc}
      onLoad={onLoad}
    />
  );
}

