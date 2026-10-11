import { SERVER } from './messageTypes.js';

// Every error code the server can send, with the human-readable text the client may show.
// Clients should branch on `code` (stable), never on `message` (wording may change).
export const ERRORS = Object.freeze({
  // Transport / validation (M1)
  BAD_MESSAGE: 'Message must be a JSON object sent as text.',
  UNKNOWN_TYPE: 'Unknown message type.',
  INVALID_FIELDS: 'A field in the message is missing or invalid.',
  RATE_LIMITED: 'Too many messages. Slow down.',
  INTERNAL_ERROR: 'Something went wrong on the server.',

  // Rooms (M2–M4)
  ALREADY_IN_ROOM: 'You are already in a room.',
  NOT_IN_ROOM: 'You are not in a room.',
  NOT_HOST: 'Only the host can do that.',
  SERVER_FULL: 'The server has too many rooms right now. Try again later.',
  ROOM_NOT_FOUND: 'No room with that code.',
  INVALID_TOKEN: 'That host session is not valid.',
  SESSION_EXPIRED: 'Your spot in the room has expired. Please join again.',
  NAME_INVALID: 'Names must be 1–16 characters.',
  NAME_TAKEN: 'Someone in this room already has that name.',
  ROOM_FULL: 'This room is full.',
  PLAYER_NOT_FOUND: 'That player is not in the room.',

  // Games (M5)
  GAME_IN_PROGRESS: 'A game is already in progress.',
  GAME_NOT_FOUND: 'That game does not exist.',
  WRONG_PLAYER_COUNT: 'This game needs a different number of players.',
  WRONG_PHASE: 'You cannot do that right now.',

  // Accounts (M7)
  NOT_AUTHENTICATED: 'You must be logged in to host a room.',
});

/**
 * Builds an `error` message to send to a client.
 * @param {keyof typeof ERRORS} code
 * @param {{ requestType?: string, field?: string }} [details]
 *   requestType: the type of the message that failed, so the client knows which request it was.
 *   field: which field failed validation (helps while developing; never contains user input).
 */
export function makeError(code, { requestType, field } = {}) {
  const msg = { type: SERVER.ERROR, code, message: ERRORS[code] ?? ERRORS.INTERNAL_ERROR };
  if (requestType) msg.requestType = requestType;
  if (field) msg.field = field;
  return msg;
}
