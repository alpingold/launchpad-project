import { fileURLToPath } from 'node:url';

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

  // Largest single message (in bytes) a client may send. The biggest real one is a
  // drawing from a drawPad (at most 1500 points, about 10–15 KB); everything else is a
  // few hundred bytes. `ws` closes the socket with code 1009 if this is exceeded.
  WS_MAX_PAYLOAD_BYTES: 32 * 1024,

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

  // How long a disconnected host can take to come back (refresh, laptop sleep) before
  // the room closes for everyone. The browser tests set a short value through an
  // environment variable so they don't wait 30 s.
  HOST_GRACE_MS: Number(process.env.HOST_GRACE_MS) || 30_000,

  // How long a disconnected player's spot is kept in the lobby. During a game the spot
  // is kept until the game ends instead (decision D6).
  PLAYER_GRACE_MS: Number(process.env.PLAYER_GRACE_MS) || 30_000,

  // Rooms with no joins/leaves/reconnects for this long are closed by the sweeper,
  // which runs every ROOM_SWEEP_INTERVAL_MS. Catches rooms forgotten on an open laptop.
  ROOM_IDLE_MS: 2 * 60 * 60 * 1000,
  ROOM_SWEEP_INTERVAL_MS: 5 * 60 * 1000,

  // --- Accounts (M7) ---

  // Where the SQLite database file lives. Tests use ':memory:' (a throwaway in-memory DB).
  DB_PATH: process.env.DB_PATH || fileURLToPath(new URL('../data/boilergames.db', import.meta.url)),

  // How long a login lasts before the host has to log in again.
  SESSION_DAYS: 30,

  // Cookies get the Secure flag (HTTPS only) in production. Locally we use plain http,
  // where a Secure cookie would never be sent, so it's off in development.
  COOKIE_SECURE: process.env.NODE_ENV === 'production',

  // Login/sign-up attempts allowed per IP address per window, to slow down password guessing.
  AUTH_ATTEMPTS_PER_WINDOW: Number(process.env.AUTH_ATTEMPTS_PER_WINDOW) || 10,
  AUTH_WINDOW_MS: 15 * 60 * 1000,

  // Behind a reverse proxy (Caddy, M8) every request seems to come from the proxy itself.
  // Setting this (e.g. TRUST_PROXY=loopback) tells Express to use the visitor's real IP from
  // the X-Forwarded-For header, but only when the request came from that trusted proxy.
  // Off by default: without a proxy, anyone could fake that header.
  TRUST_PROXY: process.env.TRUST_PROXY || false,

  // --- Games ---

  // Largest single screen a game may send (JSON size). Most are under 1 KB; the big one
  // is a gallery of drawings on the big screen. This stops a buggy (or generated) game
  // from flooding phones with huge payloads.
  GAME_MAX_PAYLOAD_BYTES: 96 * 1024,

  // Longest delay a game may ask for with ctx.setTimeout.
  GAME_MAX_TIMER_MS: 10 * 60 * 1000,

  // The art library's list of assets (lives with the client, which serves the files).
  // The game test harness checks that games only use ids from it. The generator's
  // sandbox image has it somewhere else, hence the override.
  ASSET_MANIFEST_PATH:
    process.env.ASSET_MANIFEST_PATH ||
    fileURLToPath(new URL('../../client/public/game-assets/manifest.json', import.meta.url)),

  // --- AI game generation (plan §11) ---

  // Off unless GENERATION_ENABLED=1: it needs Docker + OpenShell + a GenAI Studio provider
  // on this machine (generator/README.md). Managing already-made games works either way.
  GENERATION_ENABLED: process.env.GENERATION_ENABLED === '1',

  // The generator runs in an OpenShell sandbox: this image, with this provider (which holds
  // the GenAI Studio key) and this policy (generator/README.md has the one-time setup).
  OPENSHELL_BIN: process.env.OPENSHELL_BIN || 'openshell',
  GENERATOR_IMAGE: process.env.GENERATOR_IMAGE || 'boilergames-generator:local',
  GENERATOR_PROVIDER: process.env.GENERATOR_PROVIDER || 'genai-studio',
  GENERATOR_POLICY_PATH:
    process.env.GENERATOR_POLICY_PATH ||
    fileURLToPath(new URL('../../generator/openshell/policy.yaml', import.meta.url)),
  // Longest one generation may take (several model calls plus tests), before it's stopped.
  GENERATION_TIMEOUT_MS: 20 * 60 * 1000,

  // Longest raw name string accepted before normalization. The real display-name
  // rules (1–16 characters, etc.) come in M3; this just stops absurd input early.
  NAME_RAW_MAX_LENGTH: 64,
};
