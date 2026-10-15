import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../src/rooms/RoomManager.js';
import { RoomError } from '../../src/rooms/RoomError.js';
import { GameRegistry } from '../../src/games/registry.js';
import { config } from '../../src/config.js';
import { tapGame, TAP_SOURCE } from '../helpers/frameGames.js';

/**
 * A RoomManager whose `send` just records messages, so tests can check
 * exactly who was told what. No sockets, no network.
 */
function setup(options = {}) {
  const sent = []; // [{ to, msg }]
  const rooms = new RoomManager({ send: (to, msg) => sent.push({ to, msg }), ...options });
  /** All messages sent to one connection, in order. */
  const inbox = (connId) => sent.filter((s) => s.to === connId).map((s) => s.msg);
  return { rooms, sent, inbox };
}

test('createRoom: host gets room:created (with token) then room:state', () => {
  const { rooms, inbox } = setup();
  const room = rooms.createRoom('c1');

  const [created, state] = inbox('c1');
  assert.equal(created.type, 'room:created');
  assert.equal(created.code, room.code);
  assert.match(created.hostToken, /^[A-Za-z0-9_-]{22}$/);

  assert.deepEqual(state, {
    type: 'room:state',
    code: room.code,
    phase: 'lobby',
    hostConnected: true,
    maxPlayers: 12,
    players: [],
    gameId: null,
  });
});

test('createRoom: records the connection as the host', () => {
  const { rooms } = setup();
  const room = rooms.createRoom('c1');
  assert.deepEqual(rooms.getMembership('c1'), { code: room.code, role: 'host', playerId: null });
  assert.equal(rooms.getRoom(room.code), room);
});

test('room:state never contains the host token', () => {
  const { rooms, sent } = setup();
  const room = rooms.createRoom('c1');
  const states = sent.filter((s) => s.msg.type === 'room:state');
  assert.ok(states.length > 0);
  for (const { msg } of states) {
    assert.ok(!JSON.stringify(msg).includes(room.host.token), 'token leaked into room:state');
  }
});

test('createRoom: different hosts get different codes', () => {
  const { rooms } = setup();
  const codes = new Set();
  for (let i = 0; i < 200; i++) codes.add(rooms.createRoom(`c${i}`).code);
  assert.equal(codes.size, 200);
});

test('createRoom: a connection already in a room cannot create another', () => {
  const { rooms } = setup();
  rooms.createRoom('c1');
  assert.throws(() => rooms.createRoom('c1'), (err) => err instanceof RoomError && err.code === 'ALREADY_IN_ROOM');
  assert.equal(rooms.rooms.size, 1);
});

test('createRoom: SERVER_FULL at the room cap', () => {
  const { rooms } = setup({ maxRooms: 2 });
  rooms.createRoom('c1');
  rooms.createRoom('c2');
  assert.throws(() => rooms.createRoom('c3'), (err) => err.code === 'SERVER_FULL');
});

test('disconnect of a connection that never joined is a harmless no-op', () => {
  const { rooms, sent } = setup();
  rooms.handleDisconnect('c-unknown');
  assert.equal(sent.length, 0);
});

test('closeRoom tells connected members why and frees them to create again', () => {
  const { rooms, inbox } = setup();
  const room = rooms.createRoom('c1');
  rooms.closeRoom(room, 'idle');

  assert.deepEqual(inbox('c1').at(-1), { type: 'room:closed', reason: 'idle' });
  assert.equal(rooms.getMembership('c1'), undefined);
  // Same connection can now start a new room.
  assert.doesNotThrow(() => rooms.createRoom('c1'));
});

// --- Joining (M3) ---------------------------------------------------------------

/** Creates a room hosted by 'host' and returns its code. */
function withRoom(options) {
  const ctx = setup(options);
  ctx.code = ctx.rooms.createRoom('host').code;
  ctx.sent.length = 0; // ignore the create messages
  return ctx;
}

