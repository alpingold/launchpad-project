import { useEffect, useRef, useState } from 'react';
import { connectSocket } from '../net/socket.js';
import { loadSession, saveSession, clearSession } from '../net/storage.js';
import PlayerList from '../components/PlayerList.jsx';
import GameScreen from '../game/GameScreen.jsx';
import LastGameResults from '../game/LastGameResults.jsx';
import { useGameMessages } from '../game/useGameMessages.js';
import { usePageTitle } from '../usePageTitle.js';

const SESSION_KEY = 'player'; // sessionStorage: { code, token } of this tab's spot

const CLOSED_TEXT = {
  left: 'You left the room.',
  kicked: 'The host removed you from the room.',
  host_left: 'The host ended the room.',
  host_timeout: "The host didn't come back, so the room closed.",
  replaced: 'You opened this game in another tab or window.',
  idle: 'The room closed after a long time with no activity.',
};

// The phone page: enter the room code and a name, then wait in the lobby.
// After a refresh or a dropped connection, it reclaims the same spot with the saved
// player token (player:resume). The server makes every real decision; this page just
// collects input and shows the server's answers.
export default function Join() {
  // A link like /join?code=BCDF fills in the code.
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '');
  const [name, setName] = useState('');

  // 'connecting' → 'form' → 'joining' → 'joined'; 'resuming' after a reconnect; 'closed' at the end
  const [status, setStatus] = useState('connecting');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [me, setMe] = useState(null); // { playerId, name, code } from room:joined
  const [room, setRoom] = useState(null); // latest room:state
  const [closedReason, setClosedReason] = useState(null);
  const [game, handleGameMessage] = useGameMessages();
  usePageTitle('Join');
  const socketRef = useRef(null);
  const closedRef = useRef(false); // readable inside socket callbacks

  useEffect(() => {
    const socket = connectSocket({
      onOpen() {
        setConnected(true);
        if (closedRef.current) return;
        const saved = loadSession(SESSION_KEY);
        if (saved) {
          setStatus('resuming');
          socket.send({ type: 'player:resume', code: saved.code, token: saved.token });
        } else {
          setStatus('form');
        }
      },
      onMessage(msg) {
        if (handleGameMessage(msg)) return; // game:started / game:message / game:ended
        switch (msg.type) {
          case 'room:joined':
            saveSession(SESSION_KEY, { code: msg.code, token: msg.token });
            setMe({ playerId: msg.playerId, name: msg.name, code: msg.code });
            setStatus('joined');
            break;
          case 'room:state':
            setRoom(msg);
            break;
          case 'room:closed':
            closedRef.current = true;
            clearSession(SESSION_KEY);
            setClosedReason(msg.reason);
            setStatus('closed');
            break;
          case 'error':
            if (msg.requestType === 'player:join') {
              // A refused join: show why and let them fix the form.
              setError(msg.message);
              setStatus('form');
            } else if (msg.requestType === 'player:resume') {
              // Spot expired or room gone: back to the form, code filled in.
              const saved = loadSession(SESSION_KEY);
              clearSession(SESSION_KEY);
              if (saved) setCode(saved.code);
              setError(msg.code === 'ROOM_NOT_FOUND' ? 'That room has closed.' : msg.message);
              setStatus('form');
            } else {
              console.warn('[join] server error:', msg.code);
            }
            break;
        }
      },
      onDisconnect: () => setConnected(false),
    });
    socketRef.current = socket;
    return () => socket.close();
  }, [handleGameMessage]);

  function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setStatus('joining');
    socketRef.current.send({ type: 'player:join', code, name });
  }

  function leave() {
    if (window.confirm('Leave the room?')) socketRef.current.send({ type: 'room:leave' });
  }

  if (status === 'closed') {
    return (
      <main className="page join">
        <h1>Room closed</h1>
        <p>{CLOSED_TEXT[closedReason] ?? 'This room has closed.'}</p>
        <p>
          <a href="/join">Join a room</a>
        </p>
      </main>
    );
  }

  if (status === 'joined' && me) {
    const banner = !connected && (
      <p className="banner" role="status">
        Connection lost. Reconnecting…
      </p>
    );
    const hostAway = room && !room.hostConnected && (
      <p className="muted">The host disconnected. Waiting for them to come back…</p>
    );
    const leaveButton = (
      <p>
        <button type="button" className="secondary-button" onClick={leave} disabled={!connected}>
          Leave room
        </button>
      </p>
    );

    // During a game the phone screen is the game's latest screen; taps go back as game:action.
    if (room?.phase === 'in_game') {
      return (
        <main className="page join join-game">
          {banner}
          {hostAway}
          <GameScreen
            screen={game.screen}
            screenKey={game.screenKey}
            players={room.players}
            youId={me.playerId}
            clockOffset={game.clockOffset}
            onAction={(action) => socketRef.current.send({ type: 'game:action', action })}
          />
          <p className="muted small">
            {me.name} · room <span className="mono">{me.code}</span>
          </p>
          {leaveButton}
        </main>
      );
    }

    return (
      <main className="page join">
        {banner}
        <h1>You're in!</h1>
        <p>
          Room <strong className="mono">{me.code}</strong> as <strong>{me.name}</strong>
        </p>
        {hostAway || <p className="muted">Waiting for the host to start a game…</p>}
        {room && <LastGameResults results={game.lastResults} players={room.players} youId={me.playerId} />}
        {room && <PlayerList players={room.players} youId={me.playerId} />}
        {leaveButton}
      </main>
    );
  }

  if (status === 'connecting' || status === 'resuming') {
    return (
      <main className="page join">
        <h1>{status === 'resuming' ? 'Rejoining…' : 'Connecting…'}</h1>
      </main>
    );
  }

  return (
    <main className="page join">
      <h1>Join a game</h1>
      <form onSubmit={handleSubmit} className="join-form">
        <label>
          Room code
          <input
            className="mono code-input"
            value={code}
            // Letters only, then at most 4 (same as the home page's code box).
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
        </label>
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            autoComplete="nickname"
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={status !== 'form' || !connected}>
          {status === 'joining' ? 'Joining…' : 'Join'}
        </button>
      </form>
    </main>
  );
}
