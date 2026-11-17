// The rules of Rooms and Seats, with a fake clock and a fake `send`. Every message the layer sends is
// checked against the protocol's schema for whoever receives it, and no token may ever reach anyone
// but its owner.
import { MAX_SEATS, PHONE_MESSAGES_PER_SECOND, SCREEN_MESSAGES_PER_SECOND, serverToPhone, serverToScreen, type PhoneToServer, type Room, type ScreenToServer } from "@boilergames/protocol";
import { describe, expect, test } from "vitest";
import { MAX_VIEW_BYTES } from "@boilergames/sdk/v1/engine";
import {
  CLOSE_AT_TIMES_THE_LIMIT,
  DEFAULT_MAX_ROOMS,
  FAILED_TRIES_PER_MINUTE,
  FIRST_MESSAGE_MS,
  ROOMS_OPENED_PER_MINUTE,
  Rooms,
  SCREEN_GRACE_MS,
  SEAT_GRACE_MS,
  type Clock,
  type Incoming,
} from "./rooms.js";

class FakeClock implements Clock {
  time = 1_000_000;
  #timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  now = () => this.time;
  setTimeout = (run: () => void, ms: number) => {
    const timer = { at: this.time + ms, run, cancelled: false };
    this.#timers.push(timer);
    return () => void (timer.cancelled = true);
  };
  /** Moves time on, running every timer that comes due, in order. */
  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = this.#timers.filter((t) => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.time = due.at;
      due.cancelled = true;
      due.run();
    }
    this.time = until;
  }
  pending(): number {
    return this.#timers.filter((t) => !t.cancelled).length;
  }
}

type Sent = { type: string; [key: string]: unknown };

/** A Rooms layer with a fake clock, recording what it sends to and closes on each connection. */
function harness(randomBytes?: (size: number) => Buffer, maxRooms?: number) {
  const clock = new FakeClock();
  const inbox = new Map<string, Sent[]>();
  const closed = new Set<string>();
  const side = new Map<string, "screen" | "phone">();
  /** Every token handed out, and the one connection allowed to see it. */
  const owners = new Map<string, Set<string>>();
  let next = 0;

  const rooms = new Rooms({
    clock,
    ...(randomBytes === undefined ? {} : { randomBytes }),
    ...(maxRooms === undefined ? {} : { maxRooms }),
    send(connection, message) {
      expect(closed.has(connection), `sent ${message.type} to a closed connection`).toBe(false);
      const schema = side.get(connection) === "screen" ? serverToScreen : serverToPhone;
      const checked = schema.safeParse(message);
      expect(checked.success, `${message.type} to ${connection}: ${JSON.stringify(checked.error?.issues)}`).toBe(true);
      const text = JSON.stringify(message);
      for (const [token, allowed] of owners) expect(!text.includes(token) || allowed.has(connection), `a token reached ${connection}`).toBe(true);
      if (message.type === "roomOpened" || message.type === "seated") {
        const token = message.type === "roomOpened" ? message.hostToken : message.seatToken;
        const allowed = owners.get(token) ?? new Set();
        allowed.add(connection);
        owners.set(token, allowed);
      }
      inbox.get(connection)?.push(message as Sent);
    },
    close(connection) {
      closed.add(connection);
    },
  });

  const connect = (kind: "screen" | "phone", address = "10.0.0.1") => {
    const id = `c${++next}`;
    inbox.set(id, []);
    side.set(id, kind);
    rooms.connected(id, address);
    return id;
  };
  const say = (id: string, message: ScreenToServer | PhoneToServer) => {
    // Whoever presents a token is its owner on this socket: a phone or Screen coming back.
    if (message.type === "rejoin" || message.type === "resumeRoom") {
      const token = message.type === "rejoin" ? message.seatToken : message.hostToken;
      owners.get(token)?.add(id);
    }
    rooms.received(id, { ok: true, message });
  };
  const messages = (id: string) => inbox.get(id) ?? [];
  const last = (id: string) => messages(id).at(-1);
  const lastRoom = (id: string): Room => {
    const found = [...messages(id)].reverse().find((m) => m.type === "room" || m.type === "roomOpened" || m.type === "seated");
    if (found === undefined) throw new Error(`${id} has had no Room`);
    return found["room"] as Room;
  };

  const openRoom = (address?: string) => {
    const screen = connect("screen", address);
    say(screen, { type: "openRoom", v: 1 });
    const opened = last(screen)!;
    return { screen, code: (opened["room"] as Room).code, hostToken: opened["hostToken"] as string };
  };
  const join = (code: string, name: string, address?: string) => {
    const phone = connect("phone", address);
    say(phone, { type: "join", v: 1, code, name });
    const seated = messages(phone).find((m) => m.type === "seated");
    return { phone, seatId: seated?.["seatId"] as string, seatToken: seated?.["seatToken"] as string };
  };
  const rejoin = (code: string, seatToken: string, address?: string) => {
    const phone = connect("phone", address);
    say(phone, { type: "rejoin", v: 1, code, seatToken });
    return phone;
  };

  return { rooms, clock, connect, say, messages, last, lastRoom, closed, openRoom, join, rejoin };
}