const isRoomError = (code) => (err) => err instanceof RoomError && err.code === code;

test('joinRoom: player gets room:joined with a secret token; everyone gets the new list', () => {
  const { rooms, inbox, code } = withRoom();
  const player = rooms.joinRoom('c1', code, '  Alex ');

  const [joined, playerState] = inbox('c1');
  assert.deepEqual(joined, { type: 'room:joined', code, playerId: player.id, token: player.token, name: 'Alex' });
  assert.match(player.id, /^p_[a-f0-9]{8}$/);
  assert.match(player.token, /^[A-Za-z0-9_-]{22}$/);

  const [hostState] = inbox('host');
  assert.deepEqual(hostState, playerState, 'host and player see the same state');
  assert.deepEqual(hostState.players, [{ id: player.id, name: 'Alex', connected: true }]);
  assert.deepEqual(rooms.getMembership('c1'), { code, role: 'player', playerId: player.id });
});

test('joinRoom: player tokens never appear in room:state', () => {
  const { rooms, sent, code } = withRoom();
  const a = rooms.joinRoom('c1', code, 'Alex');
  const b = rooms.joinRoom('c2', code, 'Blake');
  for (const { msg } of sent.filter((s) => s.msg.type === 'room:state')) {
    const text = JSON.stringify(msg);
    assert.ok(!text.includes(a.token) && !text.includes(b.token), 'token leaked');
  }
});

test('joinRoom: player list keeps join order and every member gets each update', () => {
  const { rooms, inbox, code } = withRoom();
  rooms.joinRoom('c1', code, 'Alex');
  rooms.joinRoom('c2', code, 'Blake');
  rooms.joinRoom('c3', code, 'Casey');

  const latest = (id) => inbox(id).filter((m) => m.type === 'room:state').at(-1);
  for (const id of ['host', 'c1', 'c2', 'c3']) {
    assert.deepEqual(latest(id).players.map((p) => p.name), ['Alex', 'Blake', 'Casey'], id);
  }
});

test('joinRoom: unknown code → ROOM_NOT_FOUND', () => {
  const { rooms } = withRoom();
  assert.throws(() => rooms.joinRoom('c1', 'ZZZZ', 'Alex'), isRoomError('ROOM_NOT_FOUND'));
});

test('joinRoom: duplicate names are refused regardless of case and spacing', () => {
  const { rooms, code } = withRoom();
  rooms.joinRoom('c1', code, 'Alex');
  for (const name of ['Alex', 'alex', 'ALEX', '  aLeX  ']) {
    assert.throws(() => rooms.joinRoom('c2', code, name), isRoomError('NAME_TAKEN'), name);
  }
  assert.equal(rooms.getMembership('c2'), undefined, 'refused player is not a member');
});

test('joinRoom: invalid names → NAME_INVALID', () => {
  const { rooms, code } = withRoom();
  for (const name of ['', '   ', 'x'.repeat(17), 'Al\u200Bex']) {
    assert.throws(() => rooms.joinRoom('c1', code, name), isRoomError('NAME_INVALID'), JSON.stringify(name));
  }
});

test('joinRoom: 13th player → ROOM_FULL (cap is 12)', () => {
  const { rooms, code } = withRoom();
  for (let i = 1; i <= 12; i++) rooms.joinRoom(`c${i}`, code, `Player ${i}`);
  assert.throws(() => rooms.joinRoom('c13', code, 'Late'), isRoomError('ROOM_FULL'));
  assert.equal(rooms.getRoom(code).players.size, 12);
});

test('joinRoom: refused while a game is running → GAME_IN_PROGRESS', () => {
  const { rooms, code } = withRoom();
  rooms.getRoom(code).phase = 'in_game'; // M5 sets this for real
  assert.throws(() => rooms.joinRoom('c1', code, 'Alex'), isRoomError('GAME_IN_PROGRESS'));
});

