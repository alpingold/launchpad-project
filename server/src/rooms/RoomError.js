/**
 * Thrown by RoomManager when a request can't be done (room not found, name taken, ...).
 *
 * This is an *expected* failure: the router catches it and sends the client an `error`
 * message with this code. Any other kind of exception is a bug in our code, and the
 * transport turns it into INTERNAL_ERROR instead.
 */
export class RoomError extends Error {
  /** @param {keyof typeof import('../protocol/errors.js').ERRORS} code */
  constructor(code) {
    super(code);
    this.name = 'RoomError';
    this.code = code;
  }
}