const MATCH = { gameId: "sum-it-up", title: "Sum It Up", look: {} };

describe("opening a Room", () => {
  test("gives the Screen a four-letter code without I or O, a 32-hex host token, and an empty Room", () => {
    const h = harness();
    const { screen, code, hostToken } = h.openRoom();
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(hostToken).toMatch(/^[0-9a-f]{32}$/);
    expect(h.last(screen)).toEqual({ type: "roomOpened", hostToken, room: { code, seats: [], screenConnected: true, match: null, lastMatch: null } });
  });

  test("never gives two live Rooms the same code, and a closed Room's code can come back", () => {
    // Random bytes that spell AAAA, then AAAA again, then BBBB.
    const bytes = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
    let tokens = 0;
    const h = harness((size) => (size === 4 ? Buffer.from(bytes.splice(0, 4)) : Buffer.alloc(size, ++tokens)));
    const first = h.openRoom();
    const second = h.openRoom();
    expect([first.code, second.code]).toEqual(["AAAA", "BBBB"]);
    h.say(first.screen, { type: "closeRoom" });
    bytes.push(0, 0, 0, 0);
    expect(h.openRoom().code).toBe("AAAA");
  });

  test("a socket's first message must open, resume, join or rejoin: anything else is refused and the socket closed", () => {
    const h = harness();
    const phone = h.connect("phone");
    h.say(phone, { type: "action", action: { type: "tap" } });
    expect(h.messages(phone)).toEqual([{ type: "refused", reason: "badMessage" }]);
    expect(h.closed.has(phone)).toBe(true);

    for (const refusal of ["badMessage", "oldPage"] as const) {
      const other = h.connect("phone");
      h.rooms.received(other, { ok: false, refusal } satisfies Incoming);
      expect(h.messages(other)).toEqual([{ type: "refused", reason: refusal }]);
      expect(h.closed.has(other)).toBe(true);
    }
  });

  test("a bad message after the first is refused, but the socket stays", () => {
    const h = harness();
    const { screen } = h.openRoom();
    h.rooms.received(screen, { ok: false, refusal: "badMessage" });
    expect(h.last(screen)).toEqual({ type: "refused", reason: "badMessage" });
    h.say(screen, { type: "openRoom", v: 1 });
    expect(h.last(screen)).toEqual({ type: "refused", reason: "badMessage" });
    expect(h.closed.has(screen)).toBe(false);
  });
});