test('joinRoom: a host cannot also join as a player', () => {
  const { rooms, code } = withRoom();
  assert.throws(() => rooms.joinRoom('host', code, 'Sneaky'), isRoomError('ALREADY_IN_ROOM'));
});


// --- Disconnect, grace periods, resume, leave, kick (M4) -------------------------
// These use node:test's mock timers: t.mock.timers.tick(30_000) runs 30 seconds of
// timers instantly, so the grace periods can be tested without waiting.

/** Room with a host ('host') and players Alex ('c1') and Blake ('c2'), with mocked time. */
function lobby(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const ctx = withRoom();
  ctx.alex = ctx.rooms.joinRoom('c1', ctx.code, 'Alex');
  ctx.blake = ctx.rooms.joinRoom('c2', ctx.code, 'Blake');
  ctx.room = ctx.rooms.getRoom(ctx.code);
  ctx.hostToken = ctx.room.host.token;
  ctx.sent.length = 0;
  ctx.tick = (ms) => t.mock.timers.tick(ms);
  return ctx;
}

test('host disconnect: players see hostConnected false; room closes after exactly 30 s', (t) => {
  const { rooms, inbox, code, tick } = lobby(t);
  rooms.handleDisconnect('host');
  assert.equal(inbox('c1').at(-1).hostConnected, false);

  tick(29_999);
  assert.ok(rooms.getRoom(code), 'still open just before the deadline');
  tick(1);
  assert.equal(rooms.getRoom(code), undefined);
  assert.deepEqual(inbox('c1').at(-1), { type: 'room:closed', reason: 'host_timeout' });
  assert.deepEqual(inbox('c2').at(-1), { type: 'room:closed', reason: 'host_timeout' });
  assert.equal(rooms.members.size, 0, 'every membership freed');
});

test('host resume within the grace period keeps the room and code', (t) => {
  const { rooms, inbox, code, hostToken, tick } = lobby(t);
  rooms.handleDisconnect('host');
  tick(10_000);
  rooms.resumeHost('host2', code, hostToken);

  assert.deepEqual(inbox('host2')[0], { type: 'room:created', code, hostToken });
  assert.equal(inbox('c1').at(-1).hostConnected, true);
  assert.deepEqual(rooms.getMembership('host2'), { code, role: 'host', playerId: null });

  tick(60_000); // the old timer must be cancelled
  assert.ok(rooms.getRoom(code));
});

test('host resume: wrong token → INVALID_TOKEN, wrong code → ROOM_NOT_FOUND', (t) => {
  const { rooms, code } = lobby(t);
  rooms.handleDisconnect('host');
  assert.throws(() => rooms.resumeHost('x', code, 'A'.repeat(22)), isRoomError('INVALID_TOKEN'));
  assert.throws(() => rooms.resumeHost('x', 'ZZZZ', 'A'.repeat(22)), isRoomError('ROOM_NOT_FOUND'));
  assert.equal(rooms.getMembership('x'), undefined);
});

test('host opening a second tab takes over; the old tab is told "replaced"', (t) => {
  const { rooms, inbox, code, hostToken } = lobby(t);
  rooms.resumeHost('host-tab2', code, hostToken); // original 'host' is still connected

  assert.deepEqual(inbox('host').at(-1), { type: 'room:closed', reason: 'replaced' });
  assert.equal(rooms.getMembership('host'), undefined);
  assert.equal(rooms.getRoom(code).host.connId, 'host-tab2');
  // When the old tab's socket finally closes, nothing happens to the room.
  rooms.handleDisconnect('host');
  assert.equal(rooms.getRoom(code).host.connId, 'host-tab2');
});

