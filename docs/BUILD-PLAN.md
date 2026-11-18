# Build plan

Written 2026-11-16 for whoever builds the rewrite next, human or agent. It assumes you have read
nothing else. Milestone 1 (steps 0 to 9, done) and milestone 2a (steps 10 to 16) are planned step by
step and can be built from this file. Milestone 2b and milestones 3 and 4 are outlined, and each
begins with a design session with the owner that this plan does not replace.

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
- **Commits.** The owner's standing rule is "commit only when asked". This plan is that ask: one
  commit per finished step, on branch `rewrite`, in the style of `git log` (a sentence saying what
  is now true). Never force-push or rebase. Never commit `.claude/`, `CLAUDE.md` or `.scratch/`.
- **A push is a deploy.** Since milestone 1, a push to `rewrite` that passes CI goes live within
  minutes, and the restart closes every open Room. So never push: tell the owner what is ready,
  and the owner decides when it goes out.
- **Done means checked.** A step is finished when `npm run typecheck`, `npm run build` and
  `npm test` pass from the root and its "Done when" list holds. Say plainly what you could not check.
- **Tests check behaviour, not insides.** A test should survive a rewrite of the module that keeps
  what it does. Don't test private functions or internal fields.
- **AWS.** Don't create, change or inspect anything in AWS on your own. AWS work is done with the
  owner present.
- **Other repositories.** `~/slopProjects/boilergamesretry` is an earlier experiment by the owner.
  You may read it for evidence where this plan points at it. Don't copy its code (this design
  differs on purpose), don't deploy it, and don't read its `.env.local` or `signin.local/`.
  `../practice-old` is the first site; nothing from it is carried over.
- **Explain as you go.** The owner is a first-year student who has to defend this design to a
  mentor. Comments say why, in plain words. Report what you built and what you decided.

## Where things stand

Branch `rewrite`. Six npm workspace packages, each a folder at the root, and the browser tests:

| Folder     | Holds                                                                 | State (milestone 1 done)  |
| ---------- | --------------------------------------------------------------------- | ------------------------- |
| `sdk`      | The Game contract, the Kit, the Engine, the checkers, the simulator   | Built and tested          |
| `protocol` | The room messages and their Zod schemas                               | Built and tested          |
| `server`   | The one server process: Rooms, the site's HTTP, the game domain       | Built and tested          |
| `client`   | The site's pages (React, Vite), the Kit renderer, the Game frame      | Built and tested          |
| `games`    | The three Official games and their build                              | Built and tested          |
| `playtest` | The Playtest, its walled runner's program, and how a bundle is made   | Built (Steps 12, 13); its wall not yet attacked |
| `e2e`      | Playwright tests: the walls, the frame, the real site                 | Six projects, all passing |
| `deploy`   | The server's setup, service and release scripts (not a package)       | Running the live site     |

Milestone 1 is live at boilergames.party since 2026-11-17, with the Game frame on
boilergames-play.party. The README's "How the site is deployed" says how a push reaches it.

Packages import each other's TypeScript source through the `@boilergames/source` export condition
(see `tsconfig.base.json`), so nothing needs building before a type check or a unit test. The
browser tests are the exception: they start the real server, so run `npm run build` first. Relative
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
- As built: leavers leave at random moments within the first 2 × leavers events. Joiners arrive
  within the first third of the Match: with joiners, the simulator first plays the Match once
  without them (the same seed, so the same Match) to count its events, then plays it again with
  every joiner arriving in the first third of that count; joiners due at the same moment arrive
  together, as one event. If the measuring run has problems, those are reported and the joiner run
  is skipped. The simulated clock runs the timer out at random only once everyone has come and gone
  (it still does whenever nobody else can act), so even a short Match sees them. A leaver is always
  a Player in the Match, never a joiner still waiting. A joiner left waiting gets in if a later
  leaver makes room. A Match that ends because too few Players are left, or that breaks, skips the
  "never offered" check: those still there may not have had their turn yet.
