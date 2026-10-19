# Block games (2026-10-11 to 10-15)

Before frame games (plan §13, 2026-10-15), a game was a JavaScript module the server ran: it
got a `ctx`, sent each screen a JSON **view** (later a tree of **blocks**), and the client drew
it with trusted components. AI games were written against that contract (v2, then v3 with a
kit of blocks). Frame games replaced all of it: each game brings its own page, in a locked-down
frame. The code is in the `block-games` branch. These are the plan's sections from then, as
they were (section numbers are the plan's).

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

## 11b. Contract v2 (option C)

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

## 12a. Why, and the goal

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

## 12b. Screens are block trees

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

## 12c. Input and actions (protocol + contract v3)

- **Action messages.** `game:action` becomes `{ action, input? }`.
  - `action` must still match an action offered on that player's current screen (the offered-actions check now walks the block tree).
  - `input` is checked **by the platform** against that block's rules: text length, slider range, choice count, rank permutation, drawing size, widget result shape and bounds.
  - Games receive `onAction(playerId, action, input)` and can trust the input's shape. They still check it against game state.
- **Drawing format.** Strokes are `[[color, [x,y, x,y, …]], …]`, with integer coordinates 0–1000 and a hard cap of about 24 KB. The WebSocket frame limit rises from 4 KB to 32 KB, still rate-limited.
- **`contractVersion: 3`** is required from K1 on (screens). v2 games are no longer accepted. K2–K3 add to v3 without another bump while we're in development.
- **Bots.** Each block definition includes a way for bots to produce random valid input (words for text, scribbles for drawings, random reaction times, …). The harness plays every block automatically, and new blocks are tested for free.

## 12d. One definition per block → checks, bots, docs

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

## 12f. Better examples (the biggest lever, again)

**Official example games, rewritten or added on v3:**
- **Reaction Race** moves to the `reaction` widget, so reaction times are fair.
- A new **drawing game**, "Sketch & Guess": one player draws, others type guesses.
- A new **text game**: write answers, vote for the funniest.

**Acceptance ideas for generation:** your **drawing game** and **reflex game** ideas, plus a few others. They're re-run on both models, and the results go in a table like §11g.

## 12g. Later (not in K1–K6)

- **Party mode / minigames (option 3).** A hand-written board game that runs picked games as minigames (`ctx.runMinigame`, Q6). Games declare an optional `tags` field (e.g. `minigame`, `drawing`, `reflex`) so the catalogue can filter by mode.
- **Editing code by hand** on the admin page (a new version, re-tested in the sandbox before review).
- **More widgets:** tilt/shake (iOS asks permission for motion sensors), sounds, a "hold" button, a word picker.
- **Free-form client code** in a cross-origin sandboxed iframe, only if the kit proves too limiting (see 12a). _Being explored on branch `iframe-games`: §13._

## 12h. Milestones (before M8)

| M | Goal | You can run / review |
|---|---|---|
| **K1 Screens + layout/display blocks** ✅ _done 2026-10-14: `server/src/games/kit/` (schema helper, 13 block definitions, screen checks with exact error paths, player-id check, generated block reference in the AI prompt); `contractVersion: 3`; the 5 views are gone; Reaction Race and Majority Rules rebuilt from blocks (timer bar, answer breakdown bars, cards); client renderer in `client/src/game/blocks/`; big and huge text are headings; the big screen uses the full TV width during games. The kit reference (part of K4) was pulled forward so the generator works on v3 right away. Stored v2 AI games no longer load: delete or regenerate them_ | Kit folder and schema helper; screens replace the 5 views (`contractVersion: 3`); layout and display blocks, plus `button` and single `choice` as blocks; recursive client renderer with fixed styling words; size and depth limits; official games, fixtures, harness and AI spec moved to screens; sync test | A hand-written test game shows a combined screen (title + timer bar + scoreboard) on phones and the big screen |
| **K2 Input blocks + contract v3** ✅ _done 2026-10-14: `textInput`, `multiChoice` (a separate block, not a `multi` flag on `choice`: clearer for the AI, since a multi-pick sends one action plus the ticked indexes), `slider`, `rank`; `game:action { action, input }`; each block's `input.read` checks and cleans the value (trim + NFC, no control characters, snapped slider steps, sorted picks) before `onAction(id, action, input)`; buttons and choices must send no input; bots fill every input block with valid values, and the sloppy scenario also sends real actions with junk values, which must never reach the game. The 32 KB frame limit moves to K3, where drawings need it: the K2 inputs fit in 4 KB_ | `{ action, input }` protocol; platform input checks; `onAction(id, action, input)`; offered-actions check over block trees; `textInput`, multi `choice`, `slider`, `rank`; bots make inputs; frame limit to 32 KB | Type, slide and rank on a phone; the game gets checked input; bad input is dropped |
| **K3 Widgets** ✅ _done 2026-10-14: `reaction` (goAt; phone measures ms; `{ early: true }` for false starts; rejected if it arrives before GO on the server clock), `mash`, `timingBar`, `tapTargets` (seeded spots, same on every phone), `drawPad` + `drawing` (strokes on a 1000 × 750 canvas, palette names, ≤ 1500 points ≈ 10–15 KB, white paper in dark mode too). Widgets have their own `widget` group in the reference. Limits: client frames 32 KB, screens 96 KB (galleries of drawings; the plan said 64). Input checks now get the arrival time (`context.now`)_ | `reaction`, `mash`, `timingBar`, `tapTargets`, `drawPad` + `drawing`; local timing with the clock offset; bounds checks; bot inputs | Each widget playable on a phone; drawings show on the big screen |
| **K4 Kit reference + `/kit` page + examples** ✅ _done 2026-10-14: `GET /api/kit` (the catalog, built from the block definitions; the AI's markdown reference is built from the same catalog, so no separate KIT.md file) and a public `/kit` page with live previews; Reaction Race on the `reaction` widget (fastest time wins, all times listed); new official games **Sketch & Guess** (drawPad + guesses) and **Fill the Blank** (write, then vote). The harness caught two real limits while writing them: `choice` now allows 12 options (one per other player), and big reveals must stay under 60 blocks_ | `KIT.md` generated from the definitions; public `/kit` playground; Reaction Race on `reaction`; Sketch & Guess; the text-answers game; e2e tests | Open `/kit` and try every block; play the new examples with phones |
| **K5 Generator on v3** ✅ _done 2026-10-14: examples are Reaction Race, Sketch & Guess and Fill the Blank (Majority Rules left out to keep the prompt ~15k tokens); the spec gains "Make it a real party game", players' input, widget timing and 12-player limits; the reference warns that widgets restart on a new screen. The comparison (§12j) found a platform bug (12-drawing galleries were over the 96 KB screen limit; now 256 KB, and bots draw full-ink drawings) and two spec gaps (late widget results, answers leaked by a slider)_ | Prompt built from `KIT.md` + new examples; spec rewritten for v3; re-run the comparison with the drawing and reflex ideas | `npm run generate` makes a drawing game and a reflex game that pass and are fun |
| **K6 Versions + change requests** ✅ _done 2026-10-14: migration 4 (`game_versions`; existing games become v1, live as they were; "rejected" = nothing live); a game has a published version (everyone, runs as `g-…`) and a playtest version (owner only, runs as `g-…-vN`) side by side (Q14); "ask for changes" sends the original idea, earlier requests, the base version's code and the request, and the model answers with a `CHANGES:` list plus the full file; the admin page shows each version's request, changelog, test report and changed lines (hand-written LCS line diff in `server/src/generation/lineDiff.js`); publishing swaps versions only once the new one has loaded; `npm run admin -- set-live` replaces `set-status`_ | `game_versions` migration; revision jobs (current code + request); version history, changelog, changed-lines view; playtest/publish a version; rollback | Ask a game for a change → new version in review → playtest it → publish it; old version restorable |

## 12i. Risks and open questions

- **Prompt size.** The kit reference plus 3–4 example games is a much longer prompt. That's fine for both models' context windows, but slower. Keep `KIT.md` tight and pick examples carefully.
- **More surface to review.** Inputs are where cheating and junk come from, which is why the platform validates them, not each game.
- **Phone performance.** Drawing pads and fast widgets on cheap phones. Keep widgets simple (canvas, no libraries) and test on a real low-end phone.
- **Q13 (decided in K4):** `/kit` is public. It's documentation and shows off the platform, and it contains nothing secret.
- **Q14 (decided 2026-10-14): yes.** Other hosts keep the published version while you playtest a newer one; your game picker shows both ("Silly Sketch" and "Silly Sketch (AI-made, v3 playtest)").

## 13k. What's removed on this branch

- **Server:** `GameRunner.js`, `contract.js`, `kit/`, `harness/`, the four block games, `game:action`, `/api/kit`. Also the screen-size and widget settings in `config.js`.
- **Client:** `game/blocks/`, `GameScreen.jsx`, the `/kit` page and its link from the home page.
- **Generator:** its prompt, spec and examples are written for blocks. **Generation is switched off on the branch until F5** ("not available for frame games yet"). The admin page, versions, diffs and the sandbox stay.
- **Stored AI games** (Silly Sketch, Reflex Frenzy) are block games. They fail their load check and are skipped. They aren't deleted, so `main` can still run them from the same database.
- **No database changes in F0.**
