import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/router.js';
import { RoomManager } from '../../src/rooms/RoomManager.js';
import { RoomError } from '../../src/rooms/RoomError.js';
import { makeError } from '../../src/protocol/errors.js';

/** A stand-in for transport/connection.js that records what it was sent. */
function fakeConn(id, outbox) {
  return {
    id,
    send: (msg) => outbox.push(msg),
    sendError: (code, details) => outbox.push(makeError(code, details)),
  };
}

function setup() {
  const outbox = [];
  const rooms = new RoomManager({ send: (_id, msg) => outbox.push(msg) });
  const router = createRouter(rooms);
  return { rooms, router, outbox, conn: fakeConn('c1', outbox) };
}

test('host:create_room from an outsider creates a room', () => {
  const { rooms, router, outbox, conn } = setup();
  router.handleMessage(conn, { type: 'host:create_room' });
  assert.equal(outbox[0].type, 'room:created');
  assert.equal(rooms.getMembership('c1').role, 'host');
});

test('host:create_room from someone already in a room is refused by the router', () => {
  const { router, outbox, conn } = setup();
  router.handleMessage(conn, { type: 'host:create_room' });
  outbox.length = 0;
  router.handleMessage(conn, { type: 'host:create_room' });
  assert.deepEqual(outbox, [makeError('ALREADY_IN_ROOM', { requestType: 'host:create_room' })]);
});

test('valid but not-yet-built message types get NOT_SUPPORTED', () => {
  const { router, outbox, conn } = setup();
  router.handleMessage(conn, { type: 'game:action', action: {} });
  assert.deepEqual(outbox, [makeError('NOT_SUPPORTED', { requestType: 'game:action' })]);
});

test('RoomError from RoomManager becomes an error reply', () => {
  const { rooms, router, outbox, conn } = setup();
  rooms.createRoom = () => {
    throw new RoomError('SERVER_FULL');
  };
  router.handleMessage(conn, { type: 'host:create_room' });
  assert.deepEqual(outbox, [makeError('SERVER_FULL', { requestType: 'host:create_room' })]);
});

test('other exceptions are bugs and are rethrown (the transport turns them into INTERNAL_ERROR)', () => {
  const { rooms, router, conn } = setup();
  rooms.createRoom = () => {
    throw new TypeError('oops');
  };
  assert.throws(() => router.handleMessage(conn, { type: 'host:create_room' }), TypeError);
});

test('handleDisconnect forwards to RoomManager', () => {
  const { rooms, router, conn } = setup();
  router.handleMessage(conn, { type: 'host:create_room' });
  router.handleDisconnect(conn);
  assert.equal(rooms.getMembership('c1'), undefined);
  assert.equal([...rooms.rooms.values()][0].host.connId, null, 'room kept, host marked disconnected');
  rooms.dispose(); // cancel the host grace timer so the test process can exit
});

test('who-may-send checks for the M4 message types', () => {
  const outbox = [];
  const rooms = new RoomManager({ send: () => {} });
  const router = createRouter(rooms);
  const host = fakeConn('h', []);
  const player = fakeConn('p', outbox);
  const outsider = fakeConn('o', outbox);
  router.handleMessage(host, { type: 'host:create_room' });
  const { code } = [...rooms.rooms.values()][0];
  router.handleMessage(player, { type: 'player:join', code, name: 'Alex' });
  const { playerId } = rooms.getMembership('p');

  router.handleMessage(player, { type: 'host:kick', playerId });
  router.handleMessage(outsider, { type: 'room:leave' });
  router.handleMessage(outsider, { type: 'host:kick', playerId });
  router.handleMessage(player, { type: 'player:resume', code, token: 'abcdefghijklmnopqrstuv' });
  assert.deepEqual(
    outbox.map((m) => [m.code, m.requestType]),
    [
      ['NOT_HOST', 'host:kick'],
      ['NOT_IN_ROOM', 'room:leave'],
      ['NOT_IN_ROOM', 'host:kick'],
      ['ALREADY_IN_ROOM', 'player:resume'],
    ],
  );
  rooms.dispose();
});