- A joiner taken in is checked like everyone else, strictly: "Player 3 joined after 0 events and was
  never offered an Action". The owner decided (2026-11-17) that this is right, not a false alarm: a
  one-round Game that takes in latecomers it can never give a turn claims something it doesn't do.
  With the window measured, Games of two or more rounds that seat newcomers at the next round pass.

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
    opaque origin fails. `client/vite.frame.config.ts` builds the frame's script as a classic
    script, with the worker bootstrap and the Engine built into it as a string, and writes it
    inline into `client/dist-frame/v1/index.html`, the one file the game domain serves.
  - The frame forwards only the worker's first reply to each message and drops anything unasked.
    If the Game's code fails to load (a syntax error, a top-level throw, no Game on the global),
    the reply to `start` or `resume` is `couldNotStart`, not a two-second wait.
  - The GameFrame gives the frame page 15 seconds to load (it comes over the network) and 2 seconds
    per reply. A frame that fails either way, or sends a reply `readFrameReply` refuses, ends as
    `failed` and is removed. So is a frame whose Match ended or broke: it has nothing left to do.
  - The frame server is plain `node:http` (`server/src/frame-origin.ts`): one page and no API need
    no framework. Every response, 404s included, carries the CSP. `main.ts` starts it on the next
    port up.
  - The CSP allows the page's inline script by its hash (`script-src 'sha256-…'`), not `'self'`.
    With `'self'`, a Game's `importScripts` and `import()` reached the frame server with whatever it
    put in the URL, in Chromium and Firefox (WebKit blocked them). The server reads the page once
    when it starts and takes the hash from that same copy, so the two can't drift; the page's ETag
    lets a browser reuse its cached copy only while the server still serves that exact page. No
    source in the CSP reaches a network: no `'self'`, no host, no wildcard (`frame-ancestors` names
    the site, but only to say who may embed the frame). The walls test counts every request the
    frame server answers: after the frame's own page loads, none.
  - The browser tests are in `e2e/` at the root (`npm run test:e2e`). They build the frame, a test
    Screen page and the test bundles, and serve them on three origins: the site
    (`localhost:4100`), the real frame server (`127.0.0.1:4101`), and an "outside address"
    (`127.0.0.1:4102`). Site and frame are on different hosts, so they are different sites, as in
    production. The site, outside and frame servers count every request, so "blocked" is proved on
    the server, not taken from the browser's error.
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

- As built:
  - The three Games: **Sum It Up** (`games/src/sum-it-up`, 3 to 8: sum up an everyday thing in
    one word, vote for the best; three rounds; takes joiners, who join in at once), **Scribble
    Pick** (`scribble-pick`, 3 to 8: draw your own secret word, then pick each drawing's word from
    four; the Screen never shows a word before its reveal), and **Allotments** (`allotments`, 2 to
    6: take turns tapping a plot on a 6 by 6 board; your biggest connected patch scores; takes
    joiners, who join the end of the turn order; a turn that runs out of time gets a random plot, so
    a Match always ends after 36 turns). `games/src/official.test.ts` checks that between them they
    draw every Part (rows included) and that each Look passes `checkLook`.
  - `games/scripts/build.ts` (`npm run build -w @boilergames/games`, part of the root build) builds
    `games/dist/<id>.js` and `games/dist/games.json`, with Vite's library mode. The bundle's entry
    is only the Game's default export (built from index.ts directly, the global would be an object
    of all its exports). The build refuses a Game that imports anything but its own files and
    `@boilergames/sdk/v1`, then runs each bundle in an empty `node:vm` context: it must load with
    nothing else there and set exactly one global, `BoilerGamesGame`. `games.json` is read from
    the bundles themselves, so it can't disagree with them. Each Game's Look goes through the SDK's
    `checkLook` (built from source by Vite and run the same way), and the build fails on a problem,
    printing it.
  - The browser tests build the Official games with the same function and play each to its end
    through the real frame, in every browser and profile.

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

