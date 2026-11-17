// A phone: join a Room, then the Lobby ("you're in"), then the Controller. PhoneSeat does the work.
import { MAX_NAME_LENGTH } from "@boilergames/protocol";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { View } from "../kit/View.js";
import { PhoneSeat } from "../play/phone-seat.js";

export function PlayPage() {
  const seat = useMemo(() => new PhoneSeat(), []);
  useEffect(() => seat.begin(), [seat]);
  const state = useSyncExternalStore(
    (listener) => seat.subscribe(listener),
    () => seat.state,
  );
  const names = useMemo(() => new Map((state.room?.seats ?? []).map((s) => [s.id, s.name])), [state.room]);

  if (state.phase === "form" || state.phase === "gone") {
    return (
      <main className="page">
        {state.notice === null ? null : <p className="page-notice">{state.notice}</p>}
        {state.phase === "gone" ? null : <JoinForm onJoin={(code, name) => seat.join(code, name)} />}
      </main>
    );
  }
  const room = state.room;
  if (state.phase === "joining" || room === null) return <main className="page">Joining…</main>;
  const me = room.seats.find((s) => s.id === state.seatId);
  const away = room.screenConnected ? null : <p className="page-notice">Waiting for the Screen…</p>;
  const offline = state.online ? null : <p className="page-notice">Reconnecting…</p>;
  const notice = state.notice === null ? null : <p className="page-notice">{state.notice}</p>;

  if (room.match !== null && state.view !== null) {
    return (
      <main className="play-match">
        {offline}
        {away}
        {notice}
        <View kind="controller" view={state.view} look={room.match.look} names={names} timerEndsAt={state.timerEndsAt} onAction={(action) => seat.act(action)} />
      </main>
    );
  }
  return (
    <main className="page">
      {offline}
      {away}
      {notice}
      <h1>You're in{me === undefined ? "" : `, ${me.name}`}</h1>
      <p>Room {room.code}</p>
      {room.match === null ? <p>Waiting for the Host to start a Game.</p> : <p>You're in from the next Match. {room.match.title} is on now.</p>}
      <button type="button" className="page-button page-button-quiet" onClick={() => seat.leave()}>
        Leave the Room
      </button>
    </main>
  );
}

function JoinForm({ onJoin }: { onJoin: (code: string, name: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim().length === 4 && name.trim() !== "") onJoin(code, name);
  };
  return (
    <form className="play-join" onSubmit={submit}>
      <h1>Join a Room</h1>
      <label>
        Room Code
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} autoCapitalize="characters" autoComplete="off" inputMode="text" />
      </label>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME_LENGTH} autoComplete="nickname" />
      </label>
      <button className="page-button" type="submit" disabled={code.trim().length !== 4 || name.trim() === ""}>
        Join
      </button>
    </form>
  );
}
