import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../src/rooms/RoomManager.js';
import { RoomError } from '../../src/rooms/RoomError.js';
import { GameRegistry } from '../../src/games/registry.js';
import countGame from '../fixtures/countGame.js';

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

// --- Games in rooms (M5) ----------------------------------------------------------------

/** A lobby (host + Alex + Blake) on a server that offers the test count game. */
function gameLobby(t, extraGames = []) {
  const games = new GameRegistry();
  for (const g of [countGame, ...extraGames]) games.register(g);
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

test('startGame: game:started, then in_game state, then the first views', (t) => {
  const { rooms, inbox, room, alex, blake } = gameLobby(t);
  rooms.startGame('host', 'count-game', {});

  assert.equal(room.phase, 'in_game');
  const types = inbox('c1').map((m) => m.type);
  assert.deepEqual(types, ['game:started', 'room:state', 'game:message']);
  assert.deepEqual(inbox('c1')[0], {
    type: 'game:started',
    gameId: 'count-game',
    players: [{ id: alex.id, name: 'Alex' }, { id: blake.id, name: 'Blake' }],
  });
  assert.equal(inbox('c1')[1].phase, 'in_game');
  assert.equal(inbox('c1')[1].gameId, 'count-game');
  const msg = inbox('c1')[2];
  assert.deepEqual(msg.payload, { view: 'button', label: 'Tap!', action: { tap: true } });
  assert.equal(typeof msg.serverNow, 'number');
  // The host also got its own big-screen view.
  assert.deepEqual(inbox('host').at(-1).payload, { view: 'message', title: 'First to 3 taps wins!' });
  assert.equal(inbox('c1').filter((m) => m.payload?.view === 'message').length, 0, 'host-only view not sent to players');
});

test('startGame errors: unknown game, wrong player count, already running', (t) => {
  const twoPlus = { ...countGame, id: 'needs-three', minPlayers: 3 };
  const { rooms } = gameLobby(t, [twoPlus]);
  assert.throws(() => rooms.startGame('host', 'nope', {}), isRoomError('GAME_NOT_FOUND'));
  assert.throws(() => rooms.startGame('host', 'needs-three', {}), isRoomError('WRONG_PLAYER_COUNT'));
  rooms.startGame('host', 'count-game', {});
  assert.throws(() => rooms.startGame('host', 'count-game', {}), isRoomError('WRONG_PHASE'));
  assert.throws(() => rooms.startGame('c1', 'count-game', {}), isRoomError('NOT_HOST'));
});

test('a full game: actions route through, the game ends, the room returns to the lobby', (t) => {
  const { rooms, room, alex, blake, ofType } = gameLobby(t);
  rooms.startGame('host', 'count-game', { target: 2 });
  rooms.handleGameAction('c2', { tap: true });
  rooms.handleGameAction('c1', { tap: true });
  rooms.handleGameAction('c2', { tap: true });

  assert.equal(room.phase, 'lobby');
  assert.equal(room.game, null);
  for (const id of ['host', 'c1', 'c2']) {
    assert.deepEqual(ofType(id, 'game:ended'), [{ type: 'game:ended', results: { rankings: [blake.id, alex.id] } }], id);
    const last = ofType(id, 'room:state').at(-1);
    assert.equal(last.phase, 'lobby');
    assert.equal(last.gameId, null);
  }
  // Can play again.
  assert.doesNotThrow(() => rooms.startGame('host', 'count-game', {}));
});

test('game:action is refused outside a game and from the host', (t) => {
  const { rooms } = gameLobby(t);
  assert.throws(() => rooms.handleGameAction('c1', { tap: true }), isRoomError('WRONG_PHASE'));
  rooms.startGame('host', 'count-game', {});
  assert.throws(() => rooms.handleGameAction('host', { tap: true }), isRoomError('WRONG_PHASE'));
});

test('nobody can join during a game, but a dropped player can resume and gets their view back', (t) => {
  const { rooms, inbox, code, alex } = gameLobby(t);
  rooms.startGame('host', 'count-game', {});
  assert.throws(() => rooms.joinRoom('c9', code, 'Late'), isRoomError('GAME_IN_PROGRESS'));

  rooms.handleDisconnect('c1');
  rooms.resumePlayer('c1b', code, alex.token);
  const messages = inbox('c1b');
  assert.deepEqual(messages.map((m) => m.type), ['room:joined', 'room:state', 'game:message']);
  assert.deepEqual(messages[2].payload, { view: 'button', label: 'Tap!', action: { tap: true } });
});

test('host refresh during a game gets the big-screen view back', (t) => {
  const { rooms, inbox, code, room } = gameLobby(t);
  rooms.startGame('host', 'count-game', {});
  rooms.handleDisconnect('host');
  rooms.resumeHost('host2', code, room.host.token);
  assert.deepEqual(inbox('host2').at(-1).payload, { view: 'message', title: 'First to 3 taps wins!' });
});

test('players who drop mid-game keep their spot, then get a grace period once the game ends', (t) => {
  const { rooms, room, alex, tick } = gameLobby(t);
  rooms.startGame('host', 'count-game', { target: 1 });
  rooms.handleDisconnect('c1');
  tick(10 * 60_000);
  assert.ok(room.players.has(alex.id), 'kept during the game');

  rooms.handleGameAction('c2', { tap: true }); // Blake wins, game over
  assert.equal(room.phase, 'lobby');
  tick(29_999);
  assert.ok(room.players.has(alex.id));
  tick(1);
  assert.equal(room.players.has(alex.id), false, 'removed 30 s after the game ended');
});

test('a player in their lobby grace period when the game starts is included and kept', (t) => {
  const { rooms, room, alex, tick } = gameLobby(t);
  rooms.handleDisconnect('c1'); // lobby grace timer starts
  rooms.startGame('host', 'count-game', {});
  tick(60_000);
  assert.ok(room.players.has(alex.id), 'grace timer cancelled by the game starting');
});

test('the game hears about disconnects, reconnects, leaves and kicks', (t) => {
  const events = [];
  const spy = {
    ...countGame,
    id: 'spy-game',
    createGame: () => ({
      onAction() {},
      onPlayerDisconnect: (id) => events.push(['disconnect', id]),
      onPlayerReconnect: (id) => events.push(['reconnect', id]),
      onHostReconnect: () => events.push(['host']),
    }),
  };
  const { rooms, code, room, alex, blake } = gameLobby(t, [spy]);
  rooms.startGame('host', 'spy-game', {});
  rooms.handleDisconnect('c1');
  rooms.resumePlayer('c1b', code, alex.token);
  rooms.handleDisconnect('host');
  rooms.resumeHost('host2', code, room.host.token);
  rooms.kickPlayer('host2', blake.id);
  rooms.leaveRoom('c1b');
  assert.deepEqual(events, [
    ['disconnect', alex.id],
    ['reconnect', alex.id],
    ['host'],
    ['disconnect', blake.id],
    ['disconnect', alex.id],
  ]);
});

test('a crashing game ends with { error: true } and the room is fine', (t) => {
  t.mock.method(console, 'error', () => {});
  const broken = { ...countGame, id: 'broken', createGame: () => ({ onAction() { throw new Error('boom'); } }) };
  const { rooms, room, ofType } = gameLobby(t, [broken]);
  rooms.startGame('host', 'broken', {});
  assert.doesNotThrow(() => rooms.handleGameAction('c1', {}));
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(ofType('c2', 'game:ended').at(-1), { type: 'game:ended', results: { error: true } });
});

test('a game that crashes while starting goes straight back to the lobby', (t) => {
  t.mock.method(console, 'error', () => {});
  const broken = { ...countGame, id: 'broken', createGame: () => { throw new Error('boom'); } };
  const { rooms, room, ofType } = gameLobby(t, [broken]);
  rooms.startGame('host', 'broken', {});
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(ofType('c1', 'game:ended').at(-1).results, { error: true });
});

test('closing the room mid-game stops the game and its timers', (t) => {
  const fired = [];
  const timed = {
    ...countGame,
    id: 'timed',
    createGame: (ctx) => {
      ctx.setTimeout(() => fired.push('late'), 5000);
      return { onAction() {} };
    },
  };
  const { rooms, room, sent, tick } = gameLobby(t, [timed]);
  rooms.startGame('host', 'timed', {});
  rooms.leaveRoom('host'); // End room
  const before = sent.length;
  tick(60_000);
  assert.deepEqual(fired, []);
  assert.equal(sent.length, before);
  assert.equal(room.game, null);
});

test('game messages to a disconnected player are dropped, not errors', (t) => {
  const { rooms, inbox } = gameLobby(t);
  rooms.handleDisconnect('c1');
  rooms.startGame('host', 'count-game', {});
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