test('player disconnect: spot shown as disconnected, kept 30 s, then removed', (t) => {
  const { rooms, inbox, code, alex, blake, tick } = lobby(t);
  rooms.handleDisconnect('c1');
  assert.deepEqual(inbox('host').at(-1).players, [
    { id: alex.id, name: 'Alex', connected: false },
    { id: blake.id, name: 'Blake', connected: true },
  ]);

  tick(29_999);
  assert.ok(rooms.getRoom(code).players.has(alex.id));
  tick(1);
  assert.equal(rooms.getRoom(code).players.has(alex.id), false);
  assert.deepEqual(inbox('host').at(-1).players.map((p) => p.name), ['Blake']);
  assert.throws(() => rooms.resumePlayer('c1b', code, alex.token), isRoomError('SESSION_EXPIRED'));
});

test('player resume within the grace period: same id and name, connected again', (t) => {
  const { rooms, inbox, code, alex, tick } = lobby(t);
  rooms.handleDisconnect('c1');
  tick(20_000);
  rooms.resumePlayer('c1b', code, alex.token);

  assert.deepEqual(inbox('c1b')[0], { type: 'room:joined', code, playerId: alex.id, token: alex.token, name: 'Alex' });
  assert.deepEqual(rooms.getMembership('c1b'), { code, role: 'player', playerId: alex.id });
  assert.equal(inbox('host').at(-1).players[0].connected, true);

  tick(60_000); // old timer cancelled: still here
  assert.ok(rooms.getRoom(code).players.has(alex.id));
});

test('a disconnected player still holds their name and slot during the grace period', (t) => {
  const { rooms, code, tick } = lobby(t);
  rooms.handleDisconnect('c1');
  assert.throws(() => rooms.joinRoom('x', code, 'alex'), isRoomError('NAME_TAKEN'));

  for (let i = 3; i <= 12; i++) rooms.joinRoom(`c${i}`, code, `P${i}`); // 2 + 10 = 12 spots
  assert.throws(() => rooms.joinRoom('x', code, 'Late'), isRoomError('ROOM_FULL'));
  tick(30_000); // Alex's spot expires
  assert.doesNotThrow(() => rooms.joinRoom('x', code, 'Late'));
});

test('player resume with an unknown token → SESSION_EXPIRED', (t) => {
  const { rooms, code } = lobby(t);
  assert.throws(() => rooms.resumePlayer('x', code, 'A'.repeat(22)), isRoomError('SESSION_EXPIRED'));
});

test('player opening a second tab takes over; the old tab is told "replaced"', (t) => {
  const { rooms, inbox, code, alex } = lobby(t);
  rooms.resumePlayer('c1-tab2', code, alex.token);
  assert.deepEqual(inbox('c1').at(-1), { type: 'room:closed', reason: 'replaced' });
  assert.equal(rooms.getRoom(code).players.get(alex.id).connId, 'c1-tab2');
  rooms.handleDisconnect('c1'); // old socket closing later changes nothing
  assert.equal(rooms.getRoom(code).players.get(alex.id).connected, true);
});

test('during a game, a disconnected player keeps their spot with no timer', (t) => {
  const { rooms, code, alex, tick } = lobby(t);
  rooms.getRoom(code).phase = 'in_game'; // M5 sets this for real
  rooms.handleDisconnect('c1');
  tick(10 * 60_000);
  assert.ok(rooms.getRoom(code).players.has(alex.id));
  // ...and can resume even though new players can't join mid-game.
  assert.doesNotThrow(() => rooms.resumePlayer('c1b', code, alex.token));
});

test('player leave: removed immediately, told "left", name free at once', (t) => {
  const { rooms, inbox, code } = lobby(t);
  rooms.leaveRoom('c1');
  assert.deepEqual(inbox('c1').at(-1), { type: 'room:closed', reason: 'left' });
  assert.equal(rooms.getMembership('c1'), undefined);
  assert.deepEqual(inbox('host').at(-1).players.map((p) => p.name), ['Blake']);
  assert.doesNotThrow(() => rooms.joinRoom('x', code, 'Alex'));
});