- As built:
  - `server/src/rooms.ts` holds every rule; `transport.ts` the `ws` side (path `/ws`); `site.ts` the
    Express side; `index.ts` joins them in `createServer`. Every number is a named constant.
  - Limits (owner's decisions of 2026-11-17, replacing the plan's "10 joins a minute"):
    - Wrong guesses: a `join`, `rejoin` or `resumeRoom` refused with noSuchRoom or badToken counts
      against its address. At `FAILED_TRIES_PER_MINUTE` (30) in a minute, every such try from the
      address gets `tooFast` and is closed, a right one too, until the minute slides. Successes
      aren't limited per address: a Room's phones share one Wi-Fi, and the 16-Seat cap bounds them.
    - `ROOMS_OPENED_PER_MINUTE` (5) per address; `MAX_OPEN_ROOMS_PER_ADDRESS` (10) open at once
      per address, refused with `tooManyRoomsHere`; `DEFAULT_MAX_ROOMS` (30) open at once in all,
      set by `MAX_ROOMS`, refused with `tooManyRooms`. The 30 fits about 256 MB (worked out in
      rooms.ts); step 9 sizes it for the real server.
    - A Room with no Seats whose Screen is gone closes after `EMPTY_ROOM_GRACE_MS` (60 s); one with
      Seats keeps `SCREEN_GRACE_MS` (5 min). If the last Seat leaves while the Screen is away, the
      shorter wait applies from then.
    - A View is kept as JSON text and refused above the SDK's `MAX_VIEW_BYTES` (128 KB), so a Room
      can't hold more than that worked out for.
    - `FIRST_MESSAGE_MS` (10 s) for a socket's first message; a ping every `PING_INTERVAL_MS` (30 s),
      and a socket silent for a whole round is dropped (its Seat shows `connected: false`);
      `MAX_SOCKETS_PER_ADDRESS` (200); `MAX_UNSENT_BYTES` (256 KB) waiting unsent on a socket.
    - The upgrade is refused (403) unless its Origin is the site's own (`SITE_ORIGIN`).
    - Over its messages-per-second limit, a socket gets `tooFast` once and its extra messages are
      dropped; at `CLOSE_AT_TIMES_THE_LIMIT` (2) times the limit in one second it is closed, and its
      Seat or Room waits as for a dropped socket.
    - `TRUST_PROXY=1` takes the address from the rightmost X-Forwarded-For entry, the one the proxy
      appended, never the leftmost, which the client writes.
  - `rejoin` and `resumeRoom` send `closed: replaced` to the socket they take over from (protocol).
  - Names are compared without case ("ada" after "Ada" becomes "ada (2)").
  - The frame's build moved to `client/dist-frame/`, outside the `client/dist/` the site serves: on
    the site's origin the frame's page would have no CSP and no sandbox.
  - Packages: `ws` 8.22.1 (8.22.2 and 8.23.0 were under two weeks old), `express` 5.3.0; npm
    `overrides` hold Express's `router` at 2.2.0 and `encodeurl` at 2.0.1 for the same reason. ws
    8.23.0 fixes a memory exhaustion by ping flooding; until it is installed, the server runs with
    `autoPong: false`, which leaves nothing to flood (browsers never ping).

Done when:
- The `rooms` layer has tests, using a fake `send` and a fake clock, for every rule above, including
  the races: a phone rejoining while its old socket is still open, a Seat removed while its phone is
  reconnecting, the Screen resuming while phones are mid-reconnect, `views` arriving for a Seat that
  just left.
- One test starts the whole server in-process and plays a join, a View and an Action over real
  WebSockets and real HTTP.

## Step 7: the Kit renderer and the pages (`client`)

- From step 6: a page told `closed: replaced` must not reconnect. It says the Seat (or, on the
  Screen, the Room) is open in another tab or on another device. Reconnecting would take the Seat
  back, the other page would do the same, and the two would trade it forever.

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

- As built:
  - `client/src/kit/`: `View.tsx`, `parts.tsx` (one component per Part), `look-style.ts` (the Look
    as CSS variables; button text black or white by `contrastRatio`), `ink.ts` (the drawing pad's
    rounding and thinning, tested on its own) and `kit.css`. Typefaces are system font stacks, so
    they differ by device; see the step 7 report.
  - `client/src/net/`: `connection.ts` (reconnects, 0.5 s doubling to 8 s; checks every message
    against the schema), `pack-views.ts` (the Views packing, tested without a browser), `saved.ts`.
  - `client/src/screen/screen-room.ts` and `client/src/play/phone-seat.ts` hold each page's logic
    without React; `client/src/pages/` draws their state. The Screen sends `views` when a View or the
    timer changed; a timer change alone is a `views` message with no Views.
  - The server serves `/screen` and `/play` (the same page), and `GET /api/config` tells the Screen
    where the Game frame is (`FRAME_URL`; the next port up in development).
  - `e2e/site.spec.ts` runs the real server, its frame server and the built client and Games, with
    phones in their own browsers. That server counts each socket as its own address and allows 1,000
    Rooms: a run opens far more Rooms a minute, from one address, than the real limits allow.
  - `e2e/screenshots.spec.ts` takes the screenshots for the owner when run with `SCREENSHOTS=1`.

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

## Step 9: deploy, with the owner (done 2026-11-17)

