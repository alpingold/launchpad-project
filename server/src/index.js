// Entry point: wiring only, no game or room logic lives here.
import http from 'node:http';
import { config } from './config.js';
import { createApp } from './http/app.js';
import { attachWebSocketServer } from './transport/wsServer.js';
import { createRouter } from './router.js';

const app = createApp();

// We create the http.Server ourselves (instead of calling app.listen) because
// the WebSocket server needs a handle to this same server object.
const server = http.createServer(app);

// Express handles normal HTTP requests; `ws` handles WebSocket upgrades on the same port.
const router = createRouter();
const transport = attachWebSocketServer(server, {
  onMessage: (conn, msg) => router.handleMessage(conn, msg),
  onDisconnect: (conn) => router.handleDisconnect(conn),
});

server.listen(config.PORT, () => {
  console.log(`[server] listening on http://localhost:${config.PORT} (WebSocket path ${config.WS_PATH})`);
});

// Shut down cleanly on Ctrl+C or when a process manager (systemd) stops us.
function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  transport.close();
  server.close(() => process.exit(0));
  // If open connections keep the server from closing, don't hang forever.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
