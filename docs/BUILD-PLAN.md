# Build plan

Written 2026-11-16 for whoever builds the rewrite next, human or agent. It assumes you have read
nothing else. Milestone 1 is planned step by step and can be built from this file. Milestones 2 to 4
are outlined, and each begins with a design session with the owner that this plan does not replace.

## Read these first, in this order

1. `docs/SPEC.md`: what the site is, the four milestones, and every decision in force.
2. `GLOSSARY.md`: the words. Use them exactly (Room, Screen, Seat, Controller, Match, View, Part,
   Action, Step, Engine, Game frame...) in code, tests, comments and commit messages, and avoid the
   words listed under each "_Avoid_".
3. `docs/adr/0003` to `0006`: why Games are typed functions in a worker, why the Screen is the
   referee, and why the SDK looks the way it does.
4. The three design files, which are the contract and are already agreed with the owner:
   - `sdk/src/v1/game.ts`: the shape of a Game.
   - `sdk/src/v1/kit.ts`: every Part a View can hold.
   - `protocol/src/messages.ts`: every message between the Screen, the server and the phones.
   - `sdk/src/v1/best-word.fixture.ts` is a whole Game written against the contract ("Best Word",
     the test Game); `sdk/src/v1/game.test.ts` tries the contract on it.

## Rules

- **The contract files are settled.** If building shows that one of them is wrong or missing
  something, stop and tell the owner what you found and what you'd change. Don't work around it and
  don't change it silently. Adding an internal helper is fine; changing what a Game author or a
  message looks like is not.
- **Dependencies.** Approved for this plan: `zod` (installed), `ws`, `express` (5), their `@types`,
  and `@playwright/test`. Anything else needs the owner's yes first. `sdk` must keep zero
  dependencies: it is bundled into every Game.
- **Commits.** The owner's standing rule is "commit only when asked". This plan is that ask for
  milestone 1: one commit per finished step, on branch `rewrite`, in the style of `git log`
  (a sentence saying what is now true). Never push, force-push or rebase. Never commit `.claude/`,
  `CLAUDE.md` or `.scratch/`.
- **Done means checked.** A step is finished when `npm run typecheck`, `npm run build` and
  `npm test` pass from the root and its "Done when" list holds. Say plainly what you could not check.
- **Tests check behaviour, not insides.** A test should survive a rewrite of the module that keeps
  what it does. Don't test private functions or internal fields.
- **AWS.** Don't create, change or inspect anything in AWS on your own. Step 9 is done with the
  owner present.
- **Other repositories.** `~/slopProjects/boilergamesretry` is an earlier experiment by the owner.
  You may read it for evidence where this plan points at it. Don't copy its code (this design
  differs on purpose), don't deploy it, and don't read its `.env.local` or `signin.local/`.
  `../practice-old` is the first site; nothing from it is carried over.
- **Explain as you go.** The owner is a first-year student who has to defend this design to a
  mentor. Comments say why, in plain words. Report what you built and what you decided.

## Where things stand

Branch `rewrite`. Four npm workspace packages, each a folder at the root:

| Package    | Holds                                                    | State                              |
| ---------- | -------------------------------------------------------- | ---------------------------------- |
| `sdk`      | The Game contract, the Kit, and (to build) the Engine    | Types and one test Game            |
| `protocol` | The room messages and their Zod schemas                  | Complete for milestone 1, tested   |
| `server`   | The one server process                                   | Placeholder that answers over HTTP |
| `client`   | The site's pages (React, Vite)                           | Placeholder page                   |

Packages import each other's TypeScript source through the `@boilergames/source` export condition
(see `tsconfig.base.json`), so nothing needs building before a type check or a test. Relative
imports end in `.js`. Node 24.

The tickets in `.scratch/rewrite/issues/` describe an older plan. Ignore them.

---

# Milestone 1: a Room plays a Match on real phones

The goal: a Host opens the deployed site on a laptop, friends join on their phones with a Room Code,
and they play an Official game to its end. Covers stories 1 to 14 of the spec.