What was built, with the owner: one EC2 `t4g.small` in us-east-2 with a fixed address and only
ports 80 and 443 open; Caddy for HTTPS on both domains; the server under systemd as its own user;
and a deploy where CI publishes each tested build as a GitHub Release and the server fetches it
(`deploy/`, and the README's "How the site is deployed"). The plan's `update.sh` became
`deploy/install-release.sh`: it switches to a release and goes back if the site doesn't answer.
GitHub has no way in to AWS, because the project's managed rules forbid giving it one, and the
server has no SSH port; the owner reaches it through Systems Manager. The new site replaced the old
one at boilergames.party. DNS for both domains is at Cloudflare, set to "DNS only".

Checked against the live site:
- The game domain's frame page and a 404 both carry one Content-Security-Policy, identical on both,
  whose hash is the hash of the script actually served. Caddy adds, drops and changes nothing.
- A Room opens, a phone joins and the Host closes it, through Caddy; a socket from another site's
  page is refused with a 403; HTTP redirects to HTTPS.
- A push went from CI to the running site without anyone touching the server.

Still open:
- `package.json` still has two `overrides` (router, encodeurl) and pins `ws` at 8.22.1 with the
  ping mitigation. Upgrade `ws` once 8.23.0 is two weeks old (26 November 2026) and drop the
  mitigation only if its notes say that is safe; drop each override once its newer version is two
  weeks old (encodeurl 2.0.3 on 26 November, router 2.3.0 on 1 December). `npm audit --omit=dev`
  must stay clean.
- Real Safari, on an iPhone and on a Mac: a Match plays through the frame, and the hostile and
  hoarding test Games find every wall in place (ADR 0004). The browser tests only ever ran
  Playwright's WebKit on Linux, and WebKit is where the storage walls differed.
- Not tested live: that the server sees each visitor's own address through Caddy (the guessing
  limit depends on it). A unit test now feeds `forwardedAddress` what Caddy 2.11's source says it
  sends, forged headers included, and the server reads the visitor's own address every time.
- `www.boilergames.party` has no DNS record yet. The server's Caddyfile leaves its redirect out
  until it does (`deploy/Caddyfile` has it).
- The old server (a stopped `t3.small` in the same project) is to be deleted, and its address
  released, once the owner is satisfied with the new site.

---

# After milestone 1

Milestone 2a is designed and planned step by step. Each later one starts with a design session
between the owner and whoever builds it; its bullets are the direction the spec sets, not a design.

## Milestone 2: Uploads

Designed with the owner on 2026-11-17 and built in two parts. **2a** (steps 10 to 16, planned
below) is accounts, the database, the Playtest, and uploading, privately playing and publishing a
Game. **2b** (outlined after it) is the Library's pages, the page for Creators' own AIs and the
privacy page.

The owner's four decisions for 2a:

1. **The database is Node's built-in SQLite with plain SQL** (ADR 0007, which replaces 0002).
2. **Only `@purdue.edu` addresses can sign in for now**, so every account is Purdue-verified and
   there is no second kind of account. Playing and Hosting still need no account.
3. **The Playtest runs in its own service on the same server**, started by the operating system
   with no network and with memory and time caps. The site hands it code and reads back a result.
4. **2a before 2b.**

