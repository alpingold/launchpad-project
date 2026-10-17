import { useEffect, useRef, useState } from 'react';
import { connectSocket } from '../net/socket.js';
import { loadSession, saveSession, clearSession } from '../net/storage.js';
import PlayerList from '../components/PlayerList.jsx';
import ChosenGame from '../components/ChosenGame.jsx';
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

// Back to this page after logging in, with ?game=… if the /games page sent us.
const LOGIN_URL = `/login?next=${encodeURIComponent(`/host${window.location.search}`)}`;

/** Where you pick a game (plan §17): a room is always opened for one game. */
const CATALOGUE_URL = '/games';

/**
 * The big-screen page, for the game in ?game= (chosen in the catalogue first: plan §17).
 * Hosting needs an account (M7): check the login first, then that the game exists, and only
 * then connect. Logged-out visitors are sent to the login page and come back here afterwards.
 */
export default function Host() {
  usePageTitle('Host');
  const gameId = new URLSearchParams(window.location.search).get('game');
  const user = useCurrentUser();
  const [game, setGame] = useState(undefined); // undefined: loading; null: no such game (for you)

  useEffect(() => {
    if (!gameId) window.location.replace(CATALOGUE_URL);
    else if (user === null) window.location.replace(LOGIN_URL);
  }, [gameId, user]);

  useEffect(() => {
    if (!gameId || !user) return;
    fetch(`/api/games/${encodeURIComponent(gameId)}`)
      .then((res) => (res.ok ? res.json() : { game: null }))
      .then((data) => setGame(data.game))
      .catch(() => setGame(null));
  }, [gameId, user]);

  if (!gameId) {
    return (
      <main className="page">
        <h1>Pick a game first…</h1>
      </main>
    );
  }
  if (!user || game === undefined) {
    return (
      <main className="page">
        <h1>{user ? 'Getting the game ready…' : 'Checking your login…'}</h1>
      </main>
    );
  }
  if (game === null) {
    return (
      <main className="page">
        <h1>That game isn't available</h1>
        <p>It may have been taken down, or it's someone else's game in testing.</p>
        <a className="primary-button" href={CATALOGUE_URL}>
          Pick a game
        </a>
      </main>
    );
  }
  return <HostRoom user={user} chosenGame={game} />;
}

// Creates a room on first load; after a refresh or a dropped connection it reclaims the
// same room with the saved host token (host:resume). The server also gives a logged-in
// host their existing room back if they open /host again in another tab.
function HostRoom({ user, chosenGame }) {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null); // latest room:state
  const [ended, setEnded] = useState(null); // why the room ended, or null while it's alive
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // short message, e.g. why a game couldn't start
  const [game, handleGameMessage, runRef] = useGameMessages();
  const socketRef = useRef(null);
  const endedRef = useRef(false); // readable inside socket callbacks without re-subscribing
  const changingGameRef = useRef(false); // "Change game": once the room has closed, go to the catalogue

  useEffect(() => {
    function end(reason) {
      if (changingGameRef.current) {
        clearSession(SESSION_KEY);
        window.location.assign(CATALOGUE_URL);
        return;
      }
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
        // ran in the old page. If it saved (party.save), the game starts again from that save;
        // if not, its state is gone, so stop it. If only the connection blipped, this page
        // still runs the game (same runId) and simply carries on.
        if (msg.type === 'game:started' && msg.resumed && runRef.current?.runId !== msg.runId && !('snapshot' in msg)) {
          socket.send({ type: 'host:stop_game', reason: 'reload' });
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

  function startGame() {
    socketRef.current.send({ type: 'host:start_game', gameId: chosenGame.id });
  }

  /** Another game means another room (plan §17): this one ends, for everyone. */
  function changeGame() {
    const who = room.players.length > 0 ? ' Everyone will have to join the new room with its new code.' : '';
    if (!window.confirm(`Change the game? This ends this room.${who}`)) return;
    changingGameRef.current = true;
    socketRef.current.send({ type: 'room:leave' });
    // The server answers with room:closed (see end()); if that never comes, go anyway.
    setTimeout(() => {
      clearSession(SESSION_KEY);
      window.location.assign(CATALOGUE_URL);
    }, 2000);
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
            onBroken={() => socketRef.current.send({ type: 'host:stop_game', reason: 'broken' })}
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
      <p className="room-code">
        {[...room.code].map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
      </p>
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
      <ChosenGame game={chosenGame} playerCount={room.players.length} onStart={startGame} onChange={changeGame} disabled={!connected} />
      {endRoomButton}
      <p className="muted small">Hosting as {user.username}</p>
    </main>
  );
}
