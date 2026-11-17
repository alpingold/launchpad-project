// The Screen: the Lobby (the Room Code, the Seats, the Games), the Match (the Game's Screen View,
// filling the page), and the last Match's result. ScreenRoom does the work; this draws its state.
import type { MatchResult, Room } from "@boilergames/protocol";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { withDefaults } from "@boilergames/sdk/v1/check";
import { View } from "../kit/View.js";
import { ScreenStage } from "../screen/ScreenStage.js";
import { ScreenRoom, type GameListing } from "../screen/screen-room.js";

export function ScreenPage() {
  const frames = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<ScreenRoom | null>(null);
  useEffect(() => {
    if (frames.current === null) return;
    const created = new ScreenRoom(frames.current);
    setScreen(created);
    void created.begin();
  }, []);
  return (
    <>
      {/* The Game frame's hidden iframe goes here. */}
      <div ref={frames} hidden />
      {screen === null ? null : <ScreenContent screen={screen} />}
    </>
  );
}

function ScreenContent({ screen }: { screen: ScreenRoom }) {
  const state = useSyncExternalStore(
    (listener) => screen.subscribe(listener),
    () => screen.state,
  );
  const names = useMemo(() => new Map((state.room?.seats ?? []).map((s) => [s.id, s.name])), [state.room]);

  if (state.phase === "gone") {
    return (
      <main className="page">
        <p className="page-notice">{state.gone}</p>
        <button className="page-button" type="button" onClick={() => screen.openNewRoom()}>
          Open a new Room
        </button>
      </main>
    );
  }
  if (state.room === null) {
    return (
      <main className="page">
        <p>Opening a Room…</p>
        {state.notice === null ? null : <p className="page-notice">{state.notice}</p>}
      </main>
    );
  }

  if (state.phase === "match" && state.match !== null) {
    return (
      <main className="screen-match">
        {state.match.view === null ? (
          <p className="page">Starting {state.match.title}…</p>
        ) : (
          <ScreenStage background={withDefaults(state.match.look).colors.background}>
            <View kind="screen" view={state.match.view} look={state.match.look} names={names} timerEndsAt={state.match.timerEndsAt} />
          </ScreenStage>
        )}
        <div className="screen-match-bar">
          <span>
            Room <strong>{state.room.code}</strong>
          </span>
          {state.online ? null : <span>Reconnecting…</span>}
          <button type="button" className="page-button page-button-small" onClick={() => screen.stopMatch()}>
            Stop
          </button>
        </div>
      </main>
    );
  }
  return <Lobby room={state.room} games={state.games} notice={state.notice} online={state.online} names={names} screen={screen} />;
}

function Lobby({ room, games, notice, online, names, screen }: { room: Room; games: readonly GameListing[]; notice: string | null; online: boolean; names: ReadonlyMap<string, string>; screen: ScreenRoom }) {
  const count = room.seats.length;
  return (
    <main className="page screen-lobby">
      <header className="screen-code">
        <p>Join on your phone at {location.host}/play with the code</p>
        <p className="screen-code-letters" aria-label="Room Code">
          {room.code}
        </p>
        {online ? null : <p className="page-notice">Reconnecting…</p>}
      </header>
      {notice === null ? null : <p className="page-notice">{notice}</p>}
      {room.lastMatch === null ? null : <LastMatch result={room.lastMatch} names={names} />}
      <section>
        <h2>Players ({count})</h2>
        {count === 0 ? <p>Nobody yet.</p> : null}
        <ul className="screen-seats">
          {room.seats.map((seat) => (
            <li key={seat.id} data-connected={seat.connected}>
              <span>{seat.name}</span>
              {seat.connected ? null : <small>away</small>}
              <button type="button" className="page-link" onClick={() => screen.removeSeat(seat.id)} aria-label={`Remove ${seat.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Games</h2>
        <ul className="screen-games">
          {games.map((game) => {
            const fits = count >= game.players.min && count <= game.players.max;
            return (
              <li key={game.id}>
                <button type="button" className="page-button" disabled={!fits} onClick={() => void screen.startMatch(game.id)}>
                  Start {game.title}
                </button>
                <small>
                  {game.players.min} to {game.players.max} players
                </small>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

const ENDED = { finished: "It finished.", stopped: "The Host stopped it.", broken: "The Game broke.", tooFewPlayers: "Too few Players were left." } as const;

function LastMatch({ result, names }: { result: MatchResult; names: ReadonlyMap<string, string> }) {
  const name = (id: string) => names.get(id) ?? "a Player who left";
  const scores = Object.entries(result.scores ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <section className="screen-result">
      <h2>
        {result.title}: {ENDED[result.reason]}
      </h2>
      {result.winners === undefined || result.winners.length === 0 ? null : <p>Won by {result.winners.map(name).join(" and ")}</p>}
      {scores.length === 0 ? null : (
        <ol>
          {scores.map(([id, score]) => (
            <li key={id}>
              {name(id)}: {score}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