Dependencies approved for 2a, besides those above: `@aws-sdk/client-sesv2` (the server, to send the
sign-in email with the server's own AWS role, so no password for it is ever stored), and
`typescript` and `vite` as runtime dependencies of the new `playtest` package (both are already
used to build the site). Anything else needs the owner's yes. Each must be at least two weeks old.

What 2a leaves out, on purpose: the Library's pages and each Game's public page (2b); Remixes,
Votes, Profiles, reports, account deletion and the admin page (milestone 4); anything to do with
the AI (milestone 3). Don't build towards them beyond what a step says.

### The data, in one place

Five tables. Times are whole seconds since 1970, in UTC. Ids are random text, never a counter
(a counter tells a stranger how many accounts and Games exist, and lets them guess the next one).

| Table           | Columns that matter                                                                    |
| --------------- | -------------------------------------------------------------------------------------- |
| `accounts`      | id, email (unique, lower case), display name (unique, ignoring case), admin (0 or 1)   |
| `sign_in_links` | the hash of the link's token, email, when made, when it runs out, when used            |
| `sessions`      | the hash of the session's token, account, when made, when last seen, when it runs out  |
| `games`         | id, owner, description, which Version is published (or none), when made                |
| `versions`      | id, Game, number (1, 2, 3...), how it was made (`upload`), the source, its state, its problems, its bundle, its `about` (title, Player count, Look), SDK version (`v1`), when made, when checked |

- A Version's state is `checking`, then `ready` or `failed`, and never changes after that. A
  `failed` Version keeps every problem the Playtest found. Only a `ready` Version has a bundle.
- A Game's title, Player count and Look are its Version's `about`, read from the code itself. The
  Creator types only the description.
- Publishing points a Game at one of its `ready` Versions. Unpublishing clears it. A new Version
  never changes what is published: the Creator publishes it when they choose (story 29).
- The bundle is kept in the database, so a backup of one file is a backup of everything.
- Rooms stay in memory and know nothing of accounts.

**What a Room plays.** Today the Screen names a Game by `gameId` and fetches
`/api/games/<gameId>/bundle.js`, and it fetches the same address again after a reload. For an
uploaded Game the `gameId` is the **Version's** id, so a Match keeps the code it started with: a
reload mid-Match gets the same Version back even if the Creator has published a newer one since.
Official games keep their names (`allotments`). No message in `protocol` changes for this. If you
find it can't work that way, stop and say so.

**Who may fetch a Version's bundle:** its Game's owner, always; anyone, while its Game is published
and the Version is `ready`. Version ids are long and random, and a Game's code is not a secret
once published.

## Step 10: the database (`server`)

`server/src/db/`: open the file, apply the migrations, and the query modules.

- The file's place comes from `DATABASE_FILE`; tests and anything that passes `:memory:` get a
  database in memory. Turn on foreign keys and write-ahead logging, and make every table `STRICT`.
- Migrations are the numbered `.sql` files in `server/migrations/`, applied in order at start, each
  in one transaction, recorded in a table. Before applying any to a database that already has
  data, copy the file beside itself (`VACUUM INTO`), and keep the last three copies. A migration
  file that has shipped is never edited. The build must carry the `.sql` files into what is
  released (`deploy/package-release.sh` packs `server/dist`; make sure they are found there).
- One query module per subject. They are the only files with SQL in them. Every row read is
  parsed with a Zod schema. Every value goes in as a parameter, never by building a string.
- This step makes all five tables. The queries each later step needs can be written in that step.

Done when:
- A new database gets every table; starting again changes nothing; a database one migration
  behind gets only the missing one, and a copy of the file from before it exists.
- A migration that fails leaves the database exactly as it was, and the server refuses to start.
- Tests run through the real migration files on an in-memory database.
- The server starts with no `DATABASE_FILE` only in development and tests. In production it
  refuses to start without one (a site that quietly forgot every account on restart is worse than
  one that is down).

## Step 11: accounts and sign-in (`server`, `client`)

The flow:

1. `POST /api/sign-in` with an email. Not `@purdue.edu` (exactly that domain, after trimming and
   lower-casing): refused, with a message that says why. Otherwise make a token (32 random bytes),
   store its SHA-256 hash with a 15-minute life, and email the link
   `<SITE_ORIGIN>/sign-in/confirm#<token>`. The token is after the `#`, so it never reaches a
   server log or a `Referer` header.
2. The page at `/sign-in/confirm` shows a button. Pressing it sends the token in a `POST`. Opening
   the page uses nothing up: Purdue's mail is scanned by a service that opens every link.
3. That `POST` finds the hash, unused and in date, marks it used, makes the account if the email
   is new, and makes a session: another random token, stored as its hash, sent as the cookie
   `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`), good for 90 days from its
   last use. In development over plain http the cookie can't be `Secure` or `__Host-`; make that
   the one difference and name it in a comment.
4. A new account has no display name. Until it picks one (2 to 30 characters, unique ignoring
   case, trimmed, no control characters or characters drawn as nothing, and at least one letter
   or digit, so it can't look blank) the pages send it to a page that asks. The display name
   is what other people will see; the email address is never shown to anyone else and never
   appears in a response about another account.
5. `POST /api/sign-out` deletes the session. `GET /api/me` says who is signed in, or nobody.

Rules that hold for every request that changes something, from this step on: it is a `POST` (or
`PUT`/`DELETE`) with a JSON body, and its `Origin` header must be the site's own. With
`SameSite=Lax` that is the defence against another site acting as a signed-in visitor. Put it in
one place that every such route goes through, with a test that a route added without it fails.

Sending email sits behind one small interface: `send({ to, subject, text })`. Two
implementations: one that records what it was given (tests, and development, where it also prints
the link to the console), and one that sends through SES v2 from `sign-in@boilergames.party`. The
server uses SES only when `MAIL=ses`. Nobody can try the SES one until Step 16: write it small
and say so. The email is plain text: what it is, the link, that it runs out in 15 minutes, and
that it can be ignored if they didn't ask for it.

Limits, each a named constant, each tested with a fake clock: 3 sign-in emails to one address in
15 minutes; 50 from one visitor's address in an hour (a campus shares a few addresses, and a club
meeting of 30 on one of them must all be able to sign in); 300 a day in all (the site must never be a
way to flood Purdue inboxes, and SES judges the sender by complaints). 10 wrong tokens a minute
from one address. A refusal says to wait and how long. Old links and sessions are deleted
when they run out.

