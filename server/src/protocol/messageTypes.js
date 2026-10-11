// The single list of every message type in the protocol.
// Code everywhere else uses these constants instead of typing the strings,
// so a typo becomes an undefined-variable error instead of a silent bug.

/** Messages a browser may send to the server (requests). */
export const CLIENT = Object.freeze({
  HOST_CREATE_ROOM: 'host:create_room',
  HOST_RESUME: 'host:resume',
  PLAYER_JOIN: 'player:join',
  PLAYER_RESUME: 'player:resume',
  ROOM_LEAVE: 'room:leave',
  HOST_KICK: 'host:kick',
  HOST_START_GAME: 'host:start_game',
  GAME_ACTION: 'game:action',
});

/** Messages the server sends to browsers. */
export const SERVER = Object.freeze({
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ROOM_STATE: 'room:state',
  ROOM_CLOSED: 'room:closed',
  ERROR: 'error',
  GAME_STARTED: 'game:started',
  GAME_MESSAGE: 'game:message',
  GAME_ENDED: 'game:ended',
});
