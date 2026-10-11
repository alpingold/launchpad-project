// Every tunable number for the server lives here, so limits and timeouts
// can be reviewed (and changed) in one place instead of hunting through files.

export const config = {
  // Port the HTTP + WebSocket server listens on. Override with PORT=4000 npm run dev:server
  PORT: Number(process.env.PORT) || 3000,

  // Largest JSON body Express will accept on /api routes. Small on purpose:
  // our requests are tiny (login forms), and a cap stops huge uploads early.
  HTTP_JSON_LIMIT: '10kb',

  // --- WebSocket transport ---

  // URL path clients connect to (ws://host/ws). Upgrades on any other path are refused.
  WS_PATH: '/ws',

  // Largest single message (in bytes) a client may send. Our biggest real message
  // is a few hundred bytes; `ws` closes the socket with code 1009 if this is exceeded.
  WS_MAX_PAYLOAD_BYTES: 4 * 1024,

  // How often we ping every socket. A socket that hasn't answered the previous
  // ping by the next tick is considered dead and dropped (so worst case ~2x this).
  HEARTBEAT_INTERVAL_MS: 15_000,

  // Invalid messages (bad JSON, unknown type, bad fields) a connection may send
  // before we close it. A few mistakes are normal during development; a stream is abuse.
  MAX_BAD_MESSAGES: 10,

  // Rate limit per connection (token bucket): refills RATE per second, holds up to BURST.
  // A phone tapping as fast as a human can stays far below this.
  RATE_LIMIT_PER_SEC: 20,
  RATE_LIMIT_BURST: 40,

  // Consecutive rate-limited messages before we give up and close the connection.
  MAX_RATE_LIMIT_STRIKES: 20,

  // --- Rooms ---

  // Global player cap for any room. A game may set a lower max when it starts (M5).
  MAX_PLAYERS: 12,

  // Most rooms that can exist at once. Each room is tiny, so this is a safety
  // valve against someone scripting thousands of create_room calls, not a real capacity limit.
  MAX_ROOMS: 1000,

  // Longest raw name string accepted before normalization. The real display-name
  // rules (1–16 characters, etc.) come in M3; this just stops absurd input early.
  NAME_RAW_MAX_LENGTH: 64,
};
