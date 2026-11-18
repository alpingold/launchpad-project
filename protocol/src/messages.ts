/**
 * The room messages.
 *
 * Three programs talk: the Screen, the phones, and the server between them. Every message is one
 * JSON object told apart by `type`, and each direction has its own union with a schema, so whoever
 * receives a message checks it before trusting it. The types below come from the schemas, so the
 * two can't drift.
 *
 * Three rules shape everything here:
 *
 * 1. The Screen is the referee. It runs the Game and decides every View. The server never runs or
 *    reads a Game: a View and an Action are `unknown` to it, passed along whole.
 * 2. Snapshots, never changes. The server always sends the whole Room, and the Screen always sends
 *    a phone's whole View. A missed message is repaired by the next one, and a reconnect is just
 *    "send the latest again".
 * 3. The server remembers the latest View of every Seat. A phone that reconnects gets its View at
 *    once, without the Screen, even while the Screen itself is reloading.
 */
import type { Look, MatchEnd } from "@boilergames/sdk/v1";
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Limits

/** Bumped when a message changes shape. A phone still showing an old page is told to reload. */
export const PROTOCOL_VERSION = 1;
/** The most Players a Room holds. A Game may ask for fewer. */
export const MAX_SEATS = 16;
export const MAX_NAME_LENGTH = 16;
/** The largest message the server accepts, in bytes. A phone's drawing is the big one. */
export const MAX_MESSAGE_BYTES = 256 * 1024;
/** How many messages a phone's socket may send in one second. More gets `tooFast`. */
export const PHONE_MESSAGES_PER_SECOND = 20;
/**
 * The same for the Screen's socket, higher because the Screen splits Views across `views` messages:
 * one event with 16 large Views can be 16 messages, and a resume sends every View at once. The
 * Screen sends them straight away rather than spacing them out, so a phone never waits on a queue.
 */
export const SCREEN_MESSAGES_PER_SECOND = 100;

// ---------------------------------------------------------------------------------------------
// Pieces

/** Four letters, without the ones that look alike when read off the Screen (I and O). */
const roomCode = z.string().regex(/^[A-HJ-NP-Z]{4}$/);
const playerName = z.string().trim().min(1).max(MAX_NAME_LENGTH);
/** A secret that proves who a socket is: a Seat's own, or the Host's. Never sent to anyone else. */
const token = z.string().min(16).max(64);
const seatId = z.string().min(1).max(16);
const version = z.literal(PROTOCOL_VERSION);

const hex = z.custom<`#${string}`>((value) => typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value));

/** A Game's Look, as the SDK defines it. Phones need it to draw the Game's Views. */
export const lookSchema = z.strictObject({
  colors: z.strictObject({ background: hex, surface: hex, text: hex, accent: hex }).partial().optional(),
  font: z.enum(["plain", "rounded", "serif", "mono", "poster", "handwritten"]).optional(),
  corners: z.enum(["sharp", "soft", "round"]).optional(),
});

/**
 * A Player's place in the Room. `connected` is false while their phone is away but may come back.
 * Two Players may ask for the same name; the server tells them apart as "Ada" and "Ada (2)", so
 * `name` here can be a little longer than the name a Player typed.
 */
const seat = z.strictObject({ id: seatId, name: z.string().min(1).max(MAX_NAME_LENGTH + 5), connected: z.boolean() });
export type Seat = z.infer<typeof seat>;

/** The Match being played, as much as a phone needs before its first View arrives. */
const matchInfo = z.strictObject({
  gameId: z.string().min(1).max(64),
  title: z.string().min(1).max(60),
  look: lookSchema,
});
export type MatchInfo = z.infer<typeof matchInfo>;

/**
 * Why a Match is over. `finished`: the Game ended it. `stopped`: the Host did. `broken`: the Game
 * crashed, hung or returned something invalid. `tooFewPlayers`: Players left below its minimum.
 */
const endReason = z.enum(["finished", "stopped", "broken", "tooFewPlayers"]);

const matchResult = z.strictObject({
  title: z.string().min(1).max(60),
  reason: endReason,
  scores: z.record(seatId, z.number()).optional(),
  winners: z.array(seatId).max(MAX_SEATS).optional(),
});
export type MatchResult = z.infer<typeof matchResult>;

/** The whole Room, as everyone in it sees it. Sent again, whole, whenever anything in it changes. */
const room = z.strictObject({
  code: roomCode,
  seats: z.array(seat).max(MAX_SEATS),
  /** False while the Screen is reloading or has lost its connection. */
  screenConnected: z.boolean(),
  /** The Match being played, or null in the Lobby. */
  match: matchInfo.nullable(),
  /** How the last Match ended, to show in the Lobby. */
  lastMatch: matchResult.nullable(),
});
export type Room = z.infer<typeof room>;

/** Why the server said no. Each is something the page can explain to a person. */
const refusal = z.enum([
  "badMessage",
  "oldPage",
  "noSuchRoom",
  "roomFull",
  "badToken",
  "tooFast",
  /** openRoom: the site has as many Rooms open as it can hold. Try again in a few minutes. */
  "tooManyRooms",
  /** openRoom: this network (address) already has as many Rooms open as one may. Close one, or wait. */
  "tooManyRoomsHere",
]);

