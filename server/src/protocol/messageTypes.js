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
  HOST_STOP_GAME: 'host:stop_game',
  // Frame games (plan §13f): the server only passes these along.
  GAME_EVENT: 'game:event', // phone → big screen
  // big screen → phones, in one message per batch (F1): one-off messages and states (what to
  // show now, kept for reconnects), plus an optional save of the game for a reload
  GAME_BATCH: 'game:batch',
  GAME_END: 'game:end', // big screen: the game is over, with results
  GAME_ALIVE: 'game:alive', // big screen: its game is still answering (the hang watchdog, F1)
});

/** Messages the server sends to browsers. */
export const SERVER = Object.freeze({
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ROOM_STATE: 'room:state',
  ROOM_CLOSED: 'room:closed',
  ERROR: 'error',
  GAME_STARTED: 'game:started', // everyone: which game, its file, the players
  GAME_EVENT: 'game:event', // to the big screen: { from, data } from a phone
  GAME_MESSAGE: 'game:message', // to a phone: { data } from the big screen
  GAME_STATE: 'game:state', // to a phone: { state } from the big screen
  GAME_ENDED: 'game:ended',
});