describe("joining", () => {
  test("seats the phone, gives it a 32-hex Seat token, and sends the whole Room to the Screen and every phone", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    expect(ada.seatToken).toMatch(/^[0-9a-f]{32}$/);
    const ben = h.join(code, "Ben");
    const seats = [
      { id: ada.seatId, name: "Ada", connected: true },
      { id: ben.seatId, name: "Ben", connected: true },
    ];
    expect(h.lastRoom(screen).seats).toEqual(seats);
    expect(h.lastRoom(ada.phone).seats).toEqual(seats);
    expect(h.lastRoom(ben.phone).seats).toEqual(seats);
  });

  test("tells two Players with the same name apart, whatever its case", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    for (const name of ["Ada", "Ada", "ada", "Ben"]) h.join(code, name);
    expect(h.lastRoom(screen).seats.map((s) => s.name)).toEqual(["Ada", "Ada (2)", "ada (3)", "Ben"]);
  });

  test(`holds at most ${MAX_SEATS} Seats: the next is refused with roomFull and closed`, () => {
    const h = harness();
    const { code } = h.openRoom();
    for (let i = 0; i < MAX_SEATS; i++) h.join(code, `P${i}`, `10.0.${i}.1`);
    const late = h.join(code, "Late", "10.1.0.1");
    expect(h.messages(late.phone)).toEqual([{ type: "refused", reason: "roomFull" }]);
    expect(h.closed.has(late.phone)).toBe(true);
  });

  test("a code that names no live Room is refused with noSuchRoom, for join, rejoin and resumeRoom", () => {
    const h = harness();
    const phone = h.join("ZZZZ", "Ada").phone;
    expect(h.messages(phone)).toEqual([{ type: "refused", reason: "noSuchRoom" }]);
    const again = h.rejoin("ZZZZ", "0".repeat(32));
    expect(h.messages(again)).toEqual([{ type: "refused", reason: "noSuchRoom" }]);
    const screen = h.connect("screen");
    h.say(screen, { type: "resumeRoom", v: 1, code: "ZZZZ", hostToken: "0".repeat(32) });
    expect(h.messages(screen)).toEqual([{ type: "refused", reason: "noSuchRoom" }]);
    expect([phone, again, screen].every((c) => h.closed.has(c))).toBe(true);
  });
});

describe("phones coming and going", () => {
  test(`a phone that drops keeps its Seat, marked not connected, for ${SEAT_GRACE_MS / 1000} seconds, then loses it`, () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    h.rooms.disconnected(ada.phone);
    expect(h.lastRoom(screen).seats).toEqual([{ id: ada.seatId, name: "Ada", connected: false }]);
    h.clock.advance(SEAT_GRACE_MS - 1);
    expect(h.lastRoom(screen).seats).toHaveLength(1);
    h.clock.advance(1);
    expect(h.lastRoom(screen).seats).toEqual([]);
    // Too late: the Seat is gone, so its token takes nothing back.
    const back = h.rejoin(code, ada.seatToken);
    expect(h.messages(back)).toEqual([{ type: "refused", reason: "badToken" }]);
  });

  test("rejoin with the right token takes the Seat back; a wrong token is refused with badToken and closed", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    h.rooms.disconnected(ada.phone);
    const wrong = h.rejoin(code, "f".repeat(32));
    expect(h.messages(wrong)).toEqual([{ type: "refused", reason: "badToken" }]);
    expect(h.closed.has(wrong)).toBe(true);
    const back = h.rejoin(code, ada.seatToken);
    expect(h.messages(back)[0]).toMatchObject({ type: "seated", seatId: ada.seatId, seatToken: ada.seatToken });
    expect(h.lastRoom(screen).seats).toEqual([{ id: ada.seatId, name: "Ada", connected: true }]);
    // The grace period was cancelled: nothing happens when it would have run out.
    h.clock.advance(SEAT_GRACE_MS * 2);
    expect(h.lastRoom(screen).seats).toHaveLength(1);
  });

  test("leave takes the Seat at once and tells the phone `left`; removeSeat tells it `removed`", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    const ben = h.join(code, "Ben");
    h.say(ada.phone, { type: "leave" });
    expect(h.last(ada.phone)).toEqual({ type: "closed", reason: "left" });
    expect(h.closed.has(ada.phone)).toBe(true);
    h.say(screen, { type: "removeSeat", seatId: ben.seatId });
    expect(h.last(ben.phone)).toEqual({ type: "closed", reason: "removed" });
    expect(h.closed.has(ben.phone)).toBe(true);
    expect(h.lastRoom(screen).seats).toEqual([]);
  });
});