/**
 * Why a socket's part in the Room is over. `replaced`: the same Seat (a `rejoin`) or the same Room
 * (a `resumeRoom`) was taken up on another socket, such as another tab. A page told this must not
 * reconnect, or two tabs would take the Seat from each other forever: it says the Seat or Room is
 * open elsewhere.
 */
const closure = z.enum(["hostClosed", "screenGone", "removed", "left", "replaced"]);

// ---------------------------------------------------------------------------------------------
// Screen → server

export const screenToServer = z.discriminatedUnion("type", [
  /** First message of a new Room. Answered with `roomOpened`. */
  z.strictObject({ type: z.literal("openRoom"), v: version }),
  /** First message after the Screen reloads: take the Room back. Answered with `roomOpened`. */
  z.strictObject({ type: z.literal("resumeRoom"), v: version, code: roomCode, hostToken: token }),
  /** The Host started a Match. Every earlier View is forgotten. */
  z.strictObject({ type: z.literal("startMatch"), match: matchInfo }),
  /**
   * The latest Views, by Seat, for the Seats whose View changed, and the Match's timer: how many
   * milliseconds are left, or null when it isn't running. The server hands each phone only its own.
   */
  z.strictObject({
    type: z.literal("views"),
    views: z.record(seatId, z.unknown()),
    timerMs: z.number().nonnegative().nullable(),
  }),
  /** The Match is over. The Room is back in the Lobby. */
  z.strictObject({
    type: z.literal("endMatch"),
    reason: endReason,
    scores: z.record(seatId, z.number()).optional(),
    winners: z.array(seatId).max(MAX_SEATS).optional(),
  }),
  /** The Host removed a Player. Their phone is told and their Seat is gone. */
  z.strictObject({ type: z.literal("removeSeat"), seatId }),
  /** The Host closed the Room. */
  z.strictObject({ type: z.literal("closeRoom") }),
]);
export type ScreenToServer = z.infer<typeof screenToServer>;

// ---------------------------------------------------------------------------------------------
// Server → Screen

export const serverToScreen = z.discriminatedUnion("type", [
  /** The Room is yours. Keep `hostToken` to take it back after a reload. */
  z.strictObject({ type: z.literal("roomOpened"), hostToken: token, room }),
  /**
   * The Room changed: someone joined, dropped, came back, or left for good. The Screen compares it
   * with the Room it had: a Seat that is gone has left the Match, a new one may be a late joiner.
   */
  z.strictObject({ type: z.literal("room"), room }),
  /**
   * A Player used their Controller. The Screen checks their current View really offers it. Actions
   * sent while the Screen is away are dropped, not kept: the Player still sees their View and taps again.
   */
  z.strictObject({ type: z.literal("action"), seatId, action: z.unknown() }),
  z.strictObject({ type: z.literal("refused"), reason: refusal }),
  z.strictObject({ type: z.literal("closed"), reason: closure }),
]);
export type ServerToScreen = z.infer<typeof serverToScreen>;

// ---------------------------------------------------------------------------------------------
// Phone → server

export const phoneToServer = z.discriminatedUnion("type", [
  /** First message of a new Player. Answered with `seated`. */
  z.strictObject({ type: z.literal("join"), v: version, code: roomCode, name: playerName }),
  /** First message after a phone reloads or wakes: take the Seat back. Answered with `seated`. */
  z.strictObject({ type: z.literal("rejoin"), v: version, code: roomCode, seatToken: token }),
  /** The Player used a Part of their Controller. Passed to the Screen with their Seat's id. */
  z.strictObject({ type: z.literal("action"), action: z.unknown() }),
  /** The Player left on purpose. Their Seat is gone at once, with no wait for them to return. */
  z.strictObject({ type: z.literal("leave") }),
]);
export type PhoneToServer = z.infer<typeof phoneToServer>;

// ---------------------------------------------------------------------------------------------
// Server → phone

export const serverToPhone = z.discriminatedUnion("type", [
  /** You have a Seat. Keep `seatToken` to take it back after a reload. */
  z.strictObject({ type: z.literal("seated"), seatId, seatToken: token, room }),
  z.strictObject({ type: z.literal("room"), room }),
  /**
   * Your Controller's View, and how long the Match's timer has left (null: not running). During a
   * Match, a phone that has had no View yet is a latecomer waiting for the next Match.
   */
  z.strictObject({ type: z.literal("view"), view: z.unknown(), timerMs: z.number().nonnegative().nullable() }),
  z.strictObject({ type: z.literal("refused"), reason: refusal }),
  z.strictObject({ type: z.literal("closed"), reason: closure }),
]);
export type ServerToPhone = z.infer<typeof serverToPhone>;

// ---------------------------------------------------------------------------------------------
// The schemas above must describe the SDK's own types. If one drifts, these lines stop compiling.

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const lookMatchesTheSdk: Same<z.infer<typeof lookSchema>, Look> = true;
export const endMatchFitsTheSdk: Same<
  Pick<Extract<ScreenToServer, { type: "endMatch" }>, "scores" | "winners">,
  { scores?: MatchEnd["scores"]; winners?: string[] }
> = true;