Pages (bare, like the rest): `/sign-in`, `/sign-in/confirm`, the display-name page, and a line at
the top of the home page that says who is signed in, with sign out.

Done when:
- A browser test signs in end to end with the recorded link, picks a name, reloads and is still
  signed in, signs out and is not.
- A link works once. A link opened but not pressed still works. A link 15 minutes old doesn't.
- Fetching `/sign-in/confirm` (as a mail scanner would) signs nobody in and uses nothing up.
- The database holds no token, only hashes: a test reads the tables and looks.
- A `POST` from another origin, or with no `Origin`, is refused on every changing route.
- No response and no log line contains another account's email address.

## Step 12: the Playtest (`playtest`, a new package)

One function: given a Game's source text, say whether it is a working Game, and if so hand back
its bundle and its `about`. It is the same check for an Upload now and for the AI's Games in
milestone 3, so it lives in its own package and knows nothing of accounts, HTTP or the database.

    playtest(source) → { ok: true, bundle, about, sdkVersion }
                     | { ok: false, problems: [{ stage, message, line? }] }

Three stages, and a later one runs only if the earlier passed:

1. **Types.** Strict `tsc` on the one file, against the SDK's types and nothing else: no DOM, no
   Node types, no other package. Every error is reported with its line, not just the first.
2. **Bundle.** The same bundling the Official games get, moved here so there is one definition of
   "a bundle": `games/scripts/build.ts` then uses this package for it. The file may import only
   `@boilergames/sdk/v1`. The bundle must set exactly the one global, to a Game whose `about` is
   valid and whose Look passes `checkLook`.
3. **Play.** `simulate` with the fewest Players, the most, the most with leavers, and the fewest
   with joiners, each on 3 seeds. Every problem from every run is reported, with the run it came
   from, the same problem said once.

Limits, named constants: source up to 256 KB; bundle up to 1 MB; at most 50 problems reported.

Things to get right:
- **Released code has no TypeScript source.** On the server only `sdk/dist` exists (its `.js` and
  `.d.ts`), with no `@boilergames/source` condition. The Playtest must find the SDK both ways.
  Add a check to the build that runs the Playtest on a small Game against the built output.
- **It runs code a stranger wrote.** Loading a bundle in Node's `vm` is not a wall; Step 13 is the
  wall. Don't spend effort hardening the `vm` use, and say in a comment that it isn't one.
- **The problems are the product.** A Creator, and later the AI, fixes the Game from this text
  alone. Each problem says what is wrong and where, in the SDK's own words.

Done when:
- Best Word and each Official game pass. The Official games' bundles are byte-for-byte what the
  games build made before this step.
- A Game fails, with a useful problem, for each of: a type error (with its line); two type errors
  (both reported); importing anything but the SDK; using `fetch`, `document` or `process` (a type
  error, since none is declared); a Match that never ends; a View that breaks a limit; a Player
  offered nothing to do; throwing when a Player leaves; an unreadable Look; a source over the size.
- The Playtest of a good Game takes a few seconds, measured and reported.

## Step 13: the Playtest's wall (`playtest`, `deploy`)

The Playtest runs hostile code, so on the server it runs where that code can reach nothing.

- **A runner**: a small program in `playtest` that reads one request (the source) from standard
  input, runs the Playtest, writes one result to standard output and exits. One process per
  Playtest: nothing a Game leaves behind is there for the next one.
- **Two ways to start it**, behind one interface the server uses (`run(source) → result`):
  - a child process, for development and tests (no wall; say so where it is chosen);
  - on the server, a connection to a Unix socket that systemd listens on, which starts a fresh
    runner for each connection (`boilergames-playtest.socket` with `Accept=yes`, and
    `boilergames-playtest@.service`). The server chooses this when `PLAYTEST_SOCKET` is set.
- **The service's wall** (`deploy/`): its own user, not the site's; `PrivateNetwork=yes` and
  `IPAddressDeny=any`; `RestrictAddressFamilies=AF_UNIX`; the file system read-only, with an empty
  private `/tmp` and no view of `/home`, of `/etc/boilergames.env` or of the database's folder;
  `MemoryMax`, `TasksMax`, `CPUQuota` and `RuntimeMaxSec` (start from 400 MB, 64 tasks, one core
  and 60 seconds, and report what a real Playtest needs); `NoNewPrivileges`, an empty
  `CapabilityBoundingSet`, `SystemCallFilter=@system-service`; at most 2 running at once. The
  socket file can be opened by the site's user and nobody else.