How the pieces fit:

```
phone ──ws──┐                       ┌── Screen page (site's own code)
phone ──ws──┼── server (Rooms) ──ws─┤     draws the Screen's View with the Kit
phone ──ws──┘   passes messages     │     saves the Match in localStorage
                                    └── hidden Game frame (other origin, sandboxed)
                                          └── Web Worker: the Engine + the Game
```

Build the steps in order. Steps 1 to 3 need no browser and no server. Steps 5 and 6 don't depend on
each other.

## Step 0: commit the design

Commit what is in the working tree now (the four-package workspace, the contract drafts, the
rewritten docs) as one commit, after confirming the three checks pass.

## Step 1: check a View, and check an Action against it (`sdk`)

A View comes from a stranger's Game, and an Action comes from a stranger's phone. Both are `unknown`
until checked. Write the checks by hand (no Zod here: `sdk` has no dependencies).

- `sdk/src/v1/validate.ts`:
  - `checkControllerView(value: unknown): { ok: true; view: ControllerView<unknown> } | { ok: false; problems: string[] }`
    and `checkScreenView` likewise. Each problem names where it is, in words a Game author can act
    on: `parts[2].action: a button needs an action with a "type"`.
  - `checkLook(value: unknown)` likewise.
  - Unknown `kind`s, unknown `shape`s and unknown fields are problems. Screen views may hold no Part
    that sends an Action, and no shape with an `action`.
  - Limits, exported as named constants: 100 Parts per View (a row's Parts count), 2,000 characters
    per text, 2,000 shapes per Picture; 500 for a text box's `maxLength`; 200 strokes and 2,000 points per Drawing, whole numbers from 0 to 1000 (changed from 5,000 any-number points so Drawings fit in messages); numbers must be finite; a `path`'s
    `d` may hold only path letters, digits, spaces and `.,-+eE`, at most 2,000 characters; colours
    must be `#rgb` or `#rrggbb` or one of the Look's four names.
- `sdk/src/v1/offers.ts`:
  - `offers(view: ControllerView<unknown>, action: unknown): boolean`. True when the View holds an
    enabled button or a tappable shape whose `action` deep-equals it; or a text box whose `action`
    equals it once its `text` is removed, with `text` a non-blank string within `maxLength`; or a
    drawing pad whose `action` equals it once its `drawing` is removed, with `drawing` a valid
    Drawing of at least one stroke.
  - `availableActions(view)`: every Action the View offers, with text boxes and drawing pads
    returned as templates to fill in. The simulator (step 3) uses it.

Done when:
- Every Part and shape in `kit.ts` has a test where a valid one passes and a broken one is refused
  with a problem that names it.
- A type-level test proves the checker accepts exactly what `kit.ts` describes: every View in
  `game.test.ts` passes, and a value typed as `ControllerView<Action>` needs no cast to be checked.
  (Built: `sdk/src/v1/validate.ts`, `offers.ts`, `look.ts`, exported from `@boilergames/sdk/v1/check`.)
- `offers` is tested for each kind of input, including the refusals: an Action the View doesn't
  hold, a disabled button, text that is too long or blank, an empty drawing.

## Step 2: the Engine (`sdk`)

The one piece of code that runs a Match. It knows nothing about browsers, sockets or real time: it
is called with events and returns what happened. The browser (step 4), the simulator (step 3) and
later the Playtest all use this same code, so the rules of a Match have one definition.

- `sdk/src/v1/rng.ts`: a seeded generator that implements the `Rng` interface and can report and
  restore its internal state as plain data (a Match is saved mid-game). Any small, well-known
  algorithm (for example sfc32 or mulberry32). Same seed, same sequence, on every machine.
- `sdk/src/v1/engine.ts`. Suggested shape; adjust names if something reads better, but keep the
  behaviour:

  As built, starting or resuming can be refused (wrong Player count, a damaged save) and its first
  Step can set the timer or break, so both return `Begun` instead of a bare `Match`:

  ```ts
  startMatch(game, { players, seed }): Begun          // calls game.start
  resumeMatch(game, snapshot: unknown): Begun         // from a saved Match
  type Begun = { ok: true; match: Match; outcome: Outcome } | { ok: false; why: string }
  interface Match {
    act(playerId: string, action: unknown): Outcome   // a Player used their Controller
    timerFired(): Outcome                             // the host's real timer ran out
    setPlayers(players: readonly Player[]): Outcome   // the Room's Seats changed
    views(): { screen: ScreenView; controllers: Record<string, ControllerView<unknown>> }
    snapshot(): MatchSnapshot                         // plain data: state, rng state, players, timer running?, ended?
  }
  type Outcome =
    | { status: "running"; timer?: number | null }    // timer: start (ms), stop (null), or unchanged (absent)
    | { status: "ignored"; why: string }              // nothing changed
    | { status: "ended"; reason: "finished" | "tooFewPlayers"; end: MatchEnd }
    | { status: "broken"; problem: string }           // the Game did something invalid
  ```

- The rules:
  - `players` are `{ id, name }` with `id` the Seat's id. `startMatch` refuses a Player count outside
    `about.players` (and above 16).
  - `act` is ignored unless the Player is in the Match and `offers(theirCurrentView, action)`.
  - `setPlayers` compares the new list with the Match's. For each Player gone, in order: remove them,
    then call `onLeave`. If the count is then below `about.players.min`, the Match ends with
    `tooFewPlayers`. For each new Player: if the Game has `onJoin` and there is room under
    `about.players.max`, add them and call `onJoin`; otherwise leave them out (they wait for the next
    Match and get no View). A renamed Player is not an event.
  - `timerFired` is ignored when the timer isn't running. It marks the timer stopped, then calls
    `onTimer`. A Game that started a timer but has no `onTimer` is broken.
  - After every Step the Engine builds all Views and checks them with step 1's checkers. `ctx.players`
    and the `players` argument of the view functions are always the Engine's own list.
  - Broken means: a Game function throws; a Step isn't `{ state, timer?, end? }` with a valid timer
    (a finite number from 0 to 24 hours, or null) and a valid `end` (scores and winners keyed by
    Players in the Match); the state doesn't survive `JSON.parse(JSON.stringify(state))` unchanged,
    or is over 1 MB as JSON (`MAX_STATE_BYTES`; first 256 KB, raised so a round of drawings fits);
    a View fails its check, or a Controller View is over 128 KB as JSON (`MAX_VIEW_BYTES`: it must
    fit in one message to a phone), or the Screen's View is over 1 MB. An object field set to
    `undefined` in the state is not broken: JSON drops it, and the Engine keeps only its JSON copy. The problem says which function and what was
    wrong, in words a Game author can act on.
  - Once ended or broken, every call is ignored.
  - The Engine never reads a clock and never calls `Math.random`.
  - It cannot stop a Game that loops forever. Whoever hosts it does (steps 3 and 4).
- Export the Engine from a second entry point, `@boilergames/sdk/v1/engine`, not from the entry
  point Games import. A Game must not be able to import the Engine.

Done when:
- The test Game (Best Word, in `best-word.fixture.ts`) plays a whole Match through the Engine, including a timer
  running out, a Player leaving mid-phase, and a save and resume in the middle that continues
  exactly as an unsaved Match with the same seed would.
- Each way of being broken has a test with a small deliberately bad Game, and the problem text
  names the function.
- Each `setPlayers` rule has a test: leave, leave below the minimum, late join with and without
  `onJoin`, late join when full.

## Step 3: the simulator (`sdk`)

Plays a Game to its end with made-up Players, to find Games that crash or never finish. It is the
test harness for Official games now and the heart of the Playtest in milestone 2.

- `sdk/src/v1/simulate.ts`, exported from `@boilergames/sdk/v1/engine`:
  `simulate(game, { players: number, seed: number, leavers?: number, joiners?: number }): { ok: boolean; problems: string[]; steps: number }`.
- Each simulated Player, when chosen, picks one of `availableActions(theirView)` at random (seeded,
  separately from the Match's own seed), typing short text into text boxes and scribbling on
  drawing pads. When no Player has anything to do, or at random now and then, the simulated clock
  runs the timer out. With `leavers`, that many Players leave at random moments. With `joiners`,
  that many more arrive during the Match: a Game with `onJoin` takes them in while it has room, and
  they then count like any other Player; otherwise they wait, which is no problem.
- Problems it reports: the Match is broken (with the Engine's problem); the Match doesn't end within
  5,000 events; nobody has anything to do and no timer is running (the Match is stuck); some Player
  was never offered an Action in the whole Match.
- It reports every problem it can find in a run, not only the first.
- As built: leavers leave and joiners arrive at random moments within the first 2 × (leavers +
  joiners) events, and the simulated clock runs the timer out at random only once they have all come
  and gone (it still does whenever nobody else can act), so even a short Match sees them. A leaver
  is always a Player in the Match, never a joiner still waiting. A joiner left waiting gets in if a
  later leaver makes room. A Match that ends because too few Players are left, or that breaks,
  skips the "never offered" check: those still there may not have had their turn yet. A joiner taken
  in is checked like everyone else, which flags a Game that lets newcomers sit out until the next
  round and then has no next round. Whether that is a false alarm is open with the owner.

Done when:
- The test Game passes with its fewest Players, its most, and its most with leavers, for several
  seeds, and the same seeds always give the same result.
- A stuck Game, an endless Game and a Game that ignores one Player are each caught, with a problem
  a Game author can act on.

## Step 4: the Game frame (`client`, plus a second origin on the `server`)

Runs the Engine and one Game in the Host's browser where the Game can reach nothing.

- The frame's page: one small static HTML file per SDK version, `frame/v1/index.html`, with one
  script. The script holds the Engine and a worker bootstrap as text. When the Screen sends a Game's
  bundle (a string of JavaScript), the script builds one Blob from bootstrap + Engine + bundle,
  starts a Worker from that Blob's URL, and from then on only passes messages between the Screen and
  the Worker. Nothing is ever evaluated with `eval` or `new Function`.
- The worker's script runs in strict mode (`"use strict"` first in the Blob). The Engine freezes the
  state it hands a Game, and only strict code throws when a Game changes it; sloppy code would
  silently ignore the change, and the Game would go on believing it happened.
- The Screen embeds it as `<iframe sandbox="allow-scripts" hidden>`. Never `allow-same-origin`.
- It is served from a different origin than the site: in development a second port (the site on
  3000, the frame on 3001); in production the game domain (ADR 0004). The response carries a
  Content-Security-Policy header. Start from this, and tighten rather than loosen:
  `default-src 'none'; script-src 'self'; worker-src blob:; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; webrtc 'block'; sandbox allow-scripts; frame-ancestors <the site's origin>`.
  The experiment met browser differences here (WebKit and `'self'` inside an opaque origin); its
  notes are in `~/slopProjects/boilergamesretry/packages/game-origin/src/content-security-policy.ts`.
- Messages between the Screen page and the frame, as types in `sdk/src/v1/frame-messages.ts`:
  - To the frame: `start { bundle, players, seed }`, `resume { bundle, snapshot }`,
    `act { playerId, action }`, `timerFired`, `setPlayers { players }`.
  - From the frame: `ready` (once, when the page has loaded), then exactly one reply per message
    received: `result { outcome, views, snapshot }`, or, for `start` and `resume`, `couldNotStart
    { why }` carrying `Begun`'s `why` when the Engine refused to begin (a Player count the Game
    doesn't allow, a damaged save). The Screen then stays in the Lobby and says why.
- A Game bundle is one classic script that assigns the Game to a known global. Step 5 builds them.
- `client/src/screen/game-frame.ts`: the Screen's side, a small class that owns the iframe.
  - It accepts a message only if `event.source` is its iframe's window, and treats everything in it
    as untrusted: it re-checks every View with step 1's checkers before the Screen uses it.
  - It owns the real timer: on `timer: ms` it sets a timeout and remembers the deadline; on `null` it
    clears it; when it fires it sends `timerFired`.
  - If a reply doesn't arrive within 2 seconds, the Match is broken ("the Game stopped responding"):
    it removes the iframe, which kills the worker.
  - It sends one message at a time and queues the rest, so replies can't be mismatched.

- As built:
  - `frame-messages.ts` also holds `readFrameReply`, which the Screen uses to read every reply as
    untrusted: the outcome, the snapshot (Players must be ones the Screen sent; at most 2 MB as
    JSON) and the Views (checked, sized, and only for Players the Screen sent). Views are checked
    against every Player sent, not only those still in the Match, because a Match that ends keeps
    its last Views, which can include a Player who just left.
  - A frame page script can't be a module: module scripts are fetched with CORS, which the frame's
    opaque origin fails. `client/vite.frame.config.ts` builds `frame.js` as a classic script, with
    the worker bootstrap and the Engine built into it as a string, into `client/dist/frame/v1/`.
  - The frame forwards only the worker's first reply to each message and drops anything unasked.
    If the Game's code fails to load (a syntax error, a top-level throw, no Game on the global),
    the reply to `start` or `resume` is `couldNotStart`, not a two-second wait.
  - The GameFrame gives the frame page 15 seconds to load (it comes over the network) and 2 seconds
    per reply. A frame that fails either way, or sends a reply `readFrameReply` refuses, ends as
    `failed` and is removed. So is a frame whose Match ended or broke: it has nothing left to do.
  - The frame server is plain `node:http` (`server/src/frame-origin.ts`): two files and no API need
    no framework. Every response, 404s included, carries the CSP. `main.ts` starts it on the next
    port up.
  - The browser tests are in `e2e/` at the root (`npm run test:e2e`). They build the frame, a test
    Screen page and the test bundles, and serve them on three origins: the site
    (`localhost:4100`), the real frame server (`127.0.0.1:4101`), and an "outside address"
    (`127.0.0.1:4102`). Site and frame are on different hosts, so they are different sites, as in
    production. The site and outside servers count every request, so "blocked" is proved on the
    server, not taken from the browser's error.
  - Every browser test runs in a fresh profile and in a saved one (`e2e/fixtures.ts`): six
    Playwright projects. In a saved profile only, WebKit gave the hostile Game a working cache store
    shared by every Game on the site. So the frame now empties that store before each Game loads,
    and the worker's bootstrap removes `caches`, `CacheStorage`, `Cache`, `Worker` and
    `BroadcastChannel` before the Game's code runs. ADR 0004 says which walls are the browser's and
    which are ours, and why each of these is removed.
  - A second test Game, `e2e/games/hoarder.ts`, tries to leave data in every store and channel a
    worker has, and to find it from another Game: side by side, one after the other, and after a
    browser restart. Nothing may be left, and nothing found.
  - In Firefox, `navigator.storage.estimate()` and `persisted()` never return in the frame's worker:
    the worker freezes and the 2-second rule ends the Match. Only the Game that asked is hurt.

Done when:
- A Playwright test (Chromium, Firefox and WebKit) plays the test Game through a real frame.
- A Playwright test in the same three browsers loads a hostile bundle that tries, from inside the
  worker, to: `fetch` and `XMLHttpRequest` the site and an outside address, open a `WebSocket` and an
  `EventSource`, `importScripts` a remote file, `navigator.sendBeacon`, use `RTCPeerConnection`, read
  `indexedDB`, `caches` and cookies, and loop forever. Every attempt fails, the loop is caught by the
  2-second rule, and the Screen page keeps working.
- Say plainly in your report which of these each browser blocked by which wall, and anything that
  behaved differently from what this plan expects.

## Step 5: Official games (`games`, a new package)

Add a fifth workspace package, `games`, that depends only on `sdk`.

- Three small, original Games, one folder each, each exporting `defineGame(...)` as its default.
  Between them they must use every Part in the Kit:
  1. A writing and voting game (the test Game "Best Word" can grow into this).
  2. A drawing game: uses `drawingPad` and `drawing`, and keeps something secret on each phone.
  3. A board game played by tapping a `picture` on the phone, with the board shown as a `picture` on
     the Screen. It should take late joiners (`onJoin`), so that path is exercised.
- Original names and rules. Don't copy commercial party games. Each has its own `look`.
- Each Game has a test that runs `simulate` with its fewest Players, its most, with leavers, and
  with joiners.
- A build script produces, for each Game, one self-contained classic-script bundle (the Game and the
  `sdk` code it imports, nothing else) plus a `games.json` listing `id`, `title`, `players`, `look`.
  Use Vite's library mode, which is already installed. If that can't make a single classic script,
  stop and ask the owner about adding `esbuild`.

Done when: all three pass their simulator tests, and each bundle plays in the real frame (extend
step 4's Playwright test to load each built bundle).

## Step 6: Rooms (`server`)

The server keeps Rooms and Seats and passes messages. It never reads a View or an Action.

- Two layers, as the spec says:
  - `rooms`: plain code with no sockets. It is given a `send(connectionId, message)` function and a
    clock, and is told "this connection sent this message" and "this connection closed". All the
    rules live here.
  - `transport`: `ws` sockets. Parses each message as JSON, checks it against the schema for its
    side (`screenToServer` or `phoneToServer`), and hands it to `rooms`. A message that fails gets
    `refused: badMessage`; it never throws. `maxPayload` is `MAX_MESSAGE_BYTES`.
- One WebSocket path. A socket's first message says what it is: `openRoom` or `resumeRoom` makes it a
  Screen; `join` or `rejoin` makes it a phone. Anything else first is refused and the socket closed.
- The rules (name every number as a constant):
  - Room Codes: four letters from A–Z without I and O, random, unique among live Rooms.
  - Tokens: 32 hex characters from `crypto.randomBytes`. A Seat's token goes only to its phone, the
    host token only to the Screen. Compare tokens in constant time.
  - A Room holds at most 16 Seats (`roomFull`). Names are trimmed; a name already in the Room gets
    " (2)", " (3)"... added by the server.
  - Every change to a Room sends the whole `room` to the Screen and to every connected phone.
  - A phone that disconnects keeps its Seat with `connected: false` for 90 seconds, then loses it.
    `leave` and `removeSeat` take the Seat at once. `rejoin` with the right token takes it back and
    closes any older socket for that Seat.
  - A Screen that disconnects leaves the Room open with `screenConnected: false` for 5 minutes, then
    the Room closes with `screenGone`. `resumeRoom` with the right host token takes it back.
  - `startMatch` records the Match and forgets every cached View. `views` stores each Seat's View and
    the time the timer will run out by the server's clock, then sends each connected phone its own
    View with the milliseconds left. A phone that connects or rejoins during a Match is sent its
    cached View, if it has one, with the milliseconds left now. `endMatch` clears the Match, forgets
    the Views and records `lastMatch`.
  - A phone's `action` is passed to the Screen with its Seat's id, only while a Match is running and
    the Screen is connected. Otherwise it is dropped silently.
  - Limits from day one: a phone's socket may send `PHONE_MESSAGES_PER_SECOND` (20) messages a
    second, the Screen's `SCREEN_MESSAGES_PER_SECOND` (100); more gets `tooFast`, then the socket
    is closed if it continues. Both are constants in the protocol package. The Screen's is higher
    because it splits Views across `views` messages (step 7): one event with 16 large Views can be 16
    messages, and a resume sends every View at once. The Screen does not space its messages out.
    Each address may try `join` or `rejoin` 10 times a minute.
- HTTP, with Express: serves the built client; `GET /api/games` returns `games.json`;
  `GET /api/games/:id/bundle.js` returns a bundle. On the second port (or the game domain) it serves
  only the frame's files, with the header from step 4.

Done when:
- The `rooms` layer has tests, using a fake `send` and a fake clock, for every rule above, including
  the races: a phone rejoining while its old socket is still open, a Seat removed while its phone is
  reconnecting, the Screen resuming while phones are mid-reconnect, `views` arriving for a Seat that
  just left.
- One test starts the whole server in-process and plays a join, a View and an Action over real
  WebSockets and real HTTP.

## Step 7: the Kit renderer and the pages (`client`)

Bare, working pages. No visual design yet beyond a Game's own Look.

- `client/src/kit/`: one React component per Part, and `<View>` that draws a checked View.
  - The Look, filled in with `withDefaults` from `@boilergames/sdk/v1/check`, becomes CSS variables
    on the View's root. Button text is black or white, whichever has the higher `contrastRatio`
    with the accent (always at least 4.58 to 1), so a Game can't make an unreadable button.
  - `picture` is drawn as SVG built with React elements, one fixed element per shape with only the
    fields `kit.ts` lists. Never `dangerouslySetInnerHTML`, and never a prop spread from Game data.
  - `timer` counts down from a deadline the page keeps (milliseconds left, measured from when the
    message arrived).
  - `drawingPad` records strokes in the 1000-by-1000 square whatever the phone's size, and stays
    within the Drawing limits from step 1: it rounds every point to a whole number, skips a point
    that rounds to the same place as the one before, and when a Drawing nears 2,000 points it thins
    the strokes (keeping every other point) rather than refusing more ink.
  - `playerList` and `scoreboard` get names from the Room's Seats, by id.
  - Parts that send an Action call one `onAction(action)` callback. On the Screen it is absent.
- Pages:
  - `/`: "Host a Room" and "Join a Room".
  - `/screen`: the Lobby (the Room Code, large; the Seats; the list of Games from `/api/games`, with
    those the current Player count doesn't fit disabled; Start), the Match (the Screen's View,
    filling the page, and a Stop button), and the result (winners or scores if the Match had them,
    and why it ended).
  - `/play`: enter a Room Code and a name, then the Lobby ("you're in"), then the Controller.
    A latecomer with no View sees "You're in from the next Match". While the Screen is away it shows
    "Waiting for the Screen". It asks for a screen wake lock during a Match.
- The Screen page ties it together:
  - On every `room` message it calls the frame's `setPlayers` with the connected-or-not Seats (a
    Seat that is only disconnected is still a Player; one that is gone has left).
  - After every result from the frame it draws the Screen's View, sends `views` with only the Views
    that changed since the last send, and saves `{ code, hostToken, gameId, snapshot, timerDeadline }`
    in `localStorage`.
  - It packs as many Views into each `views` message as fit under `MAX_MESSAGE_BYTES` (256 KB),
    measured as UTF-8 JSON, and starts another message only when the next View won't fit. So an
    ordinary event is one message, and only large Views (drawings) take several. Each Controller
    View is at most `MAX_VIEW_BYTES` (128 KB), so one View always fits in a message of its own; the
    protocol needs no change, because `views` already carries only some Seats. Every message of a
    batch carries the same `timerMs`, and they all go at once: the Screen's socket allows
    `SCREEN_MESSAGES_PER_SECOND` (step 6).
  - On load, if a saved Room exists it sends `resumeRoom`; if a saved Match exists it fetches the
    bundle, resumes the frame from the snapshot, restarts the timer from the saved deadline (firing
    at once if it has passed) and sends every View again. If the server says `noSuchRoom` or
    `badToken`, it clears what it saved.
  - An `action` from the server is passed to the frame as `act`.
  - `ended` or `broken` from the frame sends `endMatch` and returns to the Lobby.
- The phone keeps `{ code, seatToken }` in `localStorage` and sends `rejoin` on load and whenever its
  socket reconnects. Both pages reconnect on their own, waiting a little longer each time.
- Both pages check every message from the server against `serverToScreen` or `serverToPhone`, and
  the phone checks every View with step 1's checker before drawing it.

Done when:
- Each Part has a render test, and `picture` has one proving that a shape carrying unexpected fields
  renders none of them.
- Playwright, with one Screen and three phones in separate browser contexts: play each Official game
  to its end; reload the Screen mid-Match and carry on; reload a phone and keep its Seat and View;
  remove a Player; a latecomer joins the late-join Game and plays, and joins another and waits;
  stop a Match.
- A test of the Screen's sending, without a browser: Views for 16 Seats at nearly `MAX_VIEW_BYTES`
  each go out as several `views` messages, none over `MAX_MESSAGE_BYTES`, each Seat's View in
  exactly one of them, and every message passes the `screenToServer` schema; 16 ordinary Views go
  out as one message.

## Step 8: tidy

Update `README.md` (packages, commands, how to run a Room locally with phones on the same network).
Make CI run the Playwright tests. Re-read `docs/SPEC.md` and the ADRs against what was built and
list, for the owner, anything that no longer matches.

## Step 9: deploy, with the owner

Not to be done alone. With the owner present: a small EC2 instance in the AWS project (us-east-2),
Caddy for HTTPS on the site's domain and the game domain, the server under systemd as its own user,
and `update.sh` (build, test, switch, roll back on failure). Load the project's `aws-project-rules`
skill before any AWS work. The old site stays on `main` until the owner decides otherwise.

Checks with the owner:
- Real Safari, on an iPhone and on a Mac: a Match plays through the frame, and the hostile and
  hoarding test Games find every wall in place (ADR 0004). The browser tests only ever ran
  Playwright's WebKit on Linux, and WebKit is where the storage walls differed.

---

# After milestone 1

Each milestone below starts with a design session between the owner and whoever builds it. The
bullets are the direction the spec sets, not a design.

## Milestone 2: Uploads

- **Design first, with the owner:** the data model (accounts, sessions, Games, Versions, what a
  Version may do next) and whether Drizzle stays (ADR 0002 is still "proposed").
- Sign-in by emailed link, behind an interface so tests record the link. Purdue verification.
- The Playtest: strict `tsc` on the uploaded file, a bundle that can import only the SDK, then
  `simulate` with the fewest Players, the most, the most with leavers, and the fewest with joiners
  (so a Game's `onJoin` runs before real people play it), in a child process with
  no network and tight time and memory limits. How to take the network away on the server (a
  network namespace, a systemd sandbox, Node's permission flags) must be tried and attacked before
  it is trusted.
- Upload a Game, see its Versions, play it privately with real phones, publish and unpublish it.
- The Library and each Game's page. A page with the SDK's types and a ready-made prompt for
  Creators using their own AI.
- Limits on Uploads and sign-in emails. The privacy page.

## Milestone 3: the AI

- **Design first, with the owner:** the pipeline. The spec's direction: a Concept whose phases are
  structured data; Build from a typed skeleton and the SDK's reference, never an example Game; a
  fast loop for type errors that doesn't use up Builds; a Playtest that reports every problem and
  checks the Game against the Concept's phases; progress as database rows, resumable per stage.
- The evidence to design from: the experiment's eval (`packages/backend/eval-results/` there) passed
  10 of 12 Games on a 27B model, with 2 to 4 Builds each and 4 to 14 minutes per Game. Almost
  nothing passed first time.
- Creators' own GenAI Studio keys, encrypted. The queue. The Track. Revisions.
- The eval set, so every change to the instructions or the Kit is measured. A live run costs real
  model calls and needs the owner's yes each time.

## Milestone 4: the community

Votes and Voted off, Profiles, Game reports and Site reports, Remixes, account deletion, the admin
page, nightly backups copied to S3, play-test nights with real groups, and the switch-over from the
old site.