test('host leave ("End room"): closes at once for everyone', (t) => {
  const { rooms, inbox, code } = lobby(t);
  rooms.leaveRoom('host');
  assert.equal(rooms.getRoom(code), undefined);
  for (const id of ['host', 'c1', 'c2']) {
    assert.deepEqual(inbox(id).at(-1), { type: 'room:closed', reason: 'host_left' }, id);
  }
  assert.equal(rooms.members.size, 0);
});

test('kick: player is told, removed, and their token stops working', (t) => {
  const { rooms, inbox, code, alex } = lobby(t);
  rooms.kickPlayer('host', alex.id);
  assert.deepEqual(inbox('c1').at(-1), { type: 'room:closed', reason: 'kicked' });
  assert.deepEqual(inbox('host').at(-1).players.map((p) => p.name), ['Blake']);
  assert.throws(() => rooms.resumePlayer('c1b', code, alex.token), isRoomError('SESSION_EXPIRED'));
});

test('kick: a disconnected player can be kicked (their grace timer is cancelled)', (t) => {
  const { rooms, sent, alex, tick } = lobby(t);
  rooms.handleDisconnect('c1');
  rooms.kickPlayer('host', alex.id);
  const before = sent.length;
  tick(60_000);
  assert.equal(sent.length, before, 'cancelled timer sent nothing later');
});

test('kick: unknown player → PLAYER_NOT_FOUND; non-host → NOT_HOST', (t) => {
  const { rooms, blake } = lobby(t);
  assert.throws(() => rooms.kickPlayer('host', 'p_00000000'), isRoomError('PLAYER_NOT_FOUND'));
  assert.throws(() => rooms.kickPlayer('c1', blake.id), isRoomError('NOT_HOST'));
});

test('closing a room cancels every pending timer (no stray messages later)', (t) => {
  const { rooms, sent, room, tick } = lobby(t);
  rooms.handleDisconnect('c1'); // player timer running
  rooms.handleDisconnect('host'); // host timer running
  rooms.closeRoom(room, 'idle');
  const before = sent.length;
  tick(10 * 60_000);
  assert.equal(sent.length, before);
});

test('sweeper closes rooms idle for 2 hours; any activity resets the clock', (t) => {
  const { rooms, inbox, code, tick } = lobby(t);
  tick(2 * 60 * 60_000 - 1000);
  assert.equal(rooms.sweepIdleRooms(), 0);
  rooms.joinRoom('c3', code, 'Casey'); // activity
  tick(60 * 60_000);
  assert.equal(rooms.sweepIdleRooms(), 0, 'only 1 h since the last join');
  tick(60 * 60_000 + 1);
  assert.equal(rooms.sweepIdleRooms(), 1);
  assert.deepEqual(inbox('c1').at(-1), { type: 'room:closed', reason: 'idle' });
  assert.equal(rooms.getRoom(code), undefined);
});

// --- Frame games in rooms (plan §13f) -------------------------------------------------------

/** A lobby (host + Alex + Blake) on a server that offers the tap test game. */
function gameLobby(t, extraGames = []) {
  const games = new GameRegistry();
  for (const g of [tapGame(), ...extraGames]) games.register(g);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const ctx = setup({ games });
  ctx.code = ctx.rooms.createRoom('host').code;
  ctx.alex = ctx.rooms.joinRoom('c1', ctx.code, 'Alex');
  ctx.blake = ctx.rooms.joinRoom('c2', ctx.code, 'Blake');
  ctx.room = ctx.rooms.getRoom(ctx.code);
  ctx.sent.length = 0;
  ctx.tick = (ms) => t.mock.timers.tick(ms);
  ctx.ofType = (connId, type) => ctx.inbox(connId).filter((m) => m.type === type);
  return ctx;
}

