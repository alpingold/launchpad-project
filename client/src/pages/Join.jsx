import { useEffect, useRef, useState } from 'react';
import { connectSocket } from '../net/socket.js';
import PlayerList from '../components/PlayerList.jsx';

// The phone page: enter the room code and a name, then wait in the lobby.
// The server makes every real decision (code exists, name allowed and free, room not full);
// the form just collects input and shows the server's answer.
export default function Join() {
  // A link like /join?code=BCDF fills in the code.
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '');
  const [name, setName] = useState('');

  // 'connecting' → 'form' → 'joining' → 'joined', or 'closed' / 'disconnected'
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const [me, setMe] = useState(null); // { playerId, name, code } from room:joined
  const [room, setRoom] = useState(null); // latest room:state
  const [closedReason, setClosedReason] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = connectSocket({
      onOpen: () => setStatus('form'),
      onMessage(msg) {
        switch (msg.type) {
          case 'room:joined':
            setMe({ playerId: msg.playerId, name: msg.name, code: msg.code });
            setStatus('joined');
            break;
          case 'room:state':
            setRoom(msg);
            break;
          case 'room:closed':
            setClosedReason(msg.reason);
            setStatus('closed');
            break;
          case 'error':
            // A refused join: show why and let them fix the form. Errors about other
            // requests must not throw an already-joined player back to the form.
            if (msg.requestType === 'player:join') {
              setError(msg.message);
              setStatus('form');
            } else {
              console.warn('[join] server error:', msg.code);
            }
            break;
        }
      },
      onClose: () => setStatus((s) => (s === 'closed' ? s : 'disconnected')),
    });
    socketRef.current = socket;
    return () => socket.close();
  }, []);

  function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setStatus('joining');
    socketRef.current.send({ type: 'player:join', code, name });
  }

  if (status === 'disconnected') {
    return <Message title="Lost connection" text="Refresh the page to try again." />;
  }
  if (status === 'closed') {
    const text = closedReason === 'host_left' ? 'The host ended the room.' : 'This room has closed.';
    return <Message title="Room closed" text={text} />;
  }

  if (status === 'joined' && me) {
    return (
      <main className="page join">
        <h1>You're in!</h1>
        <p>
          Room <strong className="mono">{me.code}</strong> as <strong>{me.name}</strong>
        </p>
        <p className="muted">Waiting for the host to start a game…</p>
        {room && <PlayerList players={room.players} youId={me.playerId} />}
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
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
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
        <button type="submit" disabled={status !== 'form'}>
          {status === 'connecting' ? 'Connecting…' : status === 'joining' ? 'Joining…' : 'Join'}
        </button>
      </form>
    </main>
  );
}

function Message({ title, text }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      <p>{text}</p>
      <p>
        <a href="/join">Join another room</a>
      </p>
    </main>
  );
}
