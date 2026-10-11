import { useEffect, useRef, useState } from 'react';
import { connectSocket } from '../net/socket.js';
import { loadSession, saveSession, clearSession } from '../net/storage.js';
import PlayerList from '../components/PlayerList.jsx';
import GamePicker from '../components/GamePicker.jsx';

const SESSION_KEY = 'host'; // sessionStorage: { code, hostToken } of the room this tab hosts

const ENDED_TEXT = {
  host_left: 'You ended the room.',
  host_timeout: 'The room closed while this page was disconnected.',
  expired: 'The room closed while this page was disconnected.',
  replaced: 'This room is now open in another tab or window.',
  idle: 'The room closed after a long time with no activity.',
};

// The big-screen page. Creates a room on first load; after a refresh or a dropped
// connection it reclaims the same room with the saved host token (host:resume).
export default function Host() {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null); // latest room:state
  const [ended, setEnded] = useState(null); // why the room ended, or null while it's alive
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // short message, e.g. why a game couldn't start
  const socketRef = useRef(null);
  const endedRef = useRef(false); // readable inside socket callbacks without re-subscribing

  useEffect(() => {
    function end(reason) {
      endedRef.current = true;
      clearSession(SESSION_KEY);
      setEnded(reason);
    }

    const socket = connectSocket({
      onOpen() {
        setConnected(true);
        if (endedRef.current) return; // room is over; don't silently start a new one
        const saved = loadSession(SESSION_KEY);
        if (saved) socket.send({ type: 'host:resume', code: saved.code, hostToken: saved.hostToken });
        else socket.send({ type: 'host:create_room' });
      },
      onMessage(msg) {
        switch (msg.type) {
          case 'room:created':
            saveSession(SESSION_KEY, { code: msg.code, hostToken: msg.hostToken });
            break;
          case 'room:state':
            setRoom(msg);
            break;
          case 'room:closed':
            end(msg.reason);
            break;
          case 'game:started':
            setNotice(null);
            break;
          case 'game:ended':
            if (msg.results.error) setNotice('The game hit a problem and was stopped.');
            break;
          case 'error':
            if (msg.requestType === 'host:resume') end('expired');
            else if (msg.requestType === 'host:create_room') setError(msg.message);
            else if (msg.requestType === 'host:start_game') setNotice(msg.message);
            else console.warn('[host] server error:', msg.code);
            break;
        }
      },
      onDisconnect: () => setConnected(false),
    });
    socketRef.current = socket;
    return () => socket.close();
  }, []);

  function startNewRoom() {
    clearSession(SESSION_KEY);
    window.location.reload();
  }

  function endRoom() {
    if (window.confirm('End the room for everyone?')) socketRef.current.send({ type: 'room:leave' });
  }

  function startGame(gameId) {
    socketRef.current.send({ type: 'host:start_game', gameId });
  }

  function kick(player) {
    if (window.confirm(`Remove ${player.name} from the room?`)) {
      socketRef.current.send({ type: 'host:kick', playerId: player.id });
    }
  }

  if (ended) {
    return (
      <main className="page">
        <h1>Room closed</h1>
        <p>{ENDED_TEXT[ended] ?? 'The room has closed.'}</p>
        <button type="button" className="primary-button" onClick={startNewRoom}>
          Start a new room
        </button>
      </main>
    );
  }
  if (error) {
    return (
      <main className="page">
        <h1>Couldn't create a room</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (!room) {
    return (
      <main className="page">
        <h1>{connected ? 'Creating a room…' : 'Connecting…'}</h1>
      </main>
    );
  }

  return (
    <main className="page host">
      {!connected && (
        <p className="banner" role="status">
          Connection lost. Reconnecting… (players keep their spots)
        </p>
      )}
      <p className="host-label">Join at</p>
      <p className="host-url">{window.location.host}/join</p>
      <p className="host-label">Room code</p>
      <p className="room-code">{room.code}</p>
      <p>
        Players ({room.players.length}/{room.maxPlayers})
      </p>
      {room.players.length === 0 && <p className="muted">Waiting for players to join…</p>}
      <PlayerList players={room.players} large onKick={kick} />
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
      {room.phase === 'in_game' ? (
        // M5b replaces this with the game's big-screen views.
        <p className="game-status">Game in progress…</p>
      ) : (
        <GamePicker playerCount={room.players.length} onStart={startGame} disabled={!connected} />
      )}
      <p>
        <button type="button" className="secondary-button" onClick={endRoom} disabled={!connected}>
          End room
        </button>
      </p>
    </main>
  );
}