test('startGame: everyone gets game:started with the game file, then the in_game state', (t) => {
  const { rooms, inbox, room, alex, blake } = gameLobby(t);
  rooms.startGame('host', 'tap-test');

  assert.equal(room.phase, 'in_game');
  for (const id of ['host', 'c1', 'c2']) {
    assert.deepEqual(inbox(id).map((m) => m.type), ['game:started', 'room:state'], id);
    const started = inbox(id)[0];
    assert.equal(started.gameId, 'tap-test');
    assert.equal(started.source, TAP_SOURCE, 'the whole file, for the iframe');
    assert.deepEqual(started.players, [{ id: alex.id, name: 'Alex' }, { id: blake.id, name: 'Blake' }]);
    assert.equal(started.resumed, false);
    assert.match(started.runId, /^[a-z0-9]+$/);
    assert.equal(typeof started.serverNow, 'number');
    assert.equal(inbox(id)[1].gameId, 'tap-test');
  }
});

test('startGame errors: unknown game, wrong player count, already running, not the host', (t) => {
  const { rooms } = gameLobby(t, [tapGame('needs-three', { minPlayers: 3 })]);
  assert.throws(() => rooms.startGame('host', 'nope'), isRoomError('GAME_NOT_FOUND'));
  assert.throws(() => rooms.startGame('host', 'needs-three'), isRoomError('WRONG_PLAYER_COUNT'));
  rooms.startGame('host', 'tap-test');
  assert.throws(() => rooms.startGame('host', 'tap-test'), isRoomError('WRONG_PHASE'));
  assert.throws(() => rooms.startGame('c1', 'tap-test'), isRoomError('NOT_HOST'));
});

test('a phone event goes to the big screen only, with who sent it', (t) => {
  const { rooms, inbox, alex } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  rooms.handleGameEvent('c1', { jump: true });
  const event = inbox('host').at(-1);
  assert.equal(event.type, 'game:event');
  assert.equal(event.from, alex.id);
  assert.deepEqual(event.data, { jump: true });
  assert.equal(typeof event.serverNow, 'number');
  assert.equal(inbox('c2').filter((m) => m.type === 'game:event').length, 0, 'phones never see each other');
});

test('the big screen messages one phone or all of them; state is kept and replayed on reconnect', (t) => {
  const { rooms, ofType, code, alex, blake } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  rooms.handleHostGameSend('host', 'all', 'ready?');
  rooms.handleHostGameSend('host', blake.id, { hit: true });
  rooms.handleHostGameState('host', alex.id, { color: 'red', taps: 1 });

  assert.deepEqual(ofType('c1', 'game:message').map((m) => m.data), ['ready?']);
  assert.deepEqual(ofType('c2', 'game:message').map((m) => m.data), ['ready?', { hit: true }]);
  assert.deepEqual(ofType('c1', 'game:state').map((m) => m.state), [{ color: 'red', taps: 1 }]);
  assert.deepEqual(ofType('c2', 'game:state'), []);

  // Alex's phone reloads: it gets the game again (resumed), then its latest state.
  rooms.handleDisconnect('c1');
  rooms.handleHostGameState('host', alex.id, { color: 'red', taps: 2 }); // missed while away
  rooms.resumePlayer('c1b', code, alex.token);
  const back = ofType('c1b', 'game:started')[0];
  assert.equal(back.resumed, true);
  assert.equal(back.source, TAP_SOURCE);
  assert.deepEqual(ofType('c1b', 'game:state').map((m) => m.state), [{ color: 'red', taps: 2 }]);
});

test('big-screen messages to someone not in the game are refused', (t) => {
  const { rooms } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  assert.throws(() => rooms.handleHostGameSend('host', 'p_nobody', 1), isRoomError('PLAYER_NOT_FOUND'));
  assert.throws(() => rooms.handleHostGameState('host', 'p_nobody', 1), isRoomError('PLAYER_NOT_FOUND'));
});