describe("the Screen coming and going", () => {
  test(`a Screen that drops leaves the Room open for ${SCREEN_GRACE_MS / 60_000} minutes, then it closes with screenGone`, () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    h.rooms.disconnected(screen);
    expect(h.lastRoom(ada.phone).screenConnected).toBe(false);
    h.clock.advance(SCREEN_GRACE_MS - 1);
    expect(h.closed.has(ada.phone)).toBe(false);
    h.clock.advance(1);
    expect(h.last(ada.phone)).toEqual({ type: "closed", reason: "screenGone" });
    expect(h.closed.has(ada.phone)).toBe(true);
    expect(h.join(code, "Late").seatId).toBeUndefined();
  });

  test("resumeRoom with the host token takes the Room back; a wrong one is refused with badToken", () => {
    const h = harness();
    const { screen, code, hostToken } = h.openRoom();
    const ada = h.join(code, "Ada");
    h.rooms.disconnected(screen);
    const wrong = h.connect("screen");
    h.say(wrong, { type: "resumeRoom", v: 1, code, hostToken: "e".repeat(32) });
    expect(h.messages(wrong)).toEqual([{ type: "refused", reason: "badToken" }]);
    const back = h.connect("screen");
    h.say(back, { type: "resumeRoom", v: 1, code, hostToken });
    expect(h.messages(back)).toEqual([{ type: "roomOpened", hostToken, room: { code, seats: [{ id: ada.seatId, name: "Ada", connected: true }], screenConnected: true, match: null, lastMatch: null } }]);
    expect(h.lastRoom(ada.phone).screenConnected).toBe(true);
    h.clock.advance(SCREEN_GRACE_MS * 2);
    expect(h.closed.has(ada.phone)).toBe(false);
  });

  test("closeRoom tells every phone and the Screen hostClosed, closes them, and frees the code", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    h.say(screen, { type: "closeRoom" });
    expect(h.last(ada.phone)).toEqual({ type: "closed", reason: "hostClosed" });
    expect(h.last(screen)).toEqual({ type: "closed", reason: "hostClosed" });
    expect(h.closed.has(ada.phone) && h.closed.has(screen)).toBe(true);
  });
});

describe("a Match", () => {
  function playing() {
    const h = harness();
    const room = h.openRoom();
    const ada = h.join(room.code, "Ada");
    const ben = h.join(room.code, "Ben");
    h.say(room.screen, { type: "startMatch", match: MATCH });
    return { h, ...room, ada, ben };
  }

  test("startMatch is sent to everyone in the Room; views gives each phone only its own View, with the time left", () => {
    const { h, screen, ada, ben } = playing();
    expect(h.lastRoom(ada.phone).match).toEqual(MATCH);
    h.say(screen, { type: "views", views: { [ada.seatId]: { parts: ["for Ada"] }, [ben.seatId]: { parts: ["for Ben"] } }, timerMs: 30_000 });
    expect(h.last(ada.phone)).toEqual({ type: "view", view: { parts: ["for Ada"] }, timerMs: 30_000 });
    expect(h.last(ben.phone)).toEqual({ type: "view", view: { parts: ["for Ben"] }, timerMs: 30_000 });
  });

  test("a phone that comes back during a Match is sent its latest View at once, with the time left now", () => {
    const { h, screen, code, ada } = playing();
    h.say(screen, { type: "views", views: { [ada.seatId]: { parts: ["latest"] } }, timerMs: 30_000 });
    h.rooms.disconnected(ada.phone);
    h.clock.advance(12_000);
    const back = h.rejoin(code, ada.seatToken);
    expect(h.last(back)).toEqual({ type: "view", view: { parts: ["latest"] }, timerMs: 18_000 });
  });

  test("a new Match forgets every View; endMatch forgets them too and records how the Match ended", () => {
    const { h, screen, code, ada } = playing();
    h.say(screen, { type: "views", views: { [ada.seatId]: { parts: ["old"] } }, timerMs: null });
    h.say(screen, { type: "startMatch", match: MATCH });
    h.rooms.disconnected(ada.phone);
    const back = h.rejoin(code, ada.seatToken);
    expect(h.messages(back).some((m) => m.type === "view")).toBe(false);

    h.say(screen, { type: "endMatch", reason: "finished", scores: { [ada.seatId]: 3 } });
    const room = h.lastRoom(screen);
    expect(room.match).toBeNull();
    expect(room.lastMatch).toEqual({ title: "Sum It Up", reason: "finished", scores: { [ada.seatId]: 3 } });
  });

  test("views and endMatch with no Match running change nothing", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    const before = h.messages(ada.phone).length;
    h.say(screen, { type: "views", views: { [ada.seatId]: { parts: [] } }, timerMs: null });
    h.say(screen, { type: "endMatch", reason: "stopped" });
    expect(h.messages(ada.phone)).toHaveLength(before);
  });

  test("a phone's action reaches the Screen with its Seat id, only while a Match runs and the Screen is there", () => {
    const { h, screen, code, ada } = playing();
    h.say(ada.phone, { type: "action", action: { type: "write", text: "hi" } });
    expect(h.last(screen)).toEqual({ type: "action", seatId: ada.seatId, action: { type: "write", text: "hi" } });

    // The Screen away: dropped, not kept for later.
    h.rooms.disconnected(screen);
    h.say(ada.phone, { type: "action", action: { type: "late" } });
    const back = h.connect("screen");
    h.say(back, { type: "resumeRoom", v: 1, code, hostToken: (h.messages(screen)[0]!["hostToken"] as string) });
    expect(h.messages(back).some((m) => m.type === "action")).toBe(false);

    // No Match: dropped.
    h.say(back, { type: "endMatch", reason: "stopped" });
    h.say(ada.phone, { type: "action", action: { type: "after" } });
    expect(h.messages(back).some((m) => m.type === "action")).toBe(false);
  });
});

