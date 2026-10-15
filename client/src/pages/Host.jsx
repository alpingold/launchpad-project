import { useEffect, useRef, useState } from 'react';
import { connectSocket } from '../net/socket.js';
import { loadSession, saveSession, clearSession } from '../net/storage.js';
import PlayerList from '../components/PlayerList.jsx';
import GamePicker from '../components/GamePicker.jsx';
import GameFrame from '../game/GameFrame.jsx';
import LastGameResults from '../game/LastGameResults.jsx';
import { useGameMessages } from '../game/useGameMessages.js';
import { usePageTitle } from '../usePageTitle.js';
import { useCurrentUser } from '../net/auth.js';

const SESSION_KEY = 'host'; // sessionStorage: { code, hostToken } of the room this tab hosts

const ENDED_TEXT = {
  host_left: 'You ended the room.',
  host_timeout: 'The room closed while this page was disconnected.',
  expired: 'The room closed while this page was disconnected.',
  replaced: 'This room is now open in another tab or window.',
  idle: 'The room closed after a long time with no activity.',
};

const LOGIN_URL = '/login?next=/host';

/**
 * The big-screen page. Hosting needs an account (M7): check the login first, and only then
 * connect. Logged-out visitors are sent to the login page and come back here afterwards.
 */
export default function Host() {
  usePageTitle('Host');
  const user = useCurrentUser();

  useEffect(() => {
    if (user === null) window.location.replace(LOGIN_URL);
  }, [user]);

  if (!user) {
    return (
      <main className="page">
        <h1>Checking your login…</h1>
      </main>
    );
  }
  return <HostRoom user={user} />;
}

// Creates a room on first load; after a refresh or a dropped connection it reclaims the
// same room with the saved host token (host:resume). The server also gives a logged-in
// host their existing room back if they open /host again in another tab.
function HostRoom({ user }) {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null); // latest room:state
  const [ended, setEnded] = useState(null); // why the room ended, or null while it's alive
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // short message, e.g. why a game couldn't start
  const [game, handleGameMessage, runRef] = useGameMessages();
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
        // Back after a reload in the middle of a game: the big screen's game (the referee)
        // ran in the old page and its state is gone, so stop it. If only the connection
        // blipped, this page still runs the game (same runId) and simply carries on.
        // (Saving and restoring the big screen's game comes in F1, plan §13l.)
        if (msg.type === 'game:started' && msg.resumed && runRef.current?.runId !== msg.runId) {
          socket.send({ type: 'host:stop_game' });
          setNotice('This page reloaded during a game, so the game was stopped.');
          return;
        }
        handleGameMessage(msg); // game:started / game:event / game:ended
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
          case 'error':
            if (msg.requestType === 'host:resume') end('expired');
            else if (msg.code === 'NOT_AUTHENTICATED') window.location.replace(LOGIN_URL); // login expired
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
  }, [handleGameMessage]);

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

  function stopGame() {
    if (window.confirm('Stop the game? Nobody wins.')) socketRef.current.send({ type: 'host:stop_game' });
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

  const banner = !connected && (
    <p className="banner" role="status">
      Connection lost. Reconnecting… (players keep their spots)
    </p>
  );
  const endRoomButton = (
    <p>
      <button type="button" className="secondary-button" onClick={endRoom} disabled={!connected}>
        End room
      </button>
    </p>
  );

  // During a game the big screen is the game: its iframe, with a small room label above it.
  // The game's page is the referee: it runs the rules, and the server passes messages.
  if (room.phase === 'in_game') {
    return (
      <main className="page host host-game">
        {banner}
        <p className="host-label">Room {room.code}</p>
        {game.run ? (
          <GameFrame
            key={game.run.runId}
            run={game.run}
            role="host"
            roomPlayers={room.players}
            send={(msg) => socketRef.current.send(msg)}
          />
        ) : (
          <p className="muted">Stopping the game…</p>
        )}
        <p className="host-game-buttons">
          <button type="button" className="secondary-button" onClick={stopGame} disabled={!connected}>
            Stop game
          </button>
          <button type="button" className="secondary-button" onClick={endRoom} disabled={!connected}>
            End room
          </button>
        </p>
      </main>
    );
  }

  return (
    <main className="page host">
      {banner}
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
      <LastGameResults results={game.lastResults} players={room.players} />
      <GamePicker playerCount={room.players.length} onStart={startGame} disabled={!connected} />
      {endRoomButton}
      <p className="muted small">Hosting as {user.username}</p>
    </main>
  );
}
