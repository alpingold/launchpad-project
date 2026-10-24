import { fileURLToPath } from 'node:url';

// Every tunable number for the server lives here, so limits and timeouts
// can be reviewed (and changed) in one place instead of hunting through files.

export const config = {
  // Port the HTTP + WebSocket server listens on. Override with PORT=4000 npm run dev:server
  PORT: Number(process.env.PORT) || 3000,

  // Which network address to listen on. Unset: every one (development, so phones on the
  // LAN can reach a dev server). In production HOST=127.0.0.1: only Caddy, on the same
  // machine, can reach Node; even an open firewall port 3000 would lead nowhere.
  HOST: process.env.HOST || undefined,

  // Largest JSON body Express will accept on /api routes. Small on purpose:
  // our requests are tiny (login forms), and a cap stops huge uploads early.
  // The biggest is a change request: 4000 characters, up to 4 bytes each in UTF-8.
  HTTP_JSON_LIMIT: '20kb',
  // Except an uploaded game file (plan §57): up to FRAME_GAME_MAX_BYTES, which JSON escaping
  // (quotes, newlines) can make bigger. Only the upload routes accept this much.
  HTTP_UPLOAD_JSON_LIMIT: '3mb',

  // --- WebSocket transport ---

  // URL path clients connect to (ws://host/ws). Upgrades on any other path are refused.
  WS_PATH: '/ws',

  // Largest single message (in bytes) a client may send. Most are a few hundred bytes;
  // the big ones are frame games' (a drawing, the big screen's states for phones, or its
  // party.save snapshot: an RPG's whole state). `ws` closes the socket with code 1009 if
  // this is exceeded. Raised from 32 KB on 2026-10-15, as games get bigger.
  WS_MAX_PAYLOAD_BYTES: 128 * 1024,

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

  // Reports from the site-wide form (plan §31c) per IP address per window. Anyone may send one,
  // logged in or not, so this is what stops one person flooding the admin's list.
  REPORTS_PER_WINDOW: Number(process.env.REPORTS_PER_WINDOW) || 5,
  REPORTS_WINDOW_MS: 10 * 60 * 1000,
  // Reports on game pages (plan §31b) per account per window: they need an account, so it's
  // counted per account, not per address.
  GAME_REPORTS_PER_WINDOW: Number(process.env.GAME_REPORTS_PER_WINDOW) || 10,
  GAME_REPORTS_WINDOW_MS: 60 * 60 * 1000,

  // Games one account may have (made, uploaded or remixed; admins have no limit), and remixes
  // it may make per hour (plan §59). Each game holds whole copies of its code, so without
  // these, one account could fill the disk with remixes.
  MAX_GAMES_PER_ACCOUNT: Number(process.env.MAX_GAMES_PER_ACCOUNT) || 50,
  REMIXES_PER_WINDOW: Number(process.env.REMIXES_PER_WINDOW) || 10,
  REMIXES_WINDOW_MS: 60 * 60 * 1000,

  // Behind a reverse proxy (Caddy, M8) every request seems to come from the proxy itself.
  // Setting this (e.g. TRUST_PROXY=loopback) tells Express to use the visitor's real IP from
  // the X-Forwarded-For header, but only when the request came from that trusted proxy.
  // Off by default: without a proxy, anyone could fake that header.
  TRUST_PROXY: process.env.TRUST_PROXY || false,

  // --- Deploying (M8) ---

  // The built website (`npm run build` writes it). When this folder exists, the server serves
  // the site itself, so production needs no Vite: one process, one port, behind Caddy.
  // In development it usually doesn't exist and Vite serves the site instead.
  CLIENT_DIST_PATH:
    process.env.CLIENT_DIST_PATH || fileURLToPath(new URL('../../client/dist', import.meta.url)),

  // --- Games ---

  // Largest game file (plan §13c). It's sent to every phone when a game starts; a hand-made
  // game is ~20–40 KB. The AI's rulebook asks for at most 300 KB (generator/src/prompt.js).
  // Raised from 512 KB on 2026-10-15, as games get bigger.
  FRAME_GAME_MAX_BYTES: 1024 * 1024,

  // Largest event a phone may send to the big screen (JSON size). Controls are tiny
  // ("jump", a joystick direction); a drawing is ~15 KB. The big screen's own messages
  // are capped by WS_MAX_PAYLOAD_BYTES. Raised from 24 KB on 2026-10-15.
  GAME_EVENT_MAX_BYTES: 48 * 1024,

  // How many messages one game:batch may carry (the SDK sends at most ~20 batches a second).
  GAME_BATCH_MAX_ITEMS: 100,

  // The hang watchdog (plan §13e, F1): a game stuck in an endless loop freezes the whole
  // big-screen tab (the iframe shares its thread), so the page can't notice. Instead the
  // page sends game:alive every ~2 s while its game's SDK still ticks; if none arrives for
  // this long, the server stops the game and the phones go back to the lobby.
  GAME_WATCHDOG_MS: 15_000,

  // The art library's list of assets (lives with the client, which serves the files).
  // The generator's sandbox image has it somewhere else, hence the override.
  ASSET_MANIFEST_PATH:
    process.env.ASSET_MANIFEST_PATH ||
    fileURLToPath(new URL('../../client/public/game-assets/manifest.json', import.meta.url)),

  // --- AI game generation (plan §11) ---

  // Off unless GENERATION_ENABLED=1: it needs Docker + OpenShell + a GenAI Studio provider
  // on this machine (generator/README.md). Managing already-made games works either way.
  GENERATION_ENABLED: process.env.GENERATION_ENABLED === '1',

  // Is GenAI Studio up (plan §53)? Asked once a minute while generating is on; the pages show it.
  GENAI_STATUS_URL: process.env.GENAI_STATUS_URL || 'https://genai.rcac.purdue.edu/',
  GENAI_STATUS_INTERVAL_MS: 60_000,
  GENAI_STATUS_TIMEOUT_MS: 10_000,

  // How many games may be made at the same time; the rest wait in line. A job mostly waits
  // for the AI (~70 MB each, measured 2026-10-17); the heavy part, its browser check, takes
  // turns through the browser slot below, so this can be larger than the number of checks.
  GENERATION_MAX_RUNNING: Number(process.env.GENERATION_MAX_RUNNING) || 4,

  // Browser checks (headless Chrome, ~450 MB and the CPU for ~20 s) that may run at once
  // across all jobs (plan §28). 1 suits a 2 GB / 2-CPU server. A job holding the browser
  // longer than the max hold time is stopped and the next one goes.
  GENERATION_BROWSER_CHECKS: Number(process.env.GENERATION_BROWSER_CHECKS) || 1,
  GENERATION_BROWSER_MAX_HOLD_MS: 120_000,

  // The generator runs in an OpenShell sandbox: this image, with this provider (which holds
  // the GenAI Studio key) and this policy (generator/README.md has the one-time setup).
  OPENSHELL_BIN: process.env.OPENSHELL_BIN || 'openshell',
  GENERATOR_IMAGE: process.env.GENERATOR_IMAGE || 'boilergames-generator:local',
  GENERATOR_PROVIDER: process.env.GENERATOR_PROVIDER || 'genai-studio',
  // The profile a per-job provider is made from, for a user's own key (plan §15).
  GENERATOR_PROVIDER_TYPE: process.env.GENERATOR_PROVIDER_TYPE || 'genai-studio',
  GENERATOR_POLICY_PATH:
    process.env.GENERATOR_POLICY_PATH ||
    fileURLToPath(new URL('../../generator/openshell/policy.yaml', import.meta.url)),
  // Users' own GenAI Studio keys are stored encrypted (plan §15). The secret that opens them:
  // GENAI_KEY_SECRET (base64 of 32 bytes), or else this file, made the first time.
  KEY_SECRET_PATH: process.env.KEY_SECRET_PATH || fileURLToPath(new URL('../data/key-secret', import.meta.url)),

  // A last-resort limit on one sandbox job (a design, or a build: up to 4 model calls plus a
  // playtest each). Model calls stream, and a call only fails after 2 minutes of silence
  // (generator/src/llm.js), so a slow but working model is never cut off by this in practice.
  // Was 20 minutes until 2026-10-15, with 5 minutes per call.
  GENERATION_TIMEOUT_MS: 60 * 60 * 1000,

  // Longest raw name string accepted before normalization. The real display-name
  // rules (1–16 characters, etc.) come in M3; this just stops absurd input early.
  NAME_RAW_MAX_LENGTH: 64,
};
