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
    // /screen?play=<Version id>: a Creator trying out one of their Versions (Play it).
    const created = new ScreenRoom(frames.current, { play: new URLSearchParams(location.search).get("play") });
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
          <RemoveDuringMatch room={state.room} screen={screen} />
          <button type="button" className="page-button page-button-small" onClick={() => screen.stopMatch()}>
            Stop
          </button>
        </div>
      </main>
    );
  }
  return <Lobby room={state.room} games={state.games} trying={state.trying} notice={state.notice} online={state.online} names={names} screen={screen} />;
}

function Lobby({
  room,
  games,
  trying,
  notice,
  online,
  names,
  screen,
}: {
  room: Room;
  games: readonly GameListing[];
  trying: GameListing | null;
  notice: string | null;
  online: boolean;
  names: ReadonlyMap<string, string>;
  screen: ScreenRoom;
}) {
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
      {trying === null ? null : (
        <section aria-label="Trying out">
          <h2>Trying out</h2>
          <p>Your Version, which only you can play until you publish it.</p>
          <ul className="screen-games">
            <GameChoice game={trying} count={count} screen={screen} />
          </ul>
        </section>
      )}
      <section>
        <h2>Games</h2>
        <ul className="screen-games">
          {games.map((game) => (
            <GameChoice key={game.id} game={game} count={count} screen={screen} />
          ))}
        </ul>
      </section>
    </main>
  );
}

/** One Game the Host can start. An uploaded one says so, and who made it: a stranger wrote its code. */
function GameChoice({ game, count, screen }: { game: GameListing; count: number; screen: ScreenRoom }) {
  const fits = count >= game.players.min && count <= game.players.max;
  return (
    <li>
      <button type="button" className="page-button" disabled={!fits} onClick={() => void screen.startMatch(game.id)}>
        Start {game.title}
      </button>
      <small>
        {game.players.min} to {game.players.max} players
      </small>
      {game.uploaded === true ? <small className="screen-uploaded">Uploaded, by {game.creator}</small> : null}
    </li>
  );
}

/**
 * The Host's way to remove a Player mid-Match: pick the Player, then confirm with their name on the
 * button. The Game hears it as that Player leaving, like any other leave.
 */
function RemoveDuringMatch({ room, screen }: { room: Room; screen: ScreenRoom }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const close = () => {
    setOpen(false);
    setChosen(null);
  };
  if (!open) {
    return (
      <button type="button" className="page-button page-button-small page-button-quiet" onClick={() => setOpen(true)} disabled={room.seats.length === 0}>
        Remove a Player…
      </button>
    );
  }
  return (
    <div className="screen-remove" role="dialog" aria-label="Remove a Player">
      {chosen === null ? (
        <>
          <span>Remove which Player?</span>
          {room.seats.map((seat) => (
            <button key={seat.id} type="button" className="page-button page-button-small page-button-quiet" onClick={() => setChosen({ id: seat.id, name: seat.name })}>
              {seat.name}
            </button>
          ))}
        </>
      ) : (
        <>
          <span>Remove {chosen.name} from the Room? Their phone is told, and the Game carries on without them.</span>
          <button
            type="button"
            className="page-button page-button-small"
            onClick={() => {
              screen.removeSeat(chosen.id);
              close();
            }}
          >
            Remove {chosen.name}
          </button>
        </>
      )}
      <button type="button" className="page-button page-button-small page-button-quiet" onClick={close}>
        Cancel
      </button>
    </div>
  );
}

const ENDED = { finished: "It finished.", stopped: "The Host stopped it.", broken: "The Game broke.", tooFewPlayers: "Too few Players were left." } as const;

function LastMatch({ result, names }: { result: MatchResult; names: ReadonlyMap<string, string> }) {
  const name = (id: string) => names.get(id) ?? "a Player who left";
  const scores = Object.entries(result.scores ?? {}).sort((a, b) => b[1] - a[1]);
  // The Game's own winners; left out, the top score wins (the SDK's MatchEnd promises this).
  const top = scores[0]?.[1];
  const winners = result.winners ?? scores.filter(([, score]) => score === top).map(([id]) => id);
  return (
    <section className="screen-result">
      <h2>
        {result.title}: {ENDED[result.reason]}
      </h2>
      {winners.length === 0 ? null : <p>Won by {winners.map(name).join(" and ")}</p>}
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