test('who may send what: phones send events, only the host sends to phones, all only during a game', (t) => {
  const { rooms, alex } = gameLobby(t);
  assert.throws(() => rooms.handleGameEvent('c1', 1), isRoomError('WRONG_PHASE'), 'no game yet');
  assert.throws(() => rooms.handleHostGameSend('host', 'all', 1), isRoomError('WRONG_PHASE'));
  assert.throws(() => rooms.stopGameByHost('host'), isRoomError('WRONG_PHASE'));
  rooms.startGame('host', 'tap-test');
  assert.throws(() => rooms.handleGameEvent('host', 1), isRoomError('WRONG_PHASE'), 'the host is not a phone');
  assert.throws(() => rooms.handleHostGameSend('c1', 'all', 1), isRoomError('NOT_HOST'));
  assert.throws(() => rooms.handleHostGameState('c1', alex.id, 1), isRoomError('NOT_HOST'));
  assert.throws(() => rooms.handleHostGameEnd('c1', { rankings: [] }), isRoomError('NOT_HOST'));
  assert.throws(() => rooms.stopGameByHost('c1'), isRoomError('NOT_HOST'));
});

test('a phone event over the size limit is refused', (t) => {
  const { rooms, inbox } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  const before = inbox('host').length;
  assert.throws(() => rooms.handleGameEvent('c1', 'x'.repeat(config.GAME_EVENT_MAX_BYTES)), isRoomError('GAME_DATA_TOO_BIG'));
  assert.equal(inbox('host').length, before);
});

test('game:end: checked results end the game and the room returns to the lobby', (t) => {
  const { rooms, room, alex, blake, ofType } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  const results = { rankings: [blake.id, alex.id], scores: { [alex.id]: 1, [blake.id]: 3 } };
  rooms.handleHostGameEnd('host', results);

  assert.equal(room.phase, 'lobby');
  assert.equal(room.game, null);
  for (const id of ['host', 'c1', 'c2']) {
    assert.deepEqual(ofType(id, 'game:ended'), [{ type: 'game:ended', results }], id);
    assert.equal(ofType(id, 'room:state').at(-1).phase, 'lobby');
  }
  assert.doesNotThrow(() => rooms.startGame('host', 'tap-test'), 'can play again');
});

test('game:end with bad results is refused and the game keeps going', (t) => {
  const { rooms, room, alex } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  for (const bad of [
    { rankings: ['p_nobody'] },
    { rankings: [alex.id, alex.id] },
    { rankings: [alex.id], scores: { p_nobody: 1 } },
    { rankings: [alex.id], scores: { [alex.id]: 'lots' } },
    { rankings: [alex.id], scores: { [alex.id]: Infinity } },
  ]) {
    assert.throws(() => rooms.handleHostGameEnd('host', bad), isRoomError('INVALID_RESULTS'), JSON.stringify(bad));
  }
  assert.equal(room.phase, 'in_game');
});

test('the host can stop a game: it ends with no winner', (t) => {
  const { rooms, room, ofType } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  rooms.stopGameByHost('host');
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(ofType('c1', 'game:ended'), [{ type: 'game:ended', results: { stopped: true } }]);
});

test('nobody can join during a game', (t) => {
  const { rooms, code } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  assert.throws(() => rooms.joinRoom('c9', code, 'Late'), isRoomError('GAME_IN_PROGRESS'));
});

test('the big screen reconnecting mid-game is told the game is running (resumed)', (t) => {
  const { rooms, inbox, code, room } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  const runId = inbox('host')[0].runId;
  rooms.handleDisconnect('host');
  rooms.resumeHost('host2', code, room.host.token);
  const started = inbox('host2').find((m) => m.type === 'game:started');
  assert.equal(started.resumed, true);
  assert.equal(started.runId, runId, 'same game: a page that still runs it carries on');
});

test('every game gets a new runId, so a page can tell a new game from the one it shows', (t) => {
  const { rooms, ofType } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  rooms.stopGameByHost('host');
  rooms.startGame('host', 'tap-test');
  const [first, second] = ofType('c1', 'game:started');
  assert.notEqual(first.runId, second.runId);
});

