const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 5000;

/**
 * WebSocket wrapper that reconnects by itself.
 *
 * Phones drop connections constantly (screen locks, Wi-Fi to mobile data switches).
 * When the socket closes unexpectedly, this waits a moment and connects again, waiting
 * longer after each failure (0.5 s, 1 s, 2 s, 4 s, then every 5 s) so a down server
 * isn't hammered. Each successful (re)connection calls `onOpen`, which is where pages
 * send host:resume / player:resume to get their place back.
 *
 * @param {Object} handlers
 * @param {() => void} [handlers.onOpen]         every time a connection opens (first and reconnects)
 * @param {(msg: object) => void} handlers.onMessage
 * @param {() => void} [handlers.onDisconnect]   every time an open connection is lost
 */
export function connectSocket({ onOpen, onMessage, onDisconnect }) {
  // Use wss:// when the page is served over https (production), ws:// otherwise.
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${window.location.host}/ws`;

  let ws = null;
  let retryDelay = FIRST_RETRY_MS;
  let retryTimer = null;
  // Once the page calls close() itself, stop delivering events and stop reconnecting.
  // Otherwise a socket the page already abandoned (e.g. React dev mode running an
  // effect twice) could fire events later and overwrite the page's newer state.
  let closedByPage = false;

  function connect() {
    retryTimer = null;
    const socket = new WebSocket(url);
    ws = socket;

    socket.addEventListener('open', () => {
      if (closedByPage) return;
      retryDelay = FIRST_RETRY_MS;
      onOpen?.();
    });

    socket.addEventListener('message', (event) => {
      if (closedByPage) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.warn('[socket] ignoring non-JSON message from server');
        return;
      }
      onMessage(msg);
    });

    socket.addEventListener('close', () => {
      if (closedByPage) return;
      onDisconnect?.();
      scheduleRetry();
    });
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
  }

  // Phones pause timers while the screen is off. When the page becomes visible again,
  // reconnect right away instead of waiting out the rest of the backoff.
  function handleVisibility() {
    if (document.visibilityState !== 'visible' || closedByPage) return;
    if (ws.readyState === WebSocket.CLOSED) {
      clearTimeout(retryTimer);
      retryDelay = FIRST_RETRY_MS;
      connect();
    }
  }
  document.addEventListener('visibilitychange', handleVisibility);

  connect();

  return {
    /** Sends a message object; quietly dropped if the socket isn't open right now. */
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    /** Closes for good: no more events, no reconnecting. */
    close() {
      closedByPage = true;
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      ws.close();
    },
  };
}
