/**
 * Thin wrapper around the browser WebSocket: connects to /ws on the same host
 * the page came from, and sends/receives JSON objects.
 *
 * M4 adds automatic reconnect + resume here, so pages won't need to change.
 *
 * @param {{ onOpen?: () => void, onMessage: (msg: object) => void, onClose?: () => void }} handlers
 */
export function connectSocket({ onOpen, onMessage, onClose }) {
  // Use wss:// when the page is served over https (production), ws:// otherwise.
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

  // Once the page calls close() itself, stop delivering events. Otherwise a socket
  // the page already abandoned (e.g. React dev mode running an effect twice) could
  // fire onClose later and overwrite the state of the page's newer socket.
  let closedByPage = false;

  ws.addEventListener('open', () => {
    if (!closedByPage) onOpen?.();
  });
  ws.addEventListener('close', () => {
    if (!closedByPage) onClose?.();
  });
  ws.addEventListener('message', (event) => {
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

  return {
    /** Sends a message object; quietly dropped if the socket isn't open. */
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      closedByPage = true;
      ws.close();
    },
  };
}