test('players who drop mid-game keep their spot, then get a grace period once the game ends', (t) => {
  const { rooms, room, alex, blake, tick } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  rooms.handleDisconnect('c1');
  tick(10 * 60_000);
  assert.ok(room.players.has(alex.id), 'kept during the game');

  rooms.handleHostGameEnd('host', { rankings: [blake.id] });
  assert.equal(room.phase, 'lobby');
  tick(29_999);
  assert.ok(room.players.has(alex.id));
  tick(1);
  assert.equal(room.players.has(alex.id), false, 'removed 30 s after the game ended');
});

test('a player in their lobby grace period when the game starts is included and kept', (t) => {
  const { rooms, room, alex, tick } = gameLobby(t);
  rooms.handleDisconnect('c1'); // lobby grace timer starts
  rooms.startGame('host', 'tap-test');
  tick(60_000);
  assert.ok(room.players.has(alex.id), 'grace timer cancelled by the game starting');
});

test('closing the room mid-game forgets the game', (t) => {
  const { rooms, room, sent, tick } = gameLobby(t);
  rooms.startGame('host', 'tap-test');
  rooms.leaveRoom('host'); // End room
  const before = sent.length;
  tick(60_000);
  assert.equal(sent.length, before);
  assert.equal(room.game, null);
});

test('game messages to a disconnected player are dropped, not errors', (t) => {
  const { rooms, inbox, alex } = gameLobby(t);
  rooms.handleDisconnect('c1');
  rooms.startGame('host', 'tap-test');
  assert.doesNotThrow(() => rooms.handleHostGameSend('host', alex.id, 'hi'));
  assert.equal(inbox('c1').length, 0);
});

// --- One room per host account (M7, Q4) ---------------------------------------------------

test('the same account creating a room again gets its existing room back', () => {
  const { rooms, inbox } = setup();
  const first = rooms.createRoom('tab1', { userId: 7 });
  rooms.joinRoom('c1', first.code, 'Alex');
  const again = rooms.createRoom('tab2', { userId: 7 });

  assert.equal(again, first, 'same room, same code');
  assert.equal(rooms.rooms.size, 1);
  assert.deepEqual(inbox('tab1').at(-1), { type: 'room:closed', reason: 'replaced' });
  assert.deepEqual(inbox('tab2')[0], { type: 'room:created', code: first.code, hostToken: first.host.token });
  assert.deepEqual(inbox('tab2')[1].players.map((p) => p.name), ['Alex'], 'players are still there');
});

test('a host who disconnected gets their room back by creating again (grace timer cancelled)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { rooms } = setup();
  const room = rooms.createRoom('tab1', { userId: 7 });
  rooms.handleDisconnect('tab1');
  assert.equal(rooms.createRoom('tab2', { userId: 7 }), room);
  t.mock.timers.tick(60_000);
  assert.ok(rooms.getRoom(room.code), 'not closed by the old host timer');
});

test('different accounts get different rooms', () => {
  const { rooms } = setup();
  assert.notEqual(rooms.createRoom('a', { userId: 1 }).code, rooms.createRoom('b', { userId: 2 }).code);
});

test('after the room closes, the same account gets a brand-new room', () => {
  const { rooms } = setup();
  const first = rooms.createRoom('tab1', { userId: 7 });
  rooms.leaveRoom('tab1'); // End room
  const second = rooms.createRoom('tab1', { userId: 7 });
  assert.notEqual(second, first);
  assert.equal(rooms.roomByHostUser.get(7), second.code);
});

test('dispose: sockets that close afterwards start no new grace timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { rooms, sent } = setup();
  const room = rooms.createRoom('host');
  rooms.joinRoom('c1', room.code, 'Alex');
  rooms.dispose();
  assert.equal(rooms.rooms.size, 0, 'every room is forgotten');
  // On shutdown the transport closes sockets AFTER dispose; their disconnects arrive late.
  const before = sent.length;
  rooms.handleDisconnect('host');
  rooms.handleDisconnect('c1');
  t.mock.timers.tick(60_000);
  assert.equal(sent.length, before, 'nothing happens: no room, no timers');
});
