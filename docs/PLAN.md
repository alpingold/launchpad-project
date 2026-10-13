# BoilerGames: Implementation Plan (MVP lobby + extension structure)

> **Status (2026-10-13):** M0–M7 done. AI game generation is in progress: A0 (OpenShell spike), A1 (contract v2), A2 (test harness) and A3 (admin role + stored games) are done; A4 (the generator) is next. Deploying (M8) comes after A6. This file is the living plan: decisions and changes are recorded here as they happen, so `git log docs/PLAN.md` shows how it evolved.

_Site renamed from "LaunchPad Party" to **BoilerGames** on 2026-10-11 (built for the Purdue LaunchPad club; the club name stays where it refers to the club)._

## Context

We're building a Jackbox / Mario Party style party platform for Purdue LaunchPad. A host opens a big-screen page and gets a 4-letter room code. Players join from their phones with the code and a name. This plan covers:

- the lobby MVP
- a public homepage
- host-only accounts, stored in SQLite and added after the lobby works

It also sets up two seams so that games, and later AI-generated games, can plug in without a lobby rewrite:

- a game-module contract
- a single runner boundary

_When this plan was first written (2026-10-11) the project folder was empty; everything below was designed up front and then built milestone by milestone._

**Decisions you already made:**
- **Language:** plain JavaScript with JSDoc, not TypeScript.
- **Hosting:** a VPS or AWS eventually.
- **Host disconnect:** 30 seconds to reconnect.
- **Room size:** a global cap of 12, and each game can set a lower one.
- **Accounts:** only the host needs one. Players are guests.
- **Auth timing:** added after the lobby works.
- **Database:** better-sqlite3. No other auth dependencies: use `crypto.scrypt` and hand-rolled cookie sessions.
- **Game data:** games don't touch the database.

**Decisions locked in round 2 (2026-10-11):**
- **D5:** resume tokens live in `sessionStorage`.
- **D6:** players get a 30 s grace period in the lobby; in-game, their slot is kept until the game ends.
- **D7:** no late joiners. Spectators are a maybe for later.
- **D8:** the game contract is a ctx + callbacks object, option (a).
- **D12:** client routing is a hand-rolled pathname switch.
- **D13:** the database is better-sqlite3. Non-SQLite alternatives are noted in §9 for reference.
- **D17:** hosting is a single VPS.
- **D19:** the host kick button is included in M4.
- **D21:** inappropriate names are handled by host kick only.
- **Q1:** games use declarative view payloads (§4a).
- **Q2:** build a tiny playable demo game (new milestone M5b) plus an asset library (§4b).
- **Q3:** no email features.
- **Q4:** one room per host at a time (§6).
- **Q5:** the join URL and code are shown as text, with no QR code.