describe("limits", () => {
  test(`a phone may send ${PHONE_MESSAGES_PER_SECOND} messages a second: then tooFast once, and closed at ${CLOSE_AT_TIMES_THE_LIMIT} times that`, () => {
    const { h, screen, ada } = (() => {
      const h = harness();
      const room = h.openRoom();
      const ada = h.join(room.code, "Ada");
      h.say(room.screen, { type: "startMatch", match: MATCH });
      h.clock.advance(1_000);
      return { h, screen: room.screen, ada };
    })();
    for (let i = 0; i < PHONE_MESSAGES_PER_SECOND; i++) h.say(ada.phone, { type: "action", action: { n: i } });
    expect(h.messages(screen).filter((m) => m.type === "action")).toHaveLength(PHONE_MESSAGES_PER_SECOND);
    h.say(ada.phone, { type: "action", action: { n: "one too many" } });
    expect(h.messages(screen).filter((m) => m.type === "action")).toHaveLength(PHONE_MESSAGES_PER_SECOND);
    expect(h.last(ada.phone)).toEqual({ type: "refused", reason: "tooFast" });
    // A bad message counts too.
    h.rooms.received(ada.phone, { ok: false, refusal: "badMessage" });
    expect(h.messages(ada.phone).filter((m) => m.type === "refused")).toHaveLength(1);
    // 22 sent so far this second; the socket closes on exactly the 40th.
    for (let sent = 22; sent < PHONE_MESSAGES_PER_SECOND * CLOSE_AT_TIMES_THE_LIMIT - 1; sent++) h.say(ada.phone, { type: "action", action: {} });
    expect(h.closed.has(ada.phone)).toBe(false);
    h.say(ada.phone, { type: "action", action: {} });
    expect(h.closed.has(ada.phone)).toBe(true);
    // Closed like a dropped phone: the Seat waits for it to come back.
    expect(h.lastRoom(screen).seats[0]).toMatchObject({ connected: false });
  });

  test("the next second starts the count again", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    h.say(screen, { type: "startMatch", match: MATCH });
    h.clock.advance(1_000);
    for (let i = 0; i <= PHONE_MESSAGES_PER_SECOND; i++) h.say(ada.phone, { type: "action", action: {} });
    expect(h.last(ada.phone)).toEqual({ type: "refused", reason: "tooFast" });
    h.clock.advance(1_000);
    h.say(ada.phone, { type: "action", action: { n: "fresh" } });
    expect(h.last(screen)).toEqual({ type: "action", seatId: ada.seatId, action: { n: "fresh" } });
  });

  test(`the Screen may send ${SCREEN_MESSAGES_PER_SECOND} messages a second`, () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    h.say(screen, { type: "startMatch", match: MATCH });
    h.clock.advance(1_000);
    for (let i = 0; i < SCREEN_MESSAGES_PER_SECOND; i++) h.say(screen, { type: "views", views: { [ada.seatId]: { n: i } }, timerMs: null });
    expect(h.last(ada.phone)).toEqual({ type: "view", view: { n: SCREEN_MESSAGES_PER_SECOND - 1 }, timerMs: null });
    h.say(screen, { type: "views", views: { [ada.seatId]: { n: "too many" } }, timerMs: null });
    expect(h.last(screen)).toEqual({ type: "refused", reason: "tooFast" });
    expect(h.last(ada.phone)).toMatchObject({ view: { n: SCREEN_MESSAGES_PER_SECOND - 1 } });
    // 101 sent so far this second; the socket closes on exactly the 200th.
    for (let sent = 101; sent < SCREEN_MESSAGES_PER_SECOND * CLOSE_AT_TIMES_THE_LIMIT - 1; sent++) h.say(screen, { type: "views", views: {}, timerMs: null });
    expect(h.closed.has(screen)).toBe(false);
    h.say(screen, { type: "views", views: {}, timerMs: null });
    expect(h.closed.has(screen)).toBe(true);
    expect(h.lastRoom(ada.phone).screenConnected).toBe(false);
  });

  test("16 phones from one address (one Wi-Fi) all join within a second, and all rejoin at once after a blip", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const phones = Array.from({ length: 16 }, (_, i) => h.join(code, `P${i}`, "192.168.1.1"));
    expect(phones.every((p) => p.seatId !== undefined)).toBe(true);
    for (const p of phones) h.rooms.disconnected(p.phone);
    const back = phones.map((p) => h.rejoin(code, p.seatToken, "192.168.1.1"));
    expect(back.every((b) => h.messages(b)[0]?.type === "seated")).toBe(true);
    expect(h.lastRoom(screen).seats.every((s) => s.connected)).toBe(true);
  });

  test(`${FAILED_TRIES_PER_MINUTE} wrong guesses a minute per address; then every try is refused with tooFast, a right one too, until the minute slides`, () => {
    const h = harness();
    const { code } = h.openRoom();
    const ada = h.join(code, "Ada", "10.9.9.9");
    const guesser = "203.0.113.5";
    // Wrong codes, wrong Seat tokens and wrong host tokens all count.
    for (let i = 0; i < FAILED_TRIES_PER_MINUTE; i++) {
      if (i % 3 === 0) expect(h.messages(h.join("ZZZZ", "G", guesser).phone)).toEqual([{ type: "refused", reason: "noSuchRoom" }]);
      else if (i % 3 === 1) expect(h.messages(h.rejoin(code, "1".repeat(32), guesser))).toEqual([{ type: "refused", reason: "badToken" }]);
      else {
        const screen = h.connect("screen", guesser);
        h.say(screen, { type: "resumeRoom", v: 1, code, hostToken: "2".repeat(32) });
        expect(h.messages(screen)).toEqual([{ type: "refused", reason: "badToken" }]);
      }
      h.clock.advance(1_000);
    }
    const thirtyFirst = h.join("ZZZZ", "G", guesser).phone;
    expect(h.messages(thirtyFirst)).toEqual([{ type: "refused", reason: "tooFast" }]);
    expect(h.closed.has(thirtyFirst)).toBe(true);
    // A right code from the same address is refused too, until the first guess is a minute old.
    expect(h.messages(h.join(code, "Real", guesser).phone)).toEqual([{ type: "refused", reason: "tooFast" }]);
    expect(h.messages(h.rejoin(code, ada.seatToken, guesser))).toEqual([{ type: "refused", reason: "tooFast" }]);
    h.clock.advance(60_000 - FAILED_TRIES_PER_MINUTE * 1_000);
    expect(h.join(code, "Real", guesser).seatId).toBeDefined();
    // Another address was never affected.
    expect(h.join(code, "Elsewhere", "203.0.113.6").seatId).toBeDefined();
  });

  test(`one address may open ${ROOMS_OPENED_PER_MINUTE} Rooms a minute; the next is refused with tooFast and closed`, () => {
    const h = harness();
    for (let i = 0; i < ROOMS_OPENED_PER_MINUTE; i++) expect(h.openRoom("198.51.100.1").code).toMatch(/^[A-Z]{4}$/);
    const screen = h.connect("screen", "198.51.100.1");
    h.say(screen, { type: "openRoom", v: 1 });
    expect(h.messages(screen)).toEqual([{ type: "refused", reason: "tooFast" }]);
    expect(h.closed.has(screen)).toBe(true);
    h.clock.advance(60_000);
    expect(h.openRoom("198.51.100.1").code).toMatch(/^[A-Z]{4}$/);
  });

  test(`at most ${DEFAULT_MAX_ROOMS} Rooms open at once unless set: the next openRoom is refused with tooManyRooms and closed`, () => {
    const h = harness(undefined, 3);
    const rooms = [h.openRoom("10.0.0.1"), h.openRoom("10.0.0.2"), h.openRoom("10.0.0.3")];
    const screen = h.connect("screen", "10.0.0.4");
    h.say(screen, { type: "openRoom", v: 1 });
    expect(h.messages(screen)).toEqual([{ type: "refused", reason: "tooManyRooms" }]);
    expect(h.closed.has(screen)).toBe(true);
    h.say(rooms[0]!.screen, { type: "closeRoom" });
    expect(h.openRoom("10.0.0.4").code).toMatch(/^[A-Z]{4}$/);
  });

  test(`a socket that sends no first message within ${FIRST_MESSAGE_MS / 1000} seconds is closed`, () => {
    const h = harness();
    const idle = h.connect("phone");
    const slow = h.connect("screen");
    h.clock.advance(FIRST_MESSAGE_MS - 1);
    h.say(slow, { type: "openRoom", v: 1 });
    h.clock.advance(1);
    expect(h.closed.has(idle)).toBe(true);
    expect(h.messages(idle)).toEqual([]);
    expect(h.closed.has(slow)).toBe(false);
  });

  test(`a View over ${MAX_VIEW_BYTES / 1024} KB is refused with badMessage to the Screen, and neither sent nor kept; the others in the message go through`, () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    const ben = h.join(code, "Ben");
    h.say(screen, { type: "startMatch", match: MATCH });
    h.say(screen, { type: "views", views: { [ada.seatId]: { pad: "x".repeat(MAX_VIEW_BYTES) }, [ben.seatId]: { ok: true } }, timerMs: null });
    expect(h.last(screen)).toEqual({ type: "refused", reason: "badMessage" });
    expect(h.messages(ada.phone).some((m) => m.type === "view")).toBe(false);
    expect(h.last(ben.phone)).toEqual({ type: "view", view: { ok: true }, timerMs: null });
    h.rooms.disconnected(ada.phone);
    expect(h.messages(h.rejoin(code, ada.seatToken)).some((m) => m.type === "view")).toBe(false);
  });
});