- **The site trusts nothing that comes back.** The runner ran a stranger's code and could be made
  to write anything. The server parses the result with a Zod schema, holds it to the size limits,
  and gives up after its own timeout. Write down, in the code, what a forged result could gain: a
  forged "ready" gets a bundle that then runs only inside the Game frame, which is a wall of its
  own, with the Screen checking every reply. If you find it could gain more than that, stop and
  say so.

This wall can't be tested on a developer's machine, and it is not to be trusted until it has
been attacked. So this step also writes the attack, to be run in Step 16 on a real server:
`deploy/attack-playtest.sh` sends hostile Games through the real socket and fails unless every one
is contained. Each tries one thing: open a connection to an outside address, to `127.0.0.1:3000`
and to the AWS metadata address `169.254.169.254`; look up a name; read the database file,
`/etc/boilergames.env` and `/proc/1/environ`; write outside `/tmp`; start another program; use
more memory than the cap; loop forever; start processes until refused; write a huge result; write
a forged "ready" result and exit early. To reach that code at all, a hostile Game must first get
out of the `vm`; for the attack, the runner takes a test-only switch that hands the Game Node's
`process` and `require`, and that switch must be impossible to set through the socket.

Done when:
- Through the child-process way, every Step 12 test passes, a Game that loops forever is stopped
  by the timeout and reported as a problem, and a runner that dies or writes nonsense gives the
  Creator a plain "the check itself failed, try again" and gives the logs the detail.
