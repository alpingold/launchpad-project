// Entry point: starts the server. Wiring lives in server.js; logic lives in the layers.
import { config } from './config.js';
import { createGameServer } from './server.js';
import { openDatabase } from './db/database.js';

const db = openDatabase(config.DB_PATH);
console.log(`[server] database: ${config.DB_PATH}`);
const server = createGameServer({}, { db });

server.httpServer.listen(config.PORT, () => {
  console.log(`[server] listening on http://localhost:${config.PORT} (WebSocket path ${config.WS_PATH})`);
});

// Shut down cleanly on Ctrl+C or when a process manager (systemd) stops us.
function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close().then(() => {
    db.close();
    process.exit(0);
  });
  // If something keeps the server from closing, don't hang forever.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