**Decisions locked in round 3 (2026-10-13), AI game generation (full design in §11):**
- **Build AI generation (milestones A0–A6) before deploying (M8).**
- **OpenShell sandboxes the agent that *writes* games.** Games at party time keep running exactly as they do now, in the server process with `GameRunner`.
- **Who can generate:** only the admin account (`alpingold`) for now. Later, any host who supplies their own Purdue GenAI Studio API key (A7, after checking RCAC's rules).
- **Model provider:** Purdue GenAI Studio (free for students, OpenAI-compatible API).
- **Where games live:** approved generated games are stored by the server (database), **not** in the repo. Only official, hand-made games live in the repo.
- **Contract:** option **C**, ctx + callbacks plus required `hostView()`/`playerView(id)`. No saving or resuming game progress in this version (it may come in a later iteration).

**Dependencies:** react, react-dom, vite, @vitejs/plugin-react, express, ws, and better-sqlite3 (milestone 7). Nothing else unless you approve it. The tests use the built-in `node:test`.

---

## 1. Folder and file structure

```
practice/
  package.json              root scripts only: "dev:server", "dev:client", "test", "build" (uses npm --prefix, no extra deps)
  README.md                 how to run, plus the protocol summary (later)

  server/
    package.json            express, ws (later better-sqlite3); "type": "module"; scripts: start, dev (node --watch), test (node --test)
    src/
      index.js              Entry point: builds the Express app, the http.Server and the WS server, then listens. Wiring only, no logic.
      config.js             Every tunable constant in one place (limits, timeouts, ports). Easy to show your mentor.
      http/
        app.js              Express app: JSON body limit, /api/health, serves client/dist in production, mounts auth routes (M7)
        authRoutes.js       (M7) POST /api/signup, /api/login, /api/logout, GET /api/me
      transport/
        wsServer.js         WebSocket layer: upgrade handling (Origin check, M7 cookie auth), connection ids, heartbeat,
                            error handlers, rate limit. Turns raw frames into validated messages and passes them to the router.
        connection.js       Small Connection object: {id, ws, isAlive, userId, badMessageCount, rateLimiter}, plus send() that drops sends on closed sockets
        rateLimiter.js      (added M1) Token bucket with injectable clock
      protocol/
        messageTypes.js     The list of every client and server message type, as constants (one source of truth)
        validate.js         parseClientMessage(raw) → {ok:true, msg} | {ok:false, code}. Safe JSON.parse, shape and field checks per type.
        errors.js           Error code constants (ROOM_NOT_FOUND, NAME_TAKEN, …) with friendly messages
      server.js             (added M2) createGameServer(): builds http + ws + rooms without listening, so tests get a fresh full server
      router.js             Maps each validated message type to a RoomManager method. Enforces "who may send this" (host vs player vs none).
      rooms/
        RoomManager.js      Owns Map<code, Room>. Create/join/leave/resume/disconnect, grace timers, broadcasts. Has no ws import:
                            it is given send(connId, msg) and clock functions, so tests can fake them.
        Room.js             Data for one room plus pure helpers: addPlayer, removePlayer, toPublicState()
        roomCode.js         Makes 4-letter codes from a safe alphabet; retries on collision; takes an injectable RNG
        names.js            normalizeName() and validateName(): trim, NFC, collapse spaces, length, no control characters, case-insensitive key
        tokens.js           newToken(): crypto.randomBytes(16).toString('base64url'), plus isTokenShape()
      games/
        contract.js         JSDoc typedefs for GameModule / GameInstance / GameContext, plus validateGameModule(mod)
        registry.js         registerGame(mod), getGame(id), listGames(). Validates on register.
        index.js            The one place that imports game folders and registers them (registers reaction-race from M5b)
        views.js            (M5b) The list of allowed view kinds and a check function for each (§4a)
        reaction-race/
          index.js          (M5b) The tiny playable demo game (§4c)
        GameRunner.js       Wraps one running game: builds ctx, catches game exceptions, owns timers, checks outgoing payloads.
                            THIS is the sandbox seam (see §5).
      db/                   (M7)
        database.js         Opens better-sqlite3 and runs schema.sql on startup
        schema.sql          users and sessions tables
        users.js            createUser, findUserByUsername (prepared statements)
        sessions.js         createSession, getSessionUser, deleteSession, sweepExpired
      auth/                 (M7)
        passwords.js        hashPassword / verifyPassword with crypto.scrypt + timingSafeEqual
        cookies.js          parseCookies(header) (~10 lines) and serializeSessionCookie()
    test/
      unit/                 validate.test.js, names.test.js, roomCode.test.js, RoomManager.test.js, GameRunner.test.js, passwords.test.js
      integration/          lobby.test.js: real server on port 0 plus real `ws` clients
      fixtures/
        countGame.js        Tiny test-only game ("first to 3 taps wins") that proves the contract works. Never registered in production.
      helpers/fakeClock.js  Or use node:test's built-in mock.timers

  client/
    package.json            react, react-dom, vite, @vitejs/plugin-react
    vite.config.js          Dev proxy: /api and /ws → http://localhost:3000, so the browser sees one origin
    index.html
    src/
      main.jsx              Mounts <App/>
      App.jsx               Picks a page from window.location.pathname (/, /login, /host, /join). See decision D12.
      net/socket.js         One WebSocket wrapper: connect, auto-reconnect with backoff, JSON send, onMessage subscriptions, auto-resume using the stored token
      pages/Home.jsx        Public explainer plus "Host a game (log in)" and "Join a game" buttons
      pages/Login.jsx       (M7) Sign up / log in forms
      pages/Host.jsx        Big-screen view: room code, join URL, live PlayerList, Start button (disabled until games exist)
      pages/Join.jsx        Phone view: code and name form, then a "you're in" waiting screen
      components/PlayerList.jsx  Renders names as {name} text. NEVER dangerouslySetInnerHTML.
      game/GameScreen.jsx   (M5b) Shows the latest view payload by choosing the matching component
      game/views/           (M5b) MessageView, ButtonView, ChoiceView, CountdownView, ScoreboardView (one file each)
      assets.js             (M5b) Loads manifest.json once; assetUrl(id) returns the file path, or a placeholder for unknown ids
    public/assets/          (M5b) manifest.json + PNGs (your drawings / Blender renders)
      styles.css
```

**Why the layers are split this way:** `transport` knows about sockets but not about rooms. `rooms` knows about rooms but not about sockets. `games` sees only the narrow `ctx`. Because of this, `RoomManager` can be unit-tested with plain function calls, and the game sandbox can be swapped later by replacing only `GameRunner`.

---

## 2. Server data model and where state lives

All live game and room state is **in memory, in the server process**. The database (M7) stores **only accounts and login sessions**, never rooms. Rooms last minutes, and losing them on restart is acceptable.

```
RoomManager
  rooms: Map<code, Room>
  members: Map<connId, {code, role, playerId}>      // (M2 change) which room each connection is in; the ONLY copy of this
  // (M4 change) no token indexes: resume messages include the room code, and a room has at
  // most 12 players, so resume loops over them comparing tokens with timingSafeEqual.

Room
  code: "BXKT"
  phase: "lobby" | "in_game" | "closed"
  host: { token (secret), connId | null, userId (M7), graceTimer | null }
  players: Map<playerId, Player>       // Map keeps join order, so the list is stable
  maxPlayers: 12                       // global cap from config; a game may lower it at start
  game: GameRunner | null
  createdAt, lastActivityAt            // for the idle-room sweeper

Player
  id: "p_3f9a"        // PUBLIC id, broadcast to everyone, used in kick and game messages
  token: "…22 chars…" // SECRET, sent only to this player, used to resume after refresh
  name: "Alex"        // display name as typed (after normalization)
  nameKey: "alex"     // lowercase key, used for the uniqueness check
  connId | null       // null while disconnected
  connected: boolean
  graceTimer | null
  joinedAt
```

| State | Lives in | Why |
|---|---|---|
| Rooms, players, game state | `RoomManager` memory | Fast, simple, short-lived; the server is authoritative |
| Socket ↔ room/role mapping | `RoomManager.members` (changed in M2) | One copy of the truth, owned by the layer that owns rooms; transport only knows connection ids |
| Player/host resume token | Server memory **and** the client's `sessionStorage` | Lets a refresh reclaim the same slot |
| Accounts, login sessions (M7) | SQLite `users`, `sessions` | Must survive restarts |
| Login session id (M7) | httpOnly cookie `sid` | JavaScript can't read it, so XSS can't steal it |

**Two ids per player:** `playerId` is public and `token` is secret. If they were the same, anyone who saw the player list could impersonate someone. This is the most important data-model idea to explain to your mentor.

---

## 3. Message protocol

**Envelope:** every message is a JSON object `{ "type": "domain:action", ...fields }`. There's one flat object per message, with no nested `payload` except for game messages.

**Rules applied to every incoming frame (`validate.js` + `wsServer.js`), in order:**
1. **Payload size:** the WS server's `maxPayload` is 4 KB, so `ws` itself closes oversized frames with code 1009.
2. **Binary frames:** `isBinary === true` → reply `error BAD_MESSAGE`.
3. **Parsing:** `JSON.parse` runs inside try/catch. On failure → `BAD_MESSAGE`.
4. **Shape:** the result must be a plain object (not null, not an array) with `typeof type === 'string'` and a type from the client list. Otherwise → `UNKNOWN_TYPE`.
5. **Fields:** each type has a hand-written checker. Unknown extra fields are **ignored**: we copy out only the fields we expect, and never pass the raw object deeper.
6. **Bad message limit:** more than 10 invalid messages from one connection → close with 1008 (policy violation).
7. **Rate limit:** a token bucket per connection, about 20 messages per second with a burst of 40. Going over it → drop the message and send `RATE_LIMITED`. Repeated abuse → close.

**Field rules:**
- `code`: string. It is uppercased and trimmed, then must match `/^[A-Z]{4}$/`.
- `name`: string, at most 64 raw characters before normalization. Normalization trims, applies NFC, and collapses inner whitespace. The result must be 1–16 code points, with no `\p{C}` (control or invisible) characters. It must be unique within the room, compared case-insensitively against **all** players, including disconnected ones still in their grace period.
- `token` / `hostToken`: string matching `/^[A-Za-z0-9_-]{22}$/`.
- `playerId`: string matching `/^p_[a-z0-9]{4,12}$/`.
- `gameId`: string matching `/^[a-z0-9-]{1,40}$/`, and it must exist in the registry.
- `action` (game): a plain object. Its *contents* are validated by the game (§4), and its size is already capped by `maxPayload`.

### Client → server

| type | Who may send | Fields | Server behavior / errors |
|---|---|---|---|
| `host:create_room` | an unattached connection (M7: must have a logged-in `userId`) | — | Creates the room, marks this connection as host → `room:created`, `room:state`. **One room per host (Q4):** from M7 on, if this account already hosts a room, the server re-attaches to that room instead of creating a second one (see §6). Errors: `ALREADY_IN_ROOM`, (M7) `NOT_AUTHENTICATED`, `SERVER_FULL` (room-count cap) |
| `host:resume` | an unattached connection | `code`, `hostToken` | Re-attaches the host and cancels the grace timer → `room:created` (same payload) + `room:state`. Errors: `ROOM_NOT_FOUND`, `INVALID_TOKEN` |
| `player:join` | an unattached connection | `code`, `name` | → `room:joined` to this player, then `room:state` to everyone. Errors: `ROOM_NOT_FOUND`, `NAME_INVALID`, `NAME_TAKEN`, `ROOM_FULL`, `GAME_IN_PROGRESS`, `ALREADY_IN_ROOM` |
| `player:resume` | an unattached connection | `code`, `token` | Re-attaches to the existing player slot. If that slot already has a live socket, the old socket gets `room:closed {reason:"replaced"}` and is closed (handles a second tab). Errors: `ROOM_NOT_FOUND`, `SESSION_EXPIRED` |
| `room:leave` | host or player | — | Player: removed now. Host: room closes now (this is the explicit "End room" button, which is different from a disconnect) |
| `host:kick` | host | `playerId` | Removes the player and sends them `room:closed {reason:"kicked"}`. Error: `PLAYER_NOT_FOUND`. *(Optional for MVP, see D19)* |
| `host:start_game` | host, phase `lobby` | `gameId`, `options?` (plain object) | See §4. Errors: `GAME_NOT_FOUND`, `WRONG_PLAYER_COUNT`, `WRONG_PHASE` |
| `game:action` | player (in-game) | `action` (plain object) | Forwarded to `GameRunner.handleAction(playerId, action)`. Error: `WRONG_PHASE` |

There's no app-level `ping`. Heartbeats use WebSocket protocol pings, which browsers answer automatically.

### Server → client

| type | Sent to | Fields |
|---|---|---|
| `room:created` | host | `code`, `hostToken` |
| `room:joined` | the joining or resuming player | `code`, `playerId`, `token`, `name` |
| `room:state` | everyone in the room, on every change | `code`, `phase`, `hostConnected`, `maxPlayers`, `players: [{id, name, connected}]`, `gameId \| null` |
| `room:closed` | everyone affected | `reason`: `"host_left"`, `"host_timeout"`, `"kicked"`, `"replaced"`, `"idle"`, `"left"` (added M4: confirms a player's own room:leave). The socket stays open after this, so the same page can join or create another room |
| `error` | the sender | `code` (constant), `message` (human text), `requestType` (the type that failed, if known) |
| `game:started` | everyone | `gameId`, `players: [{id, name}]` |
| `game:message` | the targets the game chose | `payload` (a view payload, see §4a), `serverNow` (ms, used for clock-offset correction) |
| `game:ended` | everyone | `results` (`{ rankings: [playerId,…] }` or `{ error: true }`) |

**Why send full `room:state` snapshots instead of deltas:** with at most 12 players a snapshot is tiny. A client that missed a message, for example after a reconnect, simply gets the truth on the next message. Delta updates create sync bugs we don't need. The `ctx.broadcast` payloads for games follow the same idea (see §4).

---

## 4. Game module contract, registry, and starting a game

### Contract (`server/src/games/contract.js`, written as JSDoc)

> **Superseded by contract v2 (§11b, built in A1).** v2 adds `contractVersion: 2`, `ctx.now()`, optional `scores` in `endGame`, automatic resend of each screen's latest view on reconnect, and the offered-actions check. The code in `contract.js` is the source of truth.

```js
/**
 * A GameModule is a plain object exported by a game folder.
 * @typedef {Object} GameModule
 * @property {string} id            // "mario-board", matches /^[a-z0-9-]{1,40}$/
 * @property {string} name          // display name
 * @property {string} description
 * @property {number} minPlayers    // >= 1
 * @property {number} maxPlayers    // <= config.MAX_PLAYERS (12)
 * @property {(ctx: GameContext, options: object) => GameInstance} createGame
 */

/**
 * What the platform gives a game. This is the ONLY way a game talks to the world.
 * Everything passed in or out must be plain JSON (no functions, classes, Dates),
 * so the same contract can later cross a process/worker boundary unchanged.
 * @typedef {Object} GameContext
 * @property {ReadonlyArray<{id:string, name:string}>} players  // frozen snapshot at start
 * @property {(payload: object) => void} broadcast              // to host screen + all players
 * @property {(playerId: string, payload: object) => void} sendToPlayer
 * @property {(payload: object) => void} sendToHost             // big-screen-only info
 * @property {(fn: () => void, ms: number) => number} setTimeout // runner-owned; auto-cleared on end
 * @property {(id: number) => void} clearTimeout
 * @property {() => number} random                              // seeded PRNG [0,1); deterministic in tests
 * @property {(results: {rankings: string[]}) => void} endGame  // game is over; runner disposes it
 * @property {(msg: string) => void} log
 */

/**
 * What a game gives back from createGame().
 * @typedef {Object} GameInstance
 * @property {(playerId: string, action: object) => void} onAction       // REQUIRED. Game must validate `action` itself.
 * @property {(playerId: string) => void} [onPlayerDisconnect]
 * @property {(playerId: string) => void} [onPlayerReconnect]           // good moment to resend that player's view
 * @property {() => void} [onHostReconnect]                              // (added M5) resend the big screen's view
 * @property {() => void} [dispose]                                      // cleanup; runner calls it once
 */
```

**Rules for games (written in the doc comment, enforced by GameRunner where possible):**
- A game never imports platform modules, sockets, `fs`, the network, or the database. It only uses `ctx`.
- All randomness comes from `ctx.random` and all timing from `ctx.setTimeout`. This keeps games testable and lets the runner clean up.
- Every outgoing payload must be a JSON-serializable plain object under 8 KB. The runner checks this with `JSON.stringify` and a length check, and throws inside the game if it fails.
- The game treats `action` as untrusted. It validates the action against the current game state, and rejects anything like a move out of turn.
- (Added M5) Synchronous code only: no async/Promises/global timers. The runner can only catch errors thrown while it is calling the game.
- (Added M5) Every message must be a valid view (§4a); view checks are strict (unknown fields are errors).
- (Added M5) The registry is a `GameRegistry` class (so tests get isolated registries); `createDefaultRegistry()` in `games/index.js` lists the real games; `GET /api/games` serves `list()` to the host's picker.
- (Added M5) A game starts with every player in the room, including ones in their lobby grace period; their timers stop, and they get a fresh grace period when the game ends.

### GameRunner (`server/src/games/GameRunner.js`)
- Takes `(module, room, sendFns, clock, seed)`. It builds `ctx` and calls `module.createGame(ctx, options)` inside try/catch.
- Every call into the game (`onAction`, timer callbacks, disconnect hooks) is wrapped in try/catch. If the game throws, the runner logs it, ends the game with `{error:true}`, and returns the room to the lobby. **A buggy game must never crash the server or the room.**
- It keeps a set of active timers, and `dispose()` clears them all, so timers can't leak after a game ends.
- It translates `ctx.broadcast(p)` into `game:message {payload:p}` for every connected player and the host.

### Registry (`server/src/games/registry.js`)
- `registerGame(mod)` runs `validateGameModule(mod)`, which checks the id format, the types, `1 ≤ minPlayers ≤ maxPlayers ≤ 12`, that `createGame` is a function, and that the id is not a duplicate. If any check fails it throws at startup, so a bad game can't be half-registered.
- `games/index.js` statically imports each game folder and registers it. It's empty in the MVP. Tests register `fixtures/countGame.js` directly.
- `listGames()` returns `{id, name, description, minPlayers, maxPlayers}` so the host UI can show a picker later.

### Starting a game from a room (`host:start_game`)
1. The router checks that the sender is this room's host.
2. `RoomManager.startGame(code, gameId, options)` checks that the phase is `lobby`, that the game exists, and that the count of **connected** players is between the game's `minPlayers` and `maxPlayers`.
3. The room sets `phase = "in_game"` and creates `room.game = new GameRunner(...)`, then broadcasts `game:started` and `room:state`.
4. During the game, `game:action` goes to the runner. Lobby messages still work: `room:leave` calls `onPlayerDisconnect`, and joins are refused with `GAME_IN_PROGRESS`.
5. When the game calls `ctx.endGame(results)`, or the game crashes, the runner is disposed and the room goes back to `phase = "lobby"`. The room broadcasts `game:ended`, then `room:state`, and the host can start again.

### 4a. Declarative views (decided, Q1)

Games never send UI code. Instead they send **view payloads**: plain JSON that names one of a small set of view kinds. The client has one trusted React component per kind and renders the payload with it.

- **Phones:** a game sends a view with `ctx.sendToPlayer(id, {view, ...})`, or to every player with `ctx.broadcast(...)`.
- **Big screen:** a game sends a host view with `ctx.sendToHost({view, ...})`.
- **Latest view wins:** each new view replaces the previous one on that screen. This is the same snapshot idea as `room:state`, so a reconnecting phone only needs its latest view, and the game resends it in `onPlayerReconnect`.

**Starting view kinds.** Start with these and add more only when a real game needs them:

| `view` | Fields | Phone renders | Host renders |
|---|---|---|---|
| `message` | `title`, `text?`, `asset?` | Big text with an optional image | Same, but larger |
| `button` | `label`, `action` (object sent back unchanged), `asset?` | One big tappable button. A tap sends `game:action {action}` | n/a |
| `choice` | `prompt`, `options: [{label, action, asset?}]` (max 8) | A list of buttons | n/a |
| `countdown` | `title`, `endsAt` (server ms timestamp) | Number counting down | Same |
| `scoreboard` | `title`, `rows: [{playerId, score}]` | Highlights your own row | Full table, with names looked up from `room:state` |

**Rules for view payloads:**
- **Validation.** The **client** checks each view against its kind. An unknown kind or bad fields render as a neutral "Waiting…" screen, never a crash. The **server**'s GameRunner also checks that `view` is a known kind before sending, so a game finds its bug in tests rather than on someone's phone.
- **Rendering text.** All text is rendered as React text, so a game can't inject HTML.
- **Images.** The `asset` field is an **asset id** from the library (§4b), never a URL. This means a game, AI-generated or not, can only display art you approved.
- **Timing.** `endsAt` uses server time. The server sends its current time (`serverNow`) in `game:message`, so each client can correct for its own clock being off.

**Where the files go:**
- `client/src/game/GameScreen.jsx` picks the right view component.
- `client/src/game/views/*.jsx` holds one file per view kind.
- `server/src/games/views.js` holds the server-side list of view kinds and their check functions. It is shared in spirit with the client's checks; the two copies are kept in sync manually for now.

### 4b. Asset library (from Q2)

**Making art:**
- **Hand drawings:** scan or draw them, then export to PNG.
- **Blender:** render to PNG sprites with transparent backgrounds. A Blender render is just an image file, so no new dependency is needed.
- **Real-time 3D:** showing live 3D models (glTF) in the browser would need three.js, a new dependency. Defer that, and ask first if you want it.

**Where art lives:**
- **Files:** `client/public/game-assets/<file>` (changed in M5b from `assets/`, which Vite uses for its own build output), served as static files. SVG and PNG both work; placeholders are hand-written SVGs.
- **Manifest:** `client/public/assets/manifest.json` lists every approved asset: `[{id, file, tags:["character","board"], width, height, credit}]`. Asset ids match `/^[a-z0-9-]{1,40}$/`.

**How games use art:**
- **At runtime:** games refer to art only by asset id. The client looks the id up in the manifest, and an unknown id shows a placeholder.
- **AI-generated games:** the manifest becomes part of the generation prompt, as the list of usable art and its tags. Generated games can only reference existing ids. Making new art with AI is a separate, later decision.
- **Tests:** the asset-id check is part of the E4 test harness. A game that references an unknown asset id fails the test.

### 4c. Demo game (from Q2): "Reaction Race"

This tiny game exists to prove the whole path works end to end on real phones: contract, registry, views, timers and assets. It lives at `server/src/games/reaction-race/index.js` and is registered in `games/index.js`.

- **Players:** 1–12.
- **Rounds:** 5 rounds. In each round:
  - The host screen shows "Get ready…".
  - After a random 2–5 s delay (from `ctx.random`, scheduled with `ctx.setTimeout`), everyone sees **GO!** and phones show a `button` view.
  - The first valid tap wins the round.
  - A tap *before* GO is ignored, and the phone shows "Too soon!".
- **Ending:** after 5 rounds the game shows a `scoreboard` and calls `endGame({rankings})`.
- **Timing fairness:** the winner is decided by **server arrival order**. That is simple and explainable. Different phone latencies are a known limitation (§10).
- **Art:** it uses 1–2 placeholder assets (e.g. `go-sign`, `trophy`) so the asset path is exercised. Your own art can replace them later.
- **Tests:** `server/test/unit/reactionRace.test.js` uses mock timers and a seeded RNG. It covers a full 5-round game, tapping too early, a player disconnecting mid-round, and that every outgoing view is valid.

**Minigames:** the board game is one `GameModule`. Each minigame should use **the exact same contract**: it gets a `ctx`, exchanges JSON, and calls `endGame(results)`. Later the board game gets one extra ctx function, `ctx.runMinigame(minigameId) → Promise<results>`. That function looks the minigame up in a separate minigame registry and runs it in a child `GameRunner`. This is not built now, but keeping one contract means AI-generated minigames have one target.

---

## 5. Extension points for AI-generated games and sandboxing

> **Update 2026-10-13:** the concrete design is now §11, and it supersedes parts of this section.
> - **E2 (runtime sandbox): not built for now.** Generated games run in-process like official ones. The protection comes from testing them inside OpenShell plus admin review before they ever run on the server (see the §11 risks).
> - **E3:** becomes the `source`/`status` fields on registered games.
> - **E4:** becomes the harness (A2).

| # | Extension point | Where | What plugs in later |
|---|---|---|---|
| E1 | **Contract** | `games/contract.js` | The JSDoc typedefs become the spec in the AI prompt. `validateGameModule` is the first automatic check on generated code. |
| E2 | **Runner boundary** | `games/GameRunner.js` | A `SandboxedGameRunner` with the same public methods (`handleAction`, `playerDisconnected`, `dispose`). It runs the game code in a separate process or isolate and forwards `ctx` calls as JSON messages. Room code doesn't change, because rooms only call the runner. This works because the contract is JSON-only. |
| E3 | **Registry source** | `games/registry.js` | `registerGame(mod, {trusted:false, source})`. Untrusted games are always created with `SandboxedGameRunner`. Generated games could be loaded from a folder or from the DB instead of static imports. |
| E4 | **Test harness** | `test/helpers` (a simulated-players driver) | The same harness that tests `countGame` becomes the automatic gate for generated games: run N random games, assert they call `endGame`, never throw, and stay within message and size limits. |
| E5 | **Resource limits** | runner config | Timeouts on each call into the game, a cap on how fast a game can send messages, the payload cap (already present), and later memory and CPU caps for the sandbox. |
| E6 | **View kinds** | `server/src/games/views.js` + `client/src/game/views/` | **Decided (§4a).** Generated games only emit view payloads, and no generated UI code ever runs in a browser. A new view kind is a reviewed, hand-written addition: a trusted component plus a validator. AI can propose new kinds but can't ship them. |
| E7 | **Asset library** | `client/public/assets/manifest.json` | Generated games reference art by asset id only. The manifest (ids and tags) is given to the generator as the art that may be used. AI-generated art, if ever wanted, would go through the same manifest after human approval. |

**Sandbox technology, decided later and noted honestly:**
- `node:vm` is **not** a security boundary. Don't use it for untrusted code.
- `worker_threads` gives you memory limits and termination, but code inside still has full Node APIs.
- Real options:
  - a child process using Node's permission model (`--permission`)
  - the `isolated-vm` package (a new dependency)
  - a container per game

Plan for E2 to be one of these. Pick when you get there.

**Generation pipeline (future):** prompt plus contract, view kinds and asset manifest → generated code → static checks → `validateGameModule` → simulated-player harness (E4) → **human approval** → register as untrusted (E3).

---

## 6. Failure cases

| Case | Handling |
|---|---|
| **Host disconnect** (socket closes or heartbeat fails) | Set `host.connId = null` and broadcast `room:state {hostConnected:false}` so phones show "waiting for host…". Start a **30 s** timer. `host:resume` with a valid `hostToken` cancels it. If it expires, send `room:closed {reason:"host_timeout"}` to everyone, clear all player timers, dispose the game, and delete the room and its index entries. |
| **Host clicks "End room"** | `room:leave` from the host closes the room immediately with `reason:"host_left"`. |
| **Host opens a second room (Q4)** | Before M7, one room per *connection* (`ALREADY_IN_ROOM`). From M7 on, `Room.host.userId` is indexed in `hostByUser: Map<userId, code>`. If a logged-in host sends `host:create_room` while their room is alive, the server **re-attaches** them to it: the old host socket gets `room:closed {reason:"replaced"}`, and the new tab is the host. To get a fresh room they press "End room" first. **Why re-attach instead of an error:** a host who opens a new tab or switches laptops mid-party keeps the room, and nobody's phone gets kicked. |
| **Host refreshes the page** | The client keeps `{code, hostToken}` in `sessionStorage`. On load, `socket.js` sends `host:resume`, so the room survives and the same code still works. |
| **Player refresh / phone sleep** | On close: set `connected=false` and broadcast. The slot is kept for **30 s in the lobby** and **until the game ends while in-game** (D6). The client stores `{code, token}` in `sessionStorage` and sends `player:resume` automatically. If the slot is gone → `SESSION_EXPIRED`, and the client shows the join form with the code prefilled. |
| **Same player in two tabs** | A resume on an already-attached slot: the newest connection wins, and the old one gets `room:closed {reason:"replaced"}` and is closed. |
| **Duplicate name** | Compare the normalized lowercase `nameKey` against every player, including those still in their grace period → `NAME_TAKEN`. The client keeps the form open. |
| **Full room** | Count all players, including disconnected ones in grace: if `>= room.maxPlayers` → `ROOM_FULL`. |
| **Join during a game** | `GAME_IN_PROGRESS`. Resuming an existing slot is still allowed. |
| **Wrong or unknown code** | `ROOM_NOT_FOUND`. Join attempts per connection are rate-limited, so the ~130k possible codes can't be quickly guessed. |
| **Malformed message** (bad JSON, unknown type, bad fields, binary) | Reply `error`, keep the socket open, and count it. More than 10 → close 1008. Too large → `ws` closes with 1009 by itself. |
| **Exception in our own handler** | `router.js` wraps every dispatch in try/catch, logs the error, and replies `INTERNAL_ERROR`. The process keeps running. |
| **Socket `error` event** | Every `ws` gets `ws.on('error', log)`. An unhandled `'error'` event **crashes Node**, so this handler is required. |
| **Dead connections** | Every 15 s: if `isAlive` is false → `ws.terminate()`. Otherwise set `isAlive=false` and `ws.ping()`, and `'pong'` sets it back to true. Terminating triggers the normal disconnect path above. Clear the interval on server close. |
| **Game throws** | The GameRunner catches it → `game:ended {error:true}` and the room goes back to the lobby (§4). |
| **Abandoned rooms** | A sweeper every 5 minutes closes rooms idle for more than 2 h, or with no host and no players. |
| **Server restart** | All rooms are lost (accepted for now). Clients see the socket close, retry, get `ROOM_NOT_FOUND` on resume, and show "Room ended". |
| **Cross-site WebSocket hijack** (M7, once cookies matter) | On `upgrade`, reject if the `Origin` header isn't in the allowed list. |

---

## 7. Testing approach (node:test, no new dependencies)

- **Pure unit tests:**
  - `validate.test.js`: a table of bad inputs (`"not json"`, `null`, `[]`, `{type:5}`, a long name, a name with `\u0000`, lowercase code, extra fields, …) → the expected error code.
  - `names.test.js`: normalization and the case-insensitive key.
  - `roomCode.test.js`: with a seeded RNG, codes use the alphabet, and collisions retry.
- **`RoomManager.test.js` (most important):** build a `RoomManager` with a fake `send` that records `{connId, msg}` into an array, and use `node:test`'s `mock.timers`. Cover:
  - create → join → everyone gets the right `room:state`
  - duplicate name, full room at 12, join during a game
  - player disconnect → resume within 30 s keeps the slot; after 30 s the slot is removed
  - host disconnect → after 29 s still open, after 30 s closed and everyone gets `room:closed`
  - two-tab replacement
  - no timers left running after a room closes (a leak check)
- **`GameRunner.test.js` with `fixtures/countGame.js`:**
  - actions route to the game
  - `endGame` returns the room to the lobby
  - a game that throws doesn't throw out of the runner
  - timers are cleared on dispose
  - oversized or non-JSON payloads are rejected
- **Integration (`lobby.test.js`):** start the real server on port 0 and connect 3 real `ws` clients:
  - full join flow
  - send garbage, then check the server still answers others
  - send 5 KB and check the socket is closed with 1009
  - kill a client without closing and check it's dropped (use a short heartbeat via config override)
- **M7:**
  - auth uses `new Database(':memory:')`
  - password hash/verify round-trip and wrong-password tests
  - signup → login → `/api/me` with Node's built-in `fetch`
  - `host:create_room` without a cookie → `NOT_AUTHENTICATED`
- **Manual checklist per milestone:** a laptop plus 2 phones on the same Wi-Fi.

**Why most logic lives in `RoomManager` without sockets:** almost everything can be tested in milliseconds with no network. This is the payoff of the layer split.

---

## 8. Build order (each milestone is runnable and reviewable)

| M | Goal | You can run / review |
|---|---|---|
| **M0 Scaffold** | Root + `server/` + `client/` packages, Express `/api/health`, Vite app, dev proxy | `npm run dev:server` + `dev:client`; the page loads and fetches `/api/health` |
| **M1 Transport** | `wsServer.js`, `connection.js`, `validate.js`, `errors.js`, heartbeat, error handlers, rate limit, a temporary echo handler | Connect from browser devtools; send garbage and see error replies; the server survives. `validate.test.js` passes |
| **M2 Rooms: create** | `RoomManager`, `Room`, `roomCode`, `tokens`, `router.js`, `host:create_room`; `Host.jsx` shows the code | The host page shows a code. Unit tests for creation |
| **M3 Join + live list** | `player:join`, `names.js`, `room:state` broadcasts, `Join.jsx`, `PlayerList.jsx` | Laptop plus phones: names appear live; duplicate name and full-room errors show up |
| **M4 Leave / disconnect / resume** | Grace timers (host 30 s, player 30 s), `host:resume`, `player:resume`, `room:leave`, `room:closed`, client auto-reconnect, sweeper, (optional) kick | Refresh a phone → same slot. Close the host tab → phones show waiting → room closes after 30 s. Timer tests with `mock.timers`. Integration test |
| **M5 Game seam** | `contract.js`, `registry.js`, `GameRunner.js`, `views.js`, `host:start_game`, `game:*` messages; `countGame` fixture **in tests only** | Tests show a full game lifecycle and crash containment. The host UI "Start" button lists `listGames()` (empty) |
| **M5b Demo game + views + assets** | Client `GameScreen.jsx` + the 5 view components, `assets/manifest.json` with 1–2 placeholder PNGs, the `reaction-race` game registered, `reactionRace.test.js` | Laptop plus phones: start Reaction Race, play 5 rounds, see the scoreboard, return to the lobby, play again. Refresh a phone mid-game and get your current view back |
| **M6 Homepage + routing** | `Home.jsx` explainer, path-based page switch, a join link with `?code=` prefill | Visit `/` → read the explainer → click Join or Host |
| **M6b Settings + dark mode** | A settings page/panel (`/settings` or a gear menu on every page). _(Built as a ⚙ panel on every page, not a separate page, so phones mid-game don't navigate away and drop their connection. Code in `client/src/settings/`.)_ The full list of settings is TBD; **dark mode is the one confirmed setting.** Theme options: Light / Dark / Match device (`prefers-color-scheme`). Refactor `styles.css` colors into CSS custom properties (`--bg`, `--text`, `--accent`, ...) with a `[data-theme="dark"]` override, so a theme is just a different set of variables. Preferences saved in `localStorage` (per device, survives closing the tab, unlike the room tokens in sessionStorage). Must cover the host big screen, phones, and game views. | Toggle dark mode; it applies instantly on every page and is remembered after a reload. A browser test for the toggle and persistence |
| **M7 Accounts + SQLite** | better-sqlite3, schema, scrypt, sessions, cookie, `/api/*` auth routes, `Login.jsx`; WS upgrade reads the cookie and checks Origin; `/host` requires login | Sign up, log in, host; logged out → redirected to login. Auth tests |
| **A0–A7 AI game generation** | Added 2026-10-13; built **before M8**. See §11d for the milestone list | See §11d |
| **M8 Deploy** | `npm run build`, Express serves `client/dist`, one node process under systemd (or pm2), Caddy reverse proxy for automatic HTTPS → `wss://` | The site works over HTTPS on a VPS, with phones on mobile data. _Note: where generation runs once deployed is Q10 (§11f)_ |

---

## 9. Decision list (★ = still yours to make, ✅ = decided)

| # | Decision | Options and tradeoffs | Recommendation |
|---|---|---|---|
| D1 | Language | JS+JSDoc (no build, easy) vs TS (compiler enforces the contract; more tooling) | **JS+JSDoc**, as you chose. TS can come later, file by file, if the contract grows |
| D2 | Repo layout | Two folders with their own package.json + root scripts, vs npm workspaces, vs one package | **Two folders + root scripts.** Simplest mental model: server and client are separate programs |
| D3 | State sync | Full snapshots vs deltas | **Snapshots.** Tiny at 12 players, and they self-heal after reconnects |
| D4 | WS attach | `new WebSocketServer({server})` vs `{noServer:true}` + manual `server.on('upgrade')` | **noServer + upgrade handler.** It's one place to check Origin and cookies before accepting (needed in M7) |
| D5 ✅ | Where the client keeps the resume token | `sessionStorage` (survives refresh, per tab, gone when the tab closes) vs `localStorage` (survives closing the tab; shared across tabs) | **Decided: sessionStorage.** |
| D6 ✅ | Player grace period | Same 30 s everywhere vs 30 s in the lobby and "keep until the game ends" in-game | **Decided: 30 s lobby, keep in-game.** |
| D7 ✅ | Late join during a game | Refuse vs allow as a spectator vs allow into the game | **Decided: refuse.** Spectators may come later: they would be a third role next to host and player that only receives broadcasts, so they fit without a lobby rewrite |
| D8 ✅ | Game contract style | **(a)** a ctx + callbacks object (above) vs **(b)** a pure reducer `(state, action) → {state, effects}` | **Decided: (a).** |
| D9 | Minigames | Same contract as games vs a separate, smaller contract | **Same contract.** One target for AI generation |
| D10 | Validation | Hand-written checks vs a schema library (zod/ajv, new deps) | **Hand-written.** ~8 message types; every check is visible and explainable |
| D11 | Test runner | `node:test` vs vitest/jest | **node:test.** Built in, zero deps, has mock timers |
| D12 ✅ | Client routing | Hand-rolled `pathname` switch vs `react-router` (new dep) | **Decided: hand-rolled.** |
| D13 ✅ | Database | better-sqlite3 vs `node:sqlite` (built in) vs **non-SQLite:** PostgreSQL (a separate server to install, back up and secure; worth it with many servers or heavy concurrent writes, neither of which we have) vs a JSON file (no dependency, but you'd reinvent locking and uniqueness, and a crash mid-write corrupts it) vs a hosted DB like Supabase (an external account and the network on every login) | **Decided: better-sqlite3.** On a single VPS, SQLite is one file next to the app, with nothing extra to run, and it handles far more traffic than a club will produce. Keep all SQL inside `server/src/db/` so a later move to Postgres touches only that folder |
| D14 | Login sessions | DB-backed random session id in an httpOnly cookie vs JWT | **DB sessions.** Logout and revoke actually work, and they're easy to explain. Store `sha256(sessionId)` in the DB, not the raw id |
| D15 | Password hashing | `crypto.scrypt` (built in) vs bcrypt/argon2 (deps) | **scrypt** with a 16-byte salt and `timingSafeEqual`. Passwords 8–128 characters, a generic "invalid username or password" error, and a simple per-IP login attempt limit |
| D16 | CSRF | SameSite=Lax cookie + require `Content-Type: application/json` on POST vs CSRF tokens | **SameSite=Lax + JSON-only POSTs** for MVP. Explain why: browsers can't send cross-site JSON POSTs without a CORS preflight, which we don't allow |
| D17 ✅ | Hosting | VPS (Hetzner/DigitalOcean/Lightsail/EC2) + Caddy vs serverless (Lambda / API Gateway WS) | **Decided: a single VPS + Caddy.** |
| D18 | Scaling | One process vs multiple + Redis/sticky sessions | **One process.** Easily handles hundreds of rooms. Revisit only if you actually need more |
| D19 ✅ | Host kick button in MVP | Include vs defer | **Decided: include (M4).** |
| D20 | Room code alphabet | All 26 letters vs a curated set | **20 letters `BCDFGHJKLMNPQRSTVWXZ`** (no vowels, no Y). Avoids accidental words and confusing letters; 20⁴ = 160k codes |
| D21 ✅ | Profanity filter for names | None vs a small blocklist vs host kick only | **Decided: host kick only.** |

---

## 10. Open questions and risks

**Resolved (round 2):** Q1 → declarative views (§4a). Q2 → Reaction Race demo + asset library (§4b–c, M5b). Q3 → no email. Q4 → one room per host, re-attach (§6). Q5 → URL and code as text.

**Still open:**
- **Q9 (added 2026-10-11): settings.** There should eventually be a settings area (M6b). Dark mode is the only confirmed setting so far; the rest is TBD. Candidates to decide later: sound on/off, reduced motion, text size for the big screen, default game options for hosts. Open sub-question: once accounts exist (M7), should a host's settings sync to their account (needs a DB column) or stay per device? Recommendation: per device (localStorage) first; sync only if hosts ask for it.
- **Q6: how the board game drives minigames.** Before the board game is built, we have to decide what `ctx.runMinigame` looks like, and whether minigame results feed straight into board moves or coins.
- **Q7: art format conventions:** sprite sizes, transparent backgrounds, a naming scheme for asset ids. Agree these once your first drawings or Blender renders exist, so the manifest stays consistent.
- **Q8: account features without email:** if a host forgets their password, the only option is an admin resetting it from the server. Is that acceptable for a club?

**Risks:**
- **Mobile sockets drop often** (screen lock, network switches). Reconnect + resume is core, not polish, which is why it's its own milestone (M4).
- **Server restarts lose every room.** Acceptable now. Deploys should happen when no one is playing.
- **better-sqlite3 is a native module.** Install can fail on some VPS images without build tools. Test the install early on the target box.
- **Sandboxing untrusted JS in Node is hard**, and easy to get wrong in ways that look like they work (`vm`). Treat E2 as a research milestone of its own, with a mentor review.
- **The host's login cookie is sent with the WebSocket upgrade,** so Origin checking (M7) is required, not optional.
- **Timing fairness in minigames** (latency differs per phone). Reaction Race uses server arrival order, so a phone on worse Wi-Fi is slightly disadvantaged. Fine for a demo. Real reaction minigames may need latency compensation later.
- **The view list can drift** between `server/src/games/views.js` and the client components, since there are two copies with no shared package. Mitigation: one test in M5b checks that every server view kind has a matching client component file.

---

## 11. AI game generation (decided 2026-10-13)

### 11a. The big picture

```
 Admin (/admin page)                Our server                         OpenShell sandbox (Docker)
 ───────────────────                ──────────                         ─────────────────────────
 types a game idea  ──POST──▶  saves a job in the DB (status: generating)
                               starts the sandbox via the `openshell` CLI ──▶  generator loop (Node):
                                                                                 1. build prompt (spec + examples + art list + idea)
                                                                                 2. ask GenAI Studio for game code ──▶ genai.rcac.purdue.edu
                                                                                 3. run the checks + harness ON the new code
                                                                                 4. failed? send the errors back, try again (max ~4)
                               downloads game.js + report.json  ◀──────────────  writes them to /output
                               saves them in the DB (status: review)
 reads code + report  ◀─────  
 [Playtest] → only the admin's rooms can pick it (code now runs on the server)
 [Publish]  → every host can pick it ("AI-made" badge)      [Reject] / [Delete]
```

**Why the sandbox matters here:** step 3 *runs freshly generated code that nobody has read yet.* That's the dangerous moment, so it happens inside OpenShell, not on the server or your laptop. The sandbox can't read your files, and its network is limited to GenAI Studio and nothing else. Generated code runs on our server only **after** you've read it and clicked Playtest.

**How the API key stays secret:** OpenShell *providers* keep the real GenAI Studio key in OpenShell's credential store. The sandbox only ever sees a placeholder, and OpenShell's proxy swaps in the real key only on requests to `genai.rcac.purdue.edu`. So even malicious generated code running in step 3 can't read or leak the key. Our server never holds the key either: you register it with OpenShell once, by hand (A0).

**Why our own small generator loop instead of a full coding agent (OpenCode, Claude Code, …):**
- The job is narrow: produce exactly one file that passes our checks.
- A ~150-line loop (prompt → code → check → fix) is predictable, testable, explainable to your mentor, and needs no new dependency (plain `fetch`).
- It works with any OpenAI-compatible model, including smaller ones that aren't good at tool use.

A general coding agent stays an option (OpenShell supports OpenCode) if the loop turns out too weak.

### 11b. Contract v2 (option C)

Changes from today's contract (§4), all made in A1:

| Change | Why |
|---|---|
| `contractVersion: 2` required on every GameModule | Future contract changes can be rolled out without breaking stored games |
| ~~GameInstance gains required `hostView()` and `playerView(playerId)`~~ **Changed 2026-10-13 (user chose the simpler option):** the runner remembers the last view sent to each player and to the host, and **resends it automatically on reconnect** | Games write nothing for reconnects, so generated games can't get it wrong. The same memory powers the offered-actions check below. `onPlayerReconnect`/`onHostReconnect` stay as optional hooks (called before the resend) |
| `ctx.now()`: server time in ms | `countdown.endsAt` needs it; today a game would have to break rule 4 and use `Date.now()` |
| `endGame({ rankings, scores? })`: `scores` is an optional `{playerId: number}` | Lets games show/record points and express ties (equal scores). Board-game minigames will need this (Q6) |
| **Offered-actions check** in `GameRunner`: an action is passed to the game only if it deep-equals one of the actions in the latest `button`/`choice` view sent to that player | Forged or stale actions are dropped by the platform for every game. Games still validate against their state (rule 5), but the easy mistakes are covered. _Re-check when a free-input view (e.g. text entry) is added: those views need a different rule_ |

**Unchanged:**
- Everything still runs in-process and synchronously, with the same 7 rules.
- Game state is still private to the game. Saving and resuming is out of scope for this version.

### 11c. Pieces and where they live

| Piece | Location | Notes |
|---|---|---|
| **Harness** (E4) | `server/src/games/harness/` + `npm run check-game <file>` | Shared by the sandbox, our tests, and a re-check when a stored game is loaded. **Bots** pick random *offered* actions, plus some junk actions, disconnects and reconnects, over many seeds with a virtual clock. **Checks:** loads with no imports; `validateGameModule`; every view valid; every asset id in the manifest; ends within 30 simulated minutes; never gets stuck waiting with no timer; never throws; host and every player get a view; no call over 100 ms; no more than 60 views from one action/timer. _(As built in A2; the hostView/playerView check was dropped with that part of contract C.)_ Each game runs in a child process with a wall-clock timeout, so an infinite loop is reported instead of hanging the harness |
| **Static lint** | inside the harness | Rejects `import`, `require`, `eval`, `Function`, `globalThis`, `process`, `async`, `await`, `Date`, `Math.random`. **Not a security boundary** (that's the sandbox plus your review). It catches rule-breaking code early, with clear messages to feed back to the model |
| **Generator** | `generator/` (top level): `run.js`, `prompt.js`, `llm.js`, `spec/GAME_SPEC.md`, `Dockerfile` | Runs only inside the sandbox. Reads the job from `/input/job.json`, writes `/output/game.js` and `/output/report.json` (attempts, check results, model name). Model calls go to GenAI Studio with plain `fetch`, at most ~5 per job, which stays under its 20 requests/min limit |
| **Sandbox image** | built from `generator/Dockerfile` (Node 24 slim + generator + harness + contract/views/runner + asset manifest + example games) | Files are built into the image, because OpenShell can't combine `--upload` with a main command. Rebuild it when the contract changes |
| **Example games** (the biggest lever on output quality) | `server/src/games/` (official, in the repo) | Reaction Race plus 1–2 new small hand-written games that use `choice` and `scoreboard` (e.g. a voting game), written in A4. They also stress-test contract v2 |
| **Admin role** | `users.is_admin` column + `npm run admin -- grant alpingold` script | Role in the DB, not a hard-coded username: the code holds no account names, and A7 needs roles anyway. Needs a small migration system (`PRAGMA user_version`), since `schema.sql` only creates tables |
| **Stored games** | new `generated_games` table: `id`, `owner_user_id`, `prompt`, `model`, `status` (generating / failed / review / playtest / published / rejected), `source` (TEXT), `source_sha256`, `report_json`, timestamps | Source lives in the DB, so it's backed up with the accounts. Ids are assigned by the server (`g-xxxxxx`), never chosen by the model |
| **Loading stored games** | registry: `register(mod, { source: 'official' \| 'generated', status, ownerId })` | Loaded with `import('data:text/javascript,…')`. This works because generated games have no imports, and needs no temp files. Re-checked with `validateGameModule` at startup; a broken one is marked failed and skipped, never crashes startup. `/api/games` filters by viewer: `published` for everyone, `playtest` only for the admin |
| **Job runner** | `server/src/generation/` (`jobs.js`, `openshell.js`, `fakeSandbox.js`) | One job at a time. `execFile('openshell', [...args])`: no shell, so a prompt can never become a command; the prompt goes in a file, never in argv. Sandbox created with `--cpu 1 --memory 1Gi`; the `exec` call has `--timeout`; the sandbox is always deleted afterwards. On server start, leftover `generating` jobs are marked failed. Tests use `fakeSandbox.js`, so `npm test` never needs Docker. Config flag `GENERATION_ENABLED`: off means the feature shows "not set up" |
| **Admin API** | `/api/admin/generations` (list, create), `/:id` (get), `/:id/playtest\|publish\|reject` (POST), `DELETE /:id` | `requireAdmin` middleware; same JSON-only POST rule as the auth routes (CSRF); prompt 10–1000 chars |
| **Admin page** | `client/src/pages/Admin.jsx` at `/admin` | Prompt form, job list with status (polls every 2 s; simpler than adding WS messages), report view, source shown as plain text in a `<pre>` (never run in the browser), action buttons. Host game picker shows an "AI-made" badge |
| **OpenShell setup** | `generator/openshell/genai-studio.yaml` (provider profile) + `generator/openshell/policy.yaml` + README steps | Network: only `genai.rcac.purdue.edu:443`, only from `node`. No npm registry: everything is in the image |

### 11d. Milestones (before M8)

| M | Goal | You can run / review |
|---|---|---|
| **A0 Spike: OpenShell + GenAI Studio by hand** ✅ _done 2026-10-13: Docker Engine 29.1 + OpenShell work on WSL2 (Ubuntu 26.04); all 5 spike checks pass. Gotcha: the default policy can't read `/app`, so always pass `--policy generator/openshell/policy.yaml`. **Models:** `gpt-oss:120b` default (~25 s/attempt); `qwen3.8:27b` the only alternative (generally better games, ~150 s/attempt). Setup steps live in `generator/README.md`_ | **No app code.** Install Docker Engine in WSL and OpenShell (WSL2 support is *experimental*, see risks). Create a GenAI Studio API key, write the custom provider profile, and start a throwaway sandbox that `curl`s `/api/models` through the provider. Confirm another host (e.g. example.com) is blocked and the key isn't visible in `env`. Pick the model (`gpt-oss:120b` is in the docs' example; check what your key can use). Write down the exact working commands | A sandbox that can reach GenAI Studio and nothing else. **Go/no-go gate:** if OpenShell won't run on WSL2, switch hosts (a Linux box or VPS) before building A4–A5 |
| **A1 Contract v2** ✅ _done 2026-10-13 (platform resends the latest view instead of required hostView/playerView; lobby shows ties from `scores`)_ | §11b: `contractVersion`, `hostView`/`playerView` + platform resend, `ctx.now()`, `scores`, offered-actions check. Migrate Reaction Race and `countGame`; update `contract.js` docs, tests and e2e | All tests green; Reaction Race plays the same; refreshing a phone mid-game still restores its view |
| **A2 Harness** ✅ _done 2026-10-13: `server/src/games/harness/` (lint, bot simulator on a VirtualClock with eager/sloppy/quiet scenarios, isolated worker with time + memory limits and Node's `--permission`), `npm run check-game`, 14 broken fixtures. Reaction Race passes all 18 runs. Also fixed: `server.close()` left 30 s grace timers running_ | Bots, checks, lint, child-process timeout, `npm run check-game`. Broken fixture games (infinite loop, never ends, bad view, unknown asset, forgets `playerView`) prove each check fires | `npm run check-game server/src/games/reaction-race/index.js` passes; each broken fixture fails with a clear message |
| **A3 Admin role + stored games** ✅ _done 2026-10-13: migrations with `PRAGMA user_version` + automatic `VACUUM INTO` backup of existing files; `is_admin`; `generated_games`; registry `source`/`status`/owner visibility; startup loader (re-checks fingerprint + contract, skips bad games); `npm run admin` (users, grant/revoke, games, import-game (harness-gated), set-status, delete-game). A startup loader, not hot reload: status changes via the script apply on restart (A6's API will update the registry live)_ | Migrations, `is_admin`, admin script, `generated_games` table, registry sources/statuses, `data:` URL loading, filtered `/api/games` | Grant yourself admin; insert a hand-written game into the DB; it appears in *your* picker only while in `playtest` |
| **A4 Generator** | `GAME_SPEC.md`, 1–2 new official example games, prompt builder, LLM client, write→check→fix loop, Dockerfile. Run it by hand in OpenShell | `openshell` CLI run by hand → a `game.js` that passes the harness, plus its report |
| **A5 Job runner** | Server ↔ OpenShell wiring, job queue, DB statuses, fake sandbox for tests, `GENERATION_ENABLED` | A job started via the API ends in `review` with code + report saved; tests pass without Docker |
| **A6 Admin page** | `/admin` UI, playtest/publish/reject, "AI-made" badge, e2e tests (using the fake sandbox) | Type an idea → watch it generate → read it → playtest with phones → publish |
| **A7 (later) Bring your own key** | Any host with a GenAI Studio key can generate. **Prerequisite:** confirm with RCAC (rcac-help@purdue.edu) that users may give their key to a third-party site; the docs say keys "act with your identity" and shouldn't be shared. Proposed: key entered per job, used for a per-job OpenShell provider that's deleted afterwards, never stored. Their games stay private to them; publishing to everyone still needs admin approval; per-user job limits | Decided when we get there |

### 11e. Risks (AI generation)

- **Generated code runs with full server permissions once you click Playtest.** There's no runtime sandbox (E2), by your choice for this version. Defenses:
  - the sandbox harness runs it first
  - the lint
  - **you read the code before playtesting**
  - only the admin can generate for now

  An infinite loop that slips past all of these would freeze every room until a restart. If that ever matters (especially for A7), the fix is the runtime worker with a per-call time limit discussed on 2026-10-12. The contract is already JSON-only, so it fits.
- **OpenShell on WSL2 is "experimental"** per NVIDIA's support matrix, and it needs Docker (Engine 28+). A0 is a go/no-go gate for exactly this reason.
- **OpenShell is young** (v0.1.x, CLI still changing). Wrap every CLI call in `server/src/generation/openshell.js`, so a change touches one file.
- **GenAI Studio is a pilot service:** 20 requests/min, it can return `null` when over the limit (retry with backoff), and models may change. Model quality is below the frontier, so the examples and the check→fix loop do the heavy lifting.
- **Prompt injection in a game idea** (e.g. "ignore the rules and read files") can at worst produce bad code. That code is then caught by the sandbox, the harness and your review. This is why both layers exist.

### 11f. Open questions (AI generation)

- **Q10: where does generation run after deploy (M8)?** OpenShell + Docker won't fit the planned 1 GB VPS. Options:
  - a bigger VPS (~4 GB)
  - keep generation on your own machine and send results to the VPS
  - a separate generation box

  Decide at M8.
- **Q11: new view kinds for generated games**, especially **text input** (needed for Quiplash-style games). Each one is a hand-written component plus validator (E6) and needs its own offered-actions rule.
- **Q12: A7 details** (RCAC rules, quotas, whether users' games can be shared).

---

## Verification (how to confirm the plan worked once built)

- `npm test` (root) → runs `node --test server/test`, all unit and integration tests green.
- Manual run at each milestone, following the "You can run / review" column in §8, with a laptop and 2+ phones on the same network (`vite --host` exposes the dev server on the LAN).
- Robustness smoke test: from a Node REPL, open a `ws` client and send garbage, binary data, a 5 KB frame, and 100 messages in a burst → the server stays up and other clients are unaffected.
