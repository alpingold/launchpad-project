import { CLIENT } from './messageTypes.js';
import { config } from '../config.js';

// Turns one raw WebSocket frame into a trusted, cleaned-up message object — or a reason it was rejected.
//
// Everything a client sends is untrusted. This file is the ONLY place raw client data is read.
// Every other part of the server receives the clean object built here, which contains
// exactly the fields listed in SCHEMAS below and nothing else.

// Returned by a field reader when the value is not acceptable.
const INVALID = Symbol('invalid');

const ROOM_CODE_RE = /^[A-Z]{4}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes in base64url
const PLAYER_ID_RE = /^p_[a-z0-9]{4,12}$/;
const GAME_ID_RE = /^[a-z0-9-]{1,40}$/;

/** True for `{...}` objects; false for null, arrays, strings, numbers, etc. */
export function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

// --- Field readers -------------------------------------------------------
// Each takes the raw value from the client and returns either the cleaned value or INVALID.

function readRoomCode(value) {
  if (typeof value !== 'string') return INVALID;
  // Be forgiving about how people type the code ("  bxkt " is fine).
  const code = value.trim().toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : INVALID;
}

function readName(value) {
  // Only a cheap sanity check here. The real name rules (trimming, length 1–16,
  // no invisible characters, uniqueness) belong to the room layer in M3.
  if (typeof value !== 'string' || value.length > config.NAME_RAW_MAX_LENGTH) return INVALID;
  return value;
}

function readToken(value) {
  return typeof value === 'string' && TOKEN_RE.test(value) ? value : INVALID;
}

function readPlayerId(value) {
  return typeof value === 'string' && PLAYER_ID_RE.test(value) ? value : INVALID;
}

function readGameId(value) {
  return typeof value === 'string' && GAME_ID_RE.test(value) ? value : INVALID;
}

function readPlainObject(value) {
  // Contents are checked later by whoever uses it (e.g. the game validates its own actions).
  // Size is already capped by the WebSocket max payload.
  return isPlainObject(value) ? value : INVALID;
}

/**
 * Any JSON value (it's already parsed). Used for game:action's `input`, which the game's
 * runner checks against the block on the player's screen. Size is capped by max payload.
 */
function readJson(value) {
  return value;
}

/** Wraps a reader so a missing field is allowed (and simply left out of the result). */
function optional(reader) {
  return (value) => (value === undefined ? undefined : reader(value));
}

// --- Schemas -------------------------------------------------------------
// For each client message type: which fields it has and how to read each one.
// A field not listed here is ignored even if the client sends it.
const SCHEMAS = {
  [CLIENT.HOST_CREATE_ROOM]: {},
  [CLIENT.HOST_RESUME]: { code: readRoomCode, hostToken: readToken },
  [CLIENT.PLAYER_JOIN]: { code: readRoomCode, name: readName },
  [CLIENT.PLAYER_RESUME]: { code: readRoomCode, token: readToken },
  [CLIENT.ROOM_LEAVE]: {},
  [CLIENT.HOST_KICK]: { playerId: readPlayerId },
  [CLIENT.HOST_START_GAME]: { gameId: readGameId, options: optional(readPlainObject) },
  [CLIENT.GAME_ACTION]: { action: readPlainObject, input: optional(readJson) },
};

/**
 * @typedef {{ ok: true, msg: { type: string, [field: string]: unknown } }} ParseSuccess
 * @typedef {{ ok: false, code: 'BAD_MESSAGE' | 'UNKNOWN_TYPE' | 'INVALID_FIELDS', requestType?: string, field?: string }} ParseFailure
 */

/**
 * Validates one incoming WebSocket frame.
 * @param {Buffer | string} data  the raw frame from `ws`
 * @param {{ isBinary?: boolean }} [opts]
 * @returns {ParseSuccess | ParseFailure}
 */
export function parseClientMessage(data, { isBinary = false } = {}) {
  // 1. We only speak JSON text. Binary frames are rejected outright.
  if (isBinary) return { ok: false, code: 'BAD_MESSAGE' };

  // 2. Parse safely: bad JSON must never throw out of here.
  let raw;
  try {
    raw = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
  } catch {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  // 3. Must be a `{...}` object (not null, an array, a number, ...).
  if (!isPlainObject(raw)) return { ok: false, code: 'BAD_MESSAGE' };

  // 4. `type` must be one of ours. Object.hasOwn (not `type in SCHEMAS`) so that a
  //    sneaky type like "constructor" or "__proto__" can't match a built-in property.
  const { type } = raw;
  if (typeof type !== 'string' || !Object.hasOwn(SCHEMAS, type)) {
    return { ok: false, code: 'UNKNOWN_TYPE' };
  }

  // 5. Read each expected field. Build a brand-new object so unexpected fields are dropped.
  const msg = { type };
  for (const [field, read] of Object.entries(SCHEMAS[type])) {
    const value = read(raw[field]);
    if (value === INVALID) return { ok: false, code: 'INVALID_FIELDS', requestType: type, field };
    if (value !== undefined) msg[field] = value;
  }
  return { ok: true, msg };
}
