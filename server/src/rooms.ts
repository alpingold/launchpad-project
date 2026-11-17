/**
 * Rooms and Seats: every rule of the server, in plain code with no sockets.
 *
 * The transport (transport.ts) tells this layer three things: a connection opened, a connection sent
 * a message (already parsed and checked against its schema, or why it couldn't be), and a connection
 * closed. This layer answers through `send` and `close`. It is given a clock rather than reading the
 * real time, so its tests can run 90 seconds or 5 minutes in an instant.
 *
 * The server passes messages; it never reads a View or an Action. The Screen is the referee (see
 * the protocol package): this layer only keeps who is in which Room, the latest View of each Seat,
 * and when the Match's timer runs out.
 */
import { randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";
import { MAX_VIEW_BYTES } from "@boilergames/sdk/v1/engine";
import {
  MAX_SEATS,
  PHONE_MESSAGES_PER_SECOND,
  SCREEN_MESSAGES_PER_SECOND,
  type MatchInfo,
  type MatchResult,
  type PhoneToServer,
  type Room,
  type ScreenToServer,
  type ServerToPhone,
  type ServerToScreen,
} from "@boilergames/protocol";

// ---------------------------------------------------------------------------------------------
// The numbers

/** How long a phone that lost its connection keeps its Seat, waiting for it to come back. */
export const SEAT_GRACE_MS = 90_000;
/** How long a Room stays open while its Screen is away (a reload, a laptop asleep). */
export const SCREEN_GRACE_MS = 5 * 60_000;
/**
 * How many wrong guesses one address may make in a minute: a `join`, `rejoin` or `resumeRoom`
 * refused with noSuchRoom or badToken. After that, every such try from the address is refused with
 * tooFast until the minute slides, a right one included. Only failures count: a Room's 16 phones
 * share one address on one Wi-Fi, and a campus shares a few, so successes can't be limited this way
 * (the 16-Seat cap bounds them). The limit is there to stop guessing Room Codes and tokens.
 */
export const FAILED_TRIES_PER_MINUTE = 30;
/** How many Rooms one address may open in a minute. */
export const ROOMS_OPENED_PER_MINUTE = 20;
/**
 * How many Rooms may be open at once, unless the server is told otherwise (MAX_ROOMS). Chosen to fit
 * about 256 MB. The most one Room can make the server hold:
 *
 * - each Seat's latest View, kept as JSON text and refused above MAX_VIEW_BYTES (128 KB), held as a
 *   string of up to 2 bytes a character: 16 Seats x 256 KB = 4 MB;
 * - each of its 17 sockets' unsent messages, up to MAX_UNSENT_BYTES (256 KB) before the socket is
 *   dropped (transport.ts): about 4.25 MB;
 * - the Room itself (codes, names, the Match's title and Look, the last result): a few KB.
 *
 * About 8.3 MB, so 30 Rooms is about 250 MB at the very worst; a real Room holds far less.
 */
export const DEFAULT_MAX_ROOMS = 30;
/** How long a new socket has to send its first message, which says what it is. */
export const FIRST_MESSAGE_MS = 10_000;
/**
 * A socket over its messages-per-second limit is sent `tooFast` once, and its extra messages are
 * dropped. One that keeps going until it has sent this many times its limit in the same second is
 * closed: it isn't a person tapping fast, it's a loop.
 */
export const CLOSE_AT_TIMES_THE_LIMIT = 2;
/** The letters of a Room Code: A to Z without I and O, which look like 1 and 0 on a TV. */
export const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 4;
/** Bytes of randomness in a token: 16 bytes, written as 32 hex characters. */
export const TOKEN_BYTES = 16;

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

// ---------------------------------------------------------------------------------------------
// What this layer is given

export type ConnectionId = string;

/** The time, and timers. The real one wraps Date.now and setTimeout; tests use a fake one. */
export interface Clock {
  now(): number;
  /** Runs `run` after `ms`. Returns a function that cancels it. */
  setTimeout(run: () => void, ms: number): () => void;
}

export interface RoomsOptions {
  /** Sends a message on a connection. The transport writes it as JSON. */
  readonly send: (connection: ConnectionId, message: ServerToScreen | ServerToPhone) => void;
  /** Closes a connection's socket. This layer has already forgotten the connection when it calls this. */
  readonly close: (connection: ConnectionId) => void;
  readonly clock: Clock;
  /** Random bytes for Room Codes and tokens. `crypto.randomBytes` unless a test wants to choose. */
  readonly randomBytes?: (size: number) => Buffer;
  /** How many Rooms may be open at once. DEFAULT_MAX_ROOMS unless set. */
  readonly maxRooms?: number;
}

/** A message as the transport hands it over: checked against its schema, or the reason it failed. */
export type Incoming =
  | { readonly ok: true; readonly message: ScreenToServer | PhoneToServer }
  | { readonly ok: false; readonly refusal: "badMessage" | "oldPage" };

// ---------------------------------------------------------------------------------------------
// What this layer keeps

interface Connection {
  readonly id: ConnectionId;
  /** Where it came from, for the join limit. */
  readonly address: string;
  /** Unknown until its first message says what it is. */
  side: "screen" | "phone" | undefined;
  room: RoomState | undefined;
  /** For a phone: its Seat. */
  seat: SeatState | undefined;
  /** Messages counted in the current second. */
  second: number;
  sent: number;
  warned: boolean;
  /** Cancels the wait for its first message. */
  cancelFirst: (() => void) | undefined;
}

interface SeatState {
  readonly id: string;
  readonly name: string;
  readonly token: string;
  phone: Connection | undefined;
  /** Cancels the countdown to losing the Seat, while its phone is away. */
  cancelGrace: (() => void) | undefined;
}

interface RoomState {
  readonly code: string;
  readonly hostToken: string;
  screen: Connection | undefined;
  cancelGrace: (() => void) | undefined;
  /** In joining order. */
  seats: SeatState[];
  nextSeat: number;
  match: MatchInfo | null;
  lastMatch: MatchResult | null;
  /**
   * The latest View of each Seat during a Match, by Seat id, as JSON text: the server never reads a
   * View, and text is the smallest way to hold one.
   */
  views: Map<string, string>;
  /** When the Match's timer runs out, by this server's clock, or null when it isn't running. */
  timerEndsAt: number | null;
}

export class Rooms {
  readonly #options: RoomsOptions;
  readonly #random: (size: number) => Buffer;
  readonly #connections = new Map<ConnectionId, Connection>();
  readonly #rooms = new Map<string, RoomState>();
  /** By address, when each wrong guess and each Room opened happened, within the last minute. */
  readonly #failures = new Map<string, number[]>();
  readonly #opened = new Map<string, number[]>();
  #lastSweep = 0;
  readonly #maxRooms: number;

  constructor(options: RoomsOptions) {
    this.#options = options;
    this.#random = options.randomBytes ?? cryptoRandomBytes;
    this.#maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
  }

  /** A socket opened. Its id must be new: the transport never reuses one. */
  connected(id: ConnectionId, address: string): void {
    const connection: Connection = { id, address, side: undefined, room: undefined, seat: undefined, second: -1, sent: 0, warned: false, cancelFirst: undefined };
    this.#connections.set(id, connection);
    // A socket that never says what it is holds a connection open for nothing.
    connection.cancelFirst = this.#options.clock.setTimeout(() => {
      if (this.#connections.get(id) === connection && connection.side === undefined) this.#forget(connection);
    }, FIRST_MESSAGE_MS);
  }

  /** A socket closed, on its own or because this layer closed it. Unknown or forgotten ids change nothing. */
  disconnected(id: ConnectionId): void {
    const connection = this.#connections.get(id);
    if (connection === undefined) return;
    this.#connections.delete(id);
    connection.cancelFirst?.();
    this.#lose(connection);
  }

  /** What a socket's first message made it, so the transport knows which schema to check it with. */
  sideOf(id: ConnectionId): "screen" | "phone" | undefined {
    return this.#connections.get(id)?.side;
  }

  /** A socket sent a message. */
  received(id: ConnectionId, incoming: Incoming): void {
    const connection = this.#connections.get(id);
    if (connection === undefined) return;
    // Every message counts towards the limit, the ones that failed to parse included.
    if (!this.#withinRate(connection)) return;
    if (!incoming.ok) {
      this.#send(connection, { type: "refused", reason: incoming.refusal });
      // A socket whose first message isn't valid isn't anything yet: there is nothing to keep it for.
      if (connection.side === undefined) this.#drop(connection);
      return;
    }
    const message = incoming.message;
    if (connection.side === undefined) return this.#first(connection, message);
    if (connection.side === "screen") return this.#fromScreen(connection, message as ScreenToServer);
    return this.#fromPhone(connection, message as PhoneToServer);
  }

  /** Cancels every timer and forgets everything: for shutting the server down. */
  stop(): void {
    for (const room of this.#rooms.values()) this.#cancelTimers(room);
    for (const connection of this.#connections.values()) connection.cancelFirst?.();
    this.#rooms.clear();
    this.#connections.clear();
  }

  // -------------------------------------------------------------------------------------------
  // Limits

  /** Counts the message. False if the socket is over its limit this second (it may have been closed). */
  #withinRate(connection: Connection): boolean {
    const second = Math.floor(this.#options.clock.now() / SECOND_MS);
    if (second !== connection.second) {
      connection.second = second;
      connection.sent = 0;
      connection.warned = false;
    }
    connection.sent += 1;
    const limit = connection.side === "screen" ? SCREEN_MESSAGES_PER_SECOND : PHONE_MESSAGES_PER_SECOND;
    if (connection.sent <= limit) return true;
    if (connection.sent >= limit * CLOSE_AT_TIMES_THE_LIMIT) {
      this.#drop(connection);
    } else if (!connection.warned) {
      connection.warned = true;
      this.#send(connection, { type: "refused", reason: "tooFast" });
    }
    return false;
  }

  /** How many times `address` appears in `log` within the last minute (forgetting older entries). */
  #recent(log: Map<string, number[]>, address: string): number {
    const now = this.#options.clock.now();
    // Now and then, forget addresses whose entries are all over a minute old, so the maps can't grow forever.
    if (now - this.#lastSweep >= MINUTE_MS) {
      this.#lastSweep = now;
      for (const map of [this.#failures, this.#opened]) for (const [key, times] of map) if (times.every((at) => now - at >= MINUTE_MS)) map.delete(key);
    }
    const times = (log.get(address) ?? []).filter((at) => now - at < MINUTE_MS);
    if (times.length === 0) log.delete(address);
    else log.set(address, times);
    return times.length;
  }

  #note(log: Map<string, number[]>, address: string): void {
    log.set(address, [...(log.get(address) ?? []), this.#options.clock.now()]);
  }

  /** Refuses a wrong guess, and counts it against the address. */
  #wrongGuess(connection: Connection, reason: "noSuchRoom" | "badToken"): void {
    this.#note(this.#failures, connection.address);
    this.#refuseAndClose(connection, reason);
  }

  // -------------------------------------------------------------------------------------------
  // The first message: what a socket is

  #first(connection: Connection, message: ScreenToServer | PhoneToServer): void {
    connection.cancelFirst?.();
    connection.cancelFirst = undefined;
    if (message.type === "resumeRoom" || message.type === "join" || message.type === "rejoin") {
      // Too many wrong guesses from this address: no more tries until the minute slides.
      if (this.#recent(this.#failures, connection.address) >= FAILED_TRIES_PER_MINUTE) return this.#refuseAndClose(connection, "tooFast");
    }
    switch (message.type) {
      case "openRoom":
        return this.#openRoom(connection);
      case "resumeRoom":
        return this.#resumeRoom(connection, message.code, message.hostToken);
      case "join":
        return this.#join(connection, message.code, message.name);
      case "rejoin":
        return this.#rejoin(connection, message.code, message.seatToken);
      default:
        return this.#refuseAndClose(connection, "badMessage");
    }
  }

  #openRoom(connection: Connection): void {
    if (this.#recent(this.#opened, connection.address) >= ROOMS_OPENED_PER_MINUTE) return this.#refuseAndClose(connection, "tooFast");
    if (this.#rooms.size >= this.#maxRooms) return this.#refuseAndClose(connection, "tooManyRooms");
    this.#note(this.#opened, connection.address);
    const room: RoomState = {
      code: this.#newCode(),
      hostToken: this.#token(),
      screen: connection,
      cancelGrace: undefined,
      seats: [],
      nextSeat: 1,
      match: null,
      lastMatch: null,
      views: new Map(),
      timerEndsAt: null,
    };
    this.#rooms.set(room.code, room);
    connection.side = "screen";
    connection.room = room;
    this.#send(connection, { type: "roomOpened", hostToken: room.hostToken, room: this.#snapshot(room) });
  }

  #resumeRoom(connection: Connection, code: string, hostToken: string): void {
    const room = this.#rooms.get(code);
    if (room === undefined) return this.#wrongGuess(connection, "noSuchRoom");
    if (!sameToken(room.hostToken, hostToken)) return this.#wrongGuess(connection, "badToken");
    // An older socket for this Screen (another tab, or one the network hasn't noticed is dead) is
    // replaced, not kept: one Room has one Screen.
    const older = room.screen;
    room.screen = connection;
    if (older !== undefined) this.#replace(older);
    room.cancelGrace?.();
    room.cancelGrace = undefined;
    connection.side = "screen";
    connection.room = room;
    this.#send(connection, { type: "roomOpened", hostToken: room.hostToken, room: this.#snapshot(room) });
    this.#broadcast(room, connection);
  }

  #join(connection: Connection, code: string, typed: string): void {
    const room = this.#rooms.get(code);
    if (room === undefined) return this.#wrongGuess(connection, "noSuchRoom");
    if (room.seats.length >= MAX_SEATS) return this.#refuseAndClose(connection, "roomFull");
    const seat: SeatState = { id: `s${room.nextSeat++}`, name: uniqueName(typed, room.seats), token: this.#token(), phone: connection, cancelGrace: undefined };
    room.seats.push(seat);
    connection.side = "phone";
    connection.room = room;
    connection.seat = seat;
    this.#send(connection, { type: "seated", seatId: seat.id, seatToken: seat.token, room: this.#snapshot(room) });
    this.#broadcast(room, connection);
  }

  #rejoin(connection: Connection, code: string, seatToken: string): void {
    const room = this.#rooms.get(code);
    if (room === undefined) return this.#wrongGuess(connection, "noSuchRoom");
    // Every Seat is compared, without stopping at a match, so the time taken says nothing about
    // which Seat (if any) the token belongs to.
    let seat: SeatState | undefined;
    for (const candidate of room.seats) if (sameToken(candidate.token, seatToken) && seat === undefined) seat = candidate;
    if (seat === undefined) return this.#wrongGuess(connection, "badToken");
    const older = seat.phone;
    seat.phone = connection;
    if (older !== undefined) this.#replace(older);
    seat.cancelGrace?.();
    seat.cancelGrace = undefined;
    connection.side = "phone";
    connection.room = room;
    connection.seat = seat;
    this.#send(connection, { type: "seated", seatId: seat.id, seatToken: seat.token, room: this.#snapshot(room) });
    this.#broadcast(room, connection);
    this.#sendCachedView(room, seat);
  }

  // -------------------------------------------------------------------------------------------
  // The Screen

  #fromScreen(connection: Connection, message: ScreenToServer): void {
    const room = connection.room;
    if (room === undefined || room.screen !== connection) return;
    switch (message.type) {
      case "startMatch":
        room.match = message.match;
        room.views.clear();
        room.timerEndsAt = null;
        return this.#broadcast(room);
      case "views": {
        if (room.match === null) return;
        const now = this.#options.clock.now();
        room.timerEndsAt = message.timerMs === null ? null : now + message.timerMs;
        let tooBig = false;
        for (const [seatId, view] of Object.entries(message.views)) {
          // A View for a Seat that has just gone (left, removed, timed out) is for nobody: dropped.
          const seat = room.seats.find((s) => s.id === seatId);
          if (seat === undefined) continue;
          // Measured, never read: a View bigger than any Game may draw is refused, so a Room can't
          // make the server hold more than DEFAULT_MAX_ROOMS was worked out for.
          const text = JSON.stringify(view) ?? "null";
          if (Buffer.byteLength(text, "utf8") > MAX_VIEW_BYTES) {
            tooBig = true;
            continue;
          }
          room.views.set(seat.id, text);
          if (seat.phone !== undefined) this.#send(seat.phone, { type: "view", view, timerMs: this.#timeLeft(room) });
        }
        if (tooBig) this.#send(connection, { type: "refused", reason: "badMessage" });
        return;
      }
      case "endMatch":
        if (room.match === null) return;
        room.lastMatch = {
          title: room.match.title,
          reason: message.reason,
          ...(message.scores === undefined ? {} : { scores: message.scores }),
          ...(message.winners === undefined ? {} : { winners: message.winners }),
        };
        room.match = null;
        room.views.clear();
        room.timerEndsAt = null;
        return this.#broadcast(room);
      case "removeSeat": {
        const seat = room.seats.find((s) => s.id === message.seatId);
        if (seat !== undefined) this.#removeSeat(room, seat, "removed");
        return;
      }
      case "closeRoom":
        return this.#closeRoom(room, "hostClosed");
      default:
        // openRoom or resumeRoom again: a socket is what its first message said, once.
        return this.#send(connection, { type: "refused", reason: "badMessage" });
    }
  }

  // -------------------------------------------------------------------------------------------
  // The phones

  #fromPhone(connection: Connection, message: PhoneToServer): void {
    const room = connection.room;
    const seat = connection.seat;
    if (room === undefined || seat === undefined || seat.phone !== connection) return;
    switch (message.type) {
      case "action":
        // Only while a Match is running and the Screen is there to check it. Otherwise dropped:
        // the Player still sees their View and can tap again.
        if (room.match !== null && room.screen !== undefined) this.#send(room.screen, { type: "action", seatId: seat.id, action: message.action });
        return;
      case "leave":
        return this.#removeSeat(room, seat, "left");
      default:
        return this.#send(connection, { type: "refused", reason: "badMessage" });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Losing and removing

  /** A connection is gone. If it still held its Screen or Seat, they wait for it to come back. */
  #lose(connection: Connection): void {
    const room = connection.room;
    if (room === undefined || this.#rooms.get(room.code) !== room) return;
    if (connection.side === "screen" && room.screen === connection) {
      room.screen = undefined;
      room.cancelGrace = this.#options.clock.setTimeout(() => this.#closeRoom(room, "screenGone"), SCREEN_GRACE_MS);
      this.#broadcast(room);
    }
    const seat = connection.seat;
    if (connection.side === "phone" && seat !== undefined && seat.phone === connection && room.seats.includes(seat)) {
      seat.phone = undefined;
      seat.cancelGrace = this.#options.clock.setTimeout(() => this.#removeSeat(room, seat, undefined), SEAT_GRACE_MS);
      this.#broadcast(room);
    }
  }

  /** Takes a Seat out of its Room at once, telling its phone why if it is there. */
  #removeSeat(room: RoomState, seat: SeatState, reason: "removed" | "left" | undefined): void {
    if (!room.seats.includes(seat)) return;
    seat.cancelGrace?.();
    seat.cancelGrace = undefined;
    room.seats = room.seats.filter((s) => s !== seat);
    room.views.delete(seat.id);
    const phone = seat.phone;
    seat.phone = undefined;
    if (phone !== undefined) {
      if (reason !== undefined) this.#send(phone, { type: "closed", reason });
      this.#forget(phone);
    }
    this.#broadcast(room);
  }

  #closeRoom(room: RoomState, reason: "hostClosed" | "screenGone"): void {
    if (this.#rooms.get(room.code) !== room) return;
    this.#rooms.delete(room.code);
    this.#cancelTimers(room);
    for (const seat of room.seats) {
      if (seat.phone === undefined) continue;
      this.#send(seat.phone, { type: "closed", reason });
      this.#forget(seat.phone);
    }
    if (room.screen !== undefined) {
      this.#send(room.screen, { type: "closed", reason });
      this.#forget(room.screen);
    }
  }

  #cancelTimers(room: RoomState): void {
    room.cancelGrace?.();
    room.cancelGrace = undefined;
    for (const seat of room.seats) {
      seat.cancelGrace?.();
      seat.cancelGrace = undefined;
    }
  }

  #refuseAndClose(connection: Connection, reason: "badMessage" | "noSuchRoom" | "roomFull" | "badToken" | "tooFast" | "tooManyRooms"): void {
    this.#send(connection, { type: "refused", reason });
    this.#drop(connection);
  }

  /** Closes a socket as if it had dropped: its Screen or Seat waits for it to come back. */
  #drop(connection: Connection): void {
    this.#connections.delete(connection.id);
    connection.cancelFirst?.();
    this.#lose(connection);
    this.#options.close(connection.id);
  }

  /** Tells a socket its Seat or Room was taken up elsewhere, and closes it. */
  #replace(connection: Connection): void {
    this.#send(connection, { type: "closed", reason: "replaced" });
    this.#forget(connection);
  }

  /** Closes a socket that no longer holds anything: replaced, removed, or its Room closed. */
  #forget(connection: Connection): void {
    this.#connections.delete(connection.id);
    connection.cancelFirst?.();
    this.#options.close(connection.id);
  }

  // -------------------------------------------------------------------------------------------
  // Sending

  #send(connection: Connection, message: ServerToScreen | ServerToPhone): void {
    this.#options.send(connection.id, message);
  }

  /** The whole Room to the Screen and every connected phone, except `skip` (who was just told). */
  #broadcast(room: RoomState, skip?: Connection): void {
    const message = { type: "room" as const, room: this.#snapshot(room) };
    if (room.screen !== undefined && room.screen !== skip) this.#send(room.screen, message);
    for (const seat of room.seats) if (seat.phone !== undefined && seat.phone !== skip) this.#send(seat.phone, message);
  }

  /** During a Match, a phone that comes back gets its latest View at once, without asking the Screen. */
  #sendCachedView(room: RoomState, seat: SeatState): void {
    if (room.match === null || seat.phone === undefined || !room.views.has(seat.id)) return;
    this.#send(seat.phone, { type: "view", view: JSON.parse(room.views.get(seat.id) ?? "null") as unknown, timerMs: this.#timeLeft(room) });
  }

  #timeLeft(room: RoomState): number | null {
    return room.timerEndsAt === null ? null : Math.max(0, room.timerEndsAt - this.#options.clock.now());
  }

  #snapshot(room: RoomState): Room {
    return {
      code: room.code,
      seats: room.seats.map((seat) => ({ id: seat.id, name: seat.name, connected: seat.phone !== undefined })),
      screenConnected: room.screen !== undefined,
      match: room.match,
      lastMatch: room.lastMatch,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Codes and tokens

  /** A Room Code no live Room has. Unbiased: a byte is used only if it falls in a whole number of alphabets. */
  #newCode(): string {
    const usable = 256 - (256 % CODE_LETTERS.length);
    for (;;) {
      let code = "";
      while (code.length < CODE_LENGTH) {
        for (const byte of this.#random(CODE_LENGTH)) if (byte < usable && code.length < CODE_LENGTH) code += CODE_LETTERS[byte % CODE_LETTERS.length];
      }
      if (!this.#rooms.has(code)) return code;
    }
  }

  #token(): string {
    return this.#random(TOKEN_BYTES).toString("hex");
  }
}

/**
 * Compares two tokens in constant time: how long it takes says nothing about how much of a guess
 * was right. (timingSafeEqual needs equal lengths; a guess of the wrong length is simply wrong.)
 */
function sameToken(real: string, given: string): boolean {
  const a = Buffer.from(real, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The name as typed (the schema has trimmed it), or with " (2)", " (3)"... if someone in the Room
 * already has it. Compared without case: "ada" and "Ada" on one TV would be confusing.
 */
function uniqueName(typed: string, seats: readonly SeatState[]): string {
  const taken = new Set(seats.map((s) => s.name.toLowerCase()));
  if (!taken.has(typed.toLowerCase())) return typed;
  for (let n = 2; ; n++) {
    const candidate = `${typed} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
