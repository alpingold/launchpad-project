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
