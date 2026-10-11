import { WebSocket } from 'ws';

/**
 * Opens a real WebSocket client for tests, with a promise-based way to read messages
 * in order: `await client.next()` resolves with the next JSON message from the server.
 *
 * @param {string} url
 * @param {import('ws').ClientOptions} [options]  e.g. { autoPong: false } to fake a dead phone
 */
export async function openClient(url, options) {
  const ws = new WebSocket(url, options);
  const queue = []; // messages that arrived before anyone asked for them
  const waiters = []; // next() calls waiting for a message

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });

  /** Resolves with { code, reason } when the socket closes. */
  const closed = new Promise((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  return {
    ws,
    closed,
    send: (value) => ws.send(typeof value === 'string' ? value : JSON.stringify(value)),
    next: () => (queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))),
    close: () => ws.close(),
  };
}
