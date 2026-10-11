import { useEffect, useState } from 'react';
import { connectSocket } from '../net/socket.js';

// The big-screen page: creates a room as soon as it loads and shows the code.
// M3 adds the live player list; M4 adds surviving a refresh.
export default function Host() {
  // 'connecting' → 'creating' → 'ready', or 'closed' / 'disconnected' / 'error'
  const [status, setStatus] = useState('connecting');
  const [room, setRoom] = useState(null); // latest room:state from the server
  const [error, setError] = useState(null);

  useEffect(() => {
    const socket = connectSocket({
      onOpen() {
        setStatus('creating');
        socket.send({ type: 'host:create_room' });
      },
      onMessage(msg) {
        switch (msg.type) {
          case 'room:created':
            setStatus('ready');
            break;
          case 'room:state':
            setRoom(msg);
            break;
          case 'room:closed':
            setStatus('closed');
            break;
          case 'error':
            setStatus('error');
            setError(msg.message);
            break;
        }
      },
      onClose() {
        setStatus((s) => (s === 'closed' ? s : 'disconnected'));
      },
    });
    // Leaving the page (or React re-running this effect in dev) closes the socket,
    // which makes the server close the room.
    return () => socket.close();
  }, []);

  if (status === 'error') return <Message title="Couldn't create a room" text={error} />;
  if (status === 'disconnected') {
    return <Message title="Lost connection to the server" text="Refresh the page to start a new room." />;
  }
  if (status === 'closed') return <Message title="Room closed" text="Refresh the page to start a new room." />;
  if (!room) return <Message title="Creating a room…" />;

  return (
    <main className="page host">
      <p className="host-label">Join at</p>
      <p className="host-url">{window.location.host}/join</p>
      <p className="host-label">Room code</p>
      <p className="room-code">{room.code}</p>
      <p>
        Players ({room.players.length}/{room.maxPlayers})
      </p>
      {room.players.length === 0 && <p className="muted">Waiting for players to join…</p>}
    </main>
  );
}

function Message({ title, text }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      {text && <p>{text}</p>}
    </main>
  );
}