- The units pass `systemd-analyze verify` if this machine has it (say if it doesn't).
- The attack script exists, reads clearly, and says for each attack what "contained" means.
- Say plainly: the wall is written and not yet proven.

## Step 14: Games and Versions (`server`)

The API, all of it for a signed-in account with a display name unless it says otherwise:

- `POST /api/my/games` with a source: makes a Game and its Version 1, `checking`.
- `POST /api/my/games/<id>/versions` with a source: the next Version of a Game you own.
- `GET /api/my/games` and `GET /api/my/games/<id>`: your Games, their Versions, states, problems.
- `PUT /api/my/games/<id>` with a description (up to 300 characters).
- `POST /api/my/games/<id>/publish` with a Version id (`ready`, and yours), and `/unpublish`.
- `GET /api/games` (anyone): the Official games as now, then every published Game, each with its
  title, Player count, Look, and its Creator's display name. For a published Game the `id` is the
  published Version's id (see "What a Room plays").
- `GET /api/games/<id>/bundle.js`: an Official game by name, or a Version by id under the rule in
  "Who may fetch a Version's bundle". Refused and not-found look the same from outside.
- An admin may unpublish any Game. `admin` is set by hand in the database (a command for it goes
  in the README); there is no page for it until milestone 4. Games are public without review, so
  this must exist before the first Game is published.

The queue: a `checking` Version waits its turn; Playtests run two at a time at most, one per
account at a time. The Version's row is the truth: at start the server queues every Version still
`checking`, so a restart (every deploy is one) loses nothing. A result is written in one
transaction with the state.

Limits, named constants: 10 Uploads an hour and 50 a day for one account; 20 Games for one account;
50 Versions for one Game; 20 waiting in the queue in all (past that, "the site is busy, try again
in a few minutes"). The request body's size is capped just over the source limit before it is
parsed.

Done when:
- Tests, with a fake Playtest behind the Step 13 interface: an Upload goes `checking` then `ready`
  or `failed` with its problems; a restart in between finishes it; nobody but the owner can see,
  change, publish or add a Version to a Game; publishing a `failed`, `checking` or someone else's
  Version is refused; an unpublished Game's bundle is not served to anyone else, and is served to
  its owner; each limit refuses with a message that says what to do.
- One test runs a real Playtest end to end through the child-process way.
- Every text a Creator supplies (description, and the title inside `about`) is treated as text
  wherever it is shown or logged, and its length is capped.

## Step 15: the Creator's pages (`client`)

Bare pages, like the rest. The site's look comes later.

- **My Games** (`/my/games`): your Games, each with its title, whether it is published, and its
  latest Version's state. An Upload box: choose a `.ts` file or paste the code.
- **One Game** (`/my/games/<id>`): the description, and every Version, newest first, with its
  state. A `checking` Version updates by itself (ask the server every couple of seconds; stop when
  it settles). A `failed` one lists its problems, each with its stage and line. A `ready` one has
  **Play it** (opens a Screen with a Room on that Version: story 30) and **Publish**. The
  published Version is marked, with **Unpublish**. Upload a new Version here.
- **The Screen's list of Games** shows published Games after the Official games, each with its
  Creator's display name and the word "Uploaded", so a Host knows a stranger wrote it.
- Signed out, the `/my` pages send you to sign in and bring you back after.

Done when, in the browser tests (the recorded-link sign-in, the real Playtest through a child
process, on all six projects unless one is too slow, and say so):
- A Creator signs in, uploads Best Word, watches it turn `ready`, presses Play it, two phones join
  and the Match plays to its end.
- The Creator uploads a broken Version 2 and sees its problems. Version 1 is still playable.
- The Creator publishes Version 1. A signed-out Host on another browser sees it in the list, with
  the Creator's name, and plays it.
- The Creator uploads a working Version 3 and publishes it during that Host's Match. The Host
  reloads the Screen and the Match goes on, on Version 1.
- The Creator unpublishes. It leaves the list, and its bundle is refused to the signed-out Host.
- Add to the README how to run the site locally and sign in (the link is printed to the console).

## Step 16: deploy 2a, with the owner

Not for the building agent alone: this is AWS and the live server, done with the owner present.

**First, as soon as Step 11 is built** (a release now refuses to start without a database and a
way to send email, so nothing can be pushed until this is done):

- The server's role gets permission to send email from `sign-in@boilergames.party` and nothing else.
- The database's folder: `deploy/boilergames.service` sets `StateDirectory=boilergames`, which
  makes `/var/lib/boilergames`, owned by the site's user and writable although the rest of the file
  system is read-only to it. `DATABASE_FILE`, `MAIL=ses` and `AWS_REGION` go in the settings.
- Send a real sign-in email to a Purdue address and check it arrives, isn't marked as spam, and
  survives the mail scanner. Check a browser keeps the `__Host-session` cookie, and that Caddy
  passes the `Origin` header through (a sign-in on the live site proves both).

**Then, once steps 12 to 15 are built:**

- `PLAYTEST_SOCKET` in the settings; the Playtest's user, socket and service.
- Releases are built on x86 machines and the server is ARM. `tsc` and Vite each bring a program
  built for one kind of machine, so the release must carry the ARM ones: decide between building
  the release on an ARM runner and asking npm for the ARM packages in
  `deploy/package-release.sh`. The install's health check then runs one real Playtest through the
  socket, so a release whose Playtest can't run is rolled back.
- Memory: the server has 2 GB and the site's process may use 1.5 GB of it today. The Playtest needs
  room, so `MAX_ROOMS` and the site's cap come down to make it.
- Run `deploy/attack-playtest.sh` on a throwaway server set up the same way, not on the live one.
  Every attack must be contained before the live site accepts an Upload.
- Until milestone 4's nightly backups exist, copy the database somewhere off the server on a
  schedule, made with `VACUUM INTO` (a plain copy of the file can miss the latest changes): from now on, losing the file loses people's accounts and Games.

### Milestone 2b, outlined

- The Library (`/library`) and each Game's page: description, Player count, who made it and how,
  and how often it was played (which needs a count of Matches, and a decision on what counts).
- A page with the SDK's types and a ready-made prompt for Creators using their own AI (story 36).
- The privacy page: what is stored (an email address, a display name, Games), for how long, and
  how to have it removed until account deletion exists.
- A changed-lines view between Versions (story 29).

## Milestone 3: the AI

- **Design first, with the owner:** the pipeline. The spec's direction: a Concept whose phases are
  structured data; Build from a typed skeleton and the SDK's reference, never an example Game; a
  fast loop for type errors that doesn't use up Builds; a Playtest that reports every problem and
  checks the Game against the Concept's phases; progress as database rows, resumable per stage.
- The evidence to design from: the experiment's eval (`packages/backend/eval-results/` there) passed
  10 of 12 Games on a 27B model, with 2 to 4 Builds each and 4 to 14 minutes per Game. Almost
  nothing passed first time.
- Creators' own GenAI Studio keys, encrypted. The queue. The Track. Revisions.
- The Playtest refuses a generated Game whose Look isn't readable, with checkLook's problems, as the
  games build does for Official games (games/scripts/build.ts): a Look must be checked, not trusted.
- The eval set, so every change to the instructions or the Kit is measured. A live run costs real
  model calls and needs the owner's yes each time.

## Milestone 4: the community

Votes and Voted off, Profiles, Game reports and Site reports, Remixes, account deletion, the admin
page, nightly backups copied to S3, and play-test nights with real groups. (The switch-over from
the old site already happened, with milestone 1.)
