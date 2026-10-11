import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../src/rooms/RoomManager.js';
import { RoomError } from '../../src/rooms/RoomError.js';

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

test('host disconnect closes the room and frees the code (temporary M2 behavior)', () => {
  const { rooms, inbox } = setup();
  const room = rooms.createRoom('c1');
  rooms.handleDisconnect('c1');

  assert.equal(rooms.getRoom(room.code), undefined);
  assert.equal(rooms.getMembership('c1'), undefined);
  assert.equal(room.phase, 'closed');
  // The host's socket is already gone, so nobody is sent room:closed.
  assert.deepEqual(inbox('c1').map((m) => m.type), ['room:created', 'room:state']);
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

test('player disconnect removes them and updates everyone (temporary M3 behavior)', () => {
  const { rooms, inbox, code } = withRoom();
  rooms.joinRoom('c1', code, 'Alex');
  rooms.joinRoom('c2', code, 'Blake');
  rooms.handleDisconnect('c1');

  assert.equal(rooms.getMembership('c1'), undefined);
  const hostLatest = inbox('host').at(-1);
  assert.deepEqual(hostLatest.players.map((p) => p.name), ['Blake']);
  assert.deepEqual(inbox('c2').at(-1), hostLatest);
  // The name is free again.
  assert.doesNotThrow(() => rooms.joinRoom('c3', code, 'Alex'));
});

test('host disconnect sends room:closed to players and frees them to join elsewhere', () => {
  const { rooms, inbox, code } = withRoom();
  rooms.joinRoom('c1', code, 'Alex');
  rooms.handleDisconnect('host');

  assert.deepEqual(inbox('c1').at(-1), { type: 'room:closed', reason: 'host_left' });
  assert.equal(rooms.getMembership('c1'), undefined);
  const other = rooms.createRoom('host2').code;
  assert.doesNotThrow(() => rooms.joinRoom('c1', other, 'Alex'));
});