describe("races", () => {
  test("a phone rejoining while its old socket is still open: the old one is closed, and its late close changes nothing", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    const fresh = h.rejoin(code, ada.seatToken);
    expect(h.last(ada.phone)).toEqual({ type: "closed", reason: "replaced" });
    expect(h.closed.has(ada.phone)).toBe(true);
    expect(h.messages(fresh)[0]).toMatchObject({ type: "seated", seatId: ada.seatId });
    h.rooms.disconnected(ada.phone);
    expect(h.lastRoom(screen).seats).toEqual([{ id: ada.seatId, name: "Ada", connected: true }]);
    h.clock.advance(SEAT_GRACE_MS * 2);
    expect(h.lastRoom(screen).seats).toHaveLength(1);
  });

  test("a Seat removed while its phone is reconnecting: the rejoin is refused, and the removed Seat's countdown never fires", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    h.rooms.disconnected(ada.phone);
    h.say(screen, { type: "removeSeat", seatId: ada.seatId });
    const roomsSent = h.messages(screen).length;
    const back = h.rejoin(code, ada.seatToken);
    expect(h.messages(back)).toEqual([{ type: "refused", reason: "badToken" }]);
    h.clock.advance(SEAT_GRACE_MS * 2);
    expect(h.messages(screen)).toHaveLength(roomsSent);
  });

  test("the Screen resuming while phones are mid-reconnect: each phone that comes back gets its View, and the Screen sees it back", () => {
    const h = harness();
    const { screen, code, hostToken } = h.openRoom();
    const ada = h.join(code, "Ada");
    const ben = h.join(code, "Ben");
    h.say(screen, { type: "startMatch", match: MATCH });
    h.say(screen, { type: "views", views: { [ada.seatId]: { v: "ada" }, [ben.seatId]: { v: "ben" } }, timerMs: null });
    h.rooms.disconnected(screen);
    h.rooms.disconnected(ada.phone);
    h.rooms.disconnected(ben.phone);
    const adaBack = h.rejoin(code, ada.seatToken);
    const newScreen = h.connect("screen");
    h.say(newScreen, { type: "resumeRoom", v: 1, code, hostToken });
    const benBack = h.rejoin(code, ben.seatToken);
    expect(h.last(adaBack)).toEqual({ type: "room", room: expect.objectContaining({ screenConnected: true }) });
    expect(h.messages(adaBack)).toContainEqual({ type: "view", view: { v: "ada" }, timerMs: null });
    expect(h.messages(benBack)).toContainEqual({ type: "view", view: { v: "ben" }, timerMs: null });
    expect(h.lastRoom(newScreen).seats.map((s) => s.connected)).toEqual([true, true]);
  });

  test("views arriving for a Seat that just left are dropped", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    const ben = h.join(code, "Ben");
    h.say(screen, { type: "startMatch", match: MATCH });
    h.say(ada.phone, { type: "leave" });
    h.say(screen, { type: "views", views: { [ada.seatId]: { v: "too late" }, [ben.seatId]: { v: "ben" } }, timerMs: null });
    expect(h.messages(ada.phone).some((m) => m.type === "view")).toBe(false);
    expect(h.last(ben.phone)).toEqual({ type: "view", view: { v: "ben" }, timerMs: null });
  });

  test("a replaced Screen socket closing late changes nothing", () => {
    const h = harness();
    const { screen, code, hostToken } = h.openRoom();
    const ada = h.join(code, "Ada");
    const newer = h.connect("screen");
    h.say(newer, { type: "resumeRoom", v: 1, code, hostToken });
    expect(h.last(screen)).toEqual({ type: "closed", reason: "replaced" });
    expect(h.closed.has(screen)).toBe(true);
    h.rooms.disconnected(screen);
    expect(h.lastRoom(ada.phone).screenConnected).toBe(true);
    h.clock.advance(SCREEN_GRACE_MS * 2);
    expect(h.closed.has(ada.phone)).toBe(false);
  });

  test("a closed Room cancels every timer, and messages from closed or unknown sockets change nothing", () => {
    const h = harness();
    const { screen, code } = h.openRoom();
    const ada = h.join(code, "Ada");
    const ben = h.join(code, "Ben");
    h.rooms.disconnected(ada.phone);
    expect(h.clock.pending()).toBe(1);
    h.say(screen, { type: "closeRoom" });
    expect(h.clock.pending()).toBe(0);
    h.say(ben.phone, { type: "leave" });
    h.rooms.received("never-seen", { ok: true, message: { type: "leave" } });
    h.rooms.disconnected("never-seen");
    expect(h.last(ben.phone)).toEqual({ type: "closed", reason: "hostClosed" });
  });
});
