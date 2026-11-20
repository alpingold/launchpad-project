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

| Folder     | Holds                                                                 | State (milestone 2b done) |
| ---------- | --------------------------------------------------------------------- | ------------------------- |
| `sdk`      | The Game contract, the Kit, the Engine, the checkers, the simulator   | Built and tested          |
| `protocol` | The room messages and their Zod schemas                               | Built and tested          |
| `server`   | The one server process: Rooms, the site's HTTP, the game domain       | Built and tested          |
| `client`   | The site's pages (React, Vite), the Kit renderer, the Game frame      | Built and tested          |
| `games`    | The three Official games and their build                              | Built and tested          |
| `playtest` | The Playtest, its walled runner's program, and how a bundle is made   | Built and tested; its wall held against 32 attacks (last run 2026-11-19) |
| `e2e`      | Playwright tests: the walls, the frame, the real site                 | Six projects, all passing |
| `deploy`   | The server's setup, service and release scripts (not a package)       | Running the live site     |

Milestone 1 is live at boilergames.party since 2026-11-17, with the Game frame on
boilergames-play.party. Milestone 2a (steps 10 to 16) is live since 2026-11-18 and 2b (steps 17 to
24) since 2026-11-19: accounts, Uploads, the Playtest behind its wall, the Library, counted plays,
the page for Creators' own AIs, blocked words, the changed-lines view and the privacy page. The
database is copied to S3 every night. Milestone 3 (steps 25 to 37) is next. The README's "How the site is deployed" says how a push reaches it.

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

Milestones 2a, 2b and 3 are planned step by step. Milestone 4 starts with a design session
between the owner and whoever builds it; its bullets are the direction the spec sets, not a design.

## Milestone 2: Uploads

Designed with the owner on 2026-11-17 and built in two parts. **2a** (steps 10 to 16, planned
below) is accounts, the database, the Playtest, and uploading, privately playing and publishing a
Game. **2b** (steps 17 to 24, after it) is the Library's pages, the page for Creators' own AIs and the
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

Changed with the owner after review (2026-11-18):
- **It sees less of the disk.** Besides the settings file and the database, it has no view of all of
  `/var` (Caddy keeps the site's TLS keys under `/var/lib/caddy`), `/root`, `/home`, `/boot`,
  `/snap`, `/etc/caddy`, `/etc/ssh` and the Systems Manager agent's folders. It keeps what Node,
  `tsc` and Vite need: Node in `/opt`, the release, `/usr`, `/lib`, `/etc` and its private `/tmp`.
  The attack lists and reads each of those places, Caddy's keys among them; "contained" means not
  found or permission denied.
- **Every run at once shares one budget**: `boilergames-playtest.slice`, one core and 500 MB in
  all, with a low CPU weight so the site wins when they compete. Each run's own `MemoryMax` comes
  down to 256 MB. An attack runs two spinning Games at once while timing requests outside the slice.
- **An Upload's bundle carries no path from the machine that built it**: the same source gives the
  same bundle in development and in a release. The Official games' bundles keep their bytes.

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
- `GET /api/games/<id>` (added while building): one Game's line of the list, under the same rule,
  for a Screen playing a Version the list doesn't name (Play it, or after a newer one is published).
- An admin may unpublish any Game. `admin` is set by hand in the database (a command for it goes
  in the README); there is no page for it until milestone 4. Games are public without review, so
  this must exist before the first Game is published. Added with the owner (2026-11-18): a
  takedown sticks. It is recorded on the Game (migration 0003), and while it stands the Creator
  can't publish the Game again, though they can still upload Versions and play them privately;
  another admin route lifts it. `/api/games` lists at most 200 published Games, the newest.

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
- Memory: the server has 2 GB. The site's process is capped at 1.1 GB with `MAX_ROOMS=90`, and the
  Playtest's runs share 500 MB (`deploy/boilergames.service`, `boilergames.env`).
- Run `deploy/attack-playtest.sh` on a throwaway server set up the same way, not on the live one.
  Every attack must be contained before the live site accepts an Upload.
- Copy the database off the server on a schedule, made with `VACUUM INTO` (a plain copy of the
  file can miss the latest changes): losing the file loses people's accounts and Games. Done
  2026-11-18: nightly, to S3 (`deploy/backup-database.sh`, the README's "The database's backups").

## Milestone 2b: the Library

Designed 2026-11-18. 2a made Games; 2b lets everyone else find them. Steps 17 to 24.

**What 2b ships, against the spec's stories:**

- Story 15, in part: a Library with search, a Player-count filter, and sorting A–Z, newest and
  most played. **Tags and "top voted" wait**: nothing stores tags yet, and Votes are milestone 4.
- Story 16: a page for each Game.
- Story 29's missing half: a changed-lines view between Versions. (Going back already works: any
  `ready` Version can be published.)
- Story 36: the page for Creators using their own AI.
- Story 41: blocked words. It was in no step until now, and 2b is what puts strangers' titles,
  descriptions and names on public pages.
- Story 45: the privacy page. Story 46: the reminder on the phone.
- Stories 19 (Profiles) and 23 (account deletion) stay in milestone 4.

**The owner's decisions for 2b** (all answered 2026-11-18):

1. **A counted play** is a Match that reaches its end with at least the Game's fewest Players, and
   **the count is shown as "about N plays"**. The Engine runs in the Host's browser (ADR 0005), so
   it is the Host's browser that says a Match finished, and a Room needs no account. The server can
   make cheating slow (Step 18's rules) but can't make it impossible.
2. **Blocked words are built now** (Step 20). The list sits in the repository, which is public.
3. **The changed-lines view uses the `diff` package** (Step 22), in the `client`. It is the one
   dependency approved for 2b, and the version installed must be at least two weeks old.
4. **The address people write to is `hello@boilergames.party`** (Step 23), forwarded to the owner's
   own inbox by the DNS host. The owner sets the forwarding up before Step 24.

Two more answers, from checking Step 23's page against the live server (2026-11-19):

- **Backups exist for up to 60 days, and the page says 60.** The bucket stops listing a copy after
  30 days and deletes it for good 30 days later; the second 30 days is what protects a backup from
  being written over. The bucket is not changed.
- **The server's system log is kept 30 days** (`deploy/journald-boilergames.conf`). The text copies
  Ubuntu keeps of it (`/var/log/syslog`) are rotated weekly and four are kept, so a line can last
  up to five weeks. The page says "about a month, five weeks at most".

Steps 17, 18, 19 and 21 were built first, on 2026-11-18. Three small things are left from their
review, to do with the next step: a test for the Library's 500-Game cap; the second copy of the
256 KB limit in `client/src/creator/creator-api.ts` reads `/api/config` like `/make` does; and the
browser tests already ask for 36 of the 50 sign-in emails one address may have in an hour, so new
tests reuse signed-in accounts where they can.

## Step 17: what the first real Upload showed (`playtest`, `client`)

- A file whose import is refused reports only that. Today the one refused import is followed by
  a line for every parameter that lost its type ("implicitly has an 'any' type"): 16 lines of noise
  under the one that matters. When the type stage finds a refused import, it reports the refused
  imports first and leaves out only the "implicitly has an 'any' type" lines, which the refused
  import caused. Every other problem is still reported: a Creator has 10 Uploads an hour, and each
  hidden problem would cost one more.
- A Game that calls `require()` gets a plain message that names the rule (a Game may import only
  `@boilergames/sdk/v1`, with `import`), not an empty "[plugin game-imports]".
- A file with no default export already says so. Check the message also appears when the file is
  somebody's test helper: `sdk/src/v1/best-word.fixture.ts` with its import corrected is the case.
- Story 46: the phone's Lobby says, in one quiet line, that BoilerGames never asks for a password
  or an email address inside a Game. It is the site's page that says it, never a Game's View.

**Done when:** tests show each message, and a browser test finds the line on a phone in the Lobby.

## Step 18: counting plays (`server`)

**The table** (`0004-plays.sql`, a new file; nothing shipped is edited): `plays`, one row per Game
that has been played: `subject` (a Game's id, or `official:<name>` for an Official game, which has
no row in `games`), and `count`. It stores no time, no Room and no person: only a number.

**Rooms stay out of the database** (ADR 0005). `Rooms` gets one more option, a function it calls
when a Match ends, with: the `gameId` the Match was started with, the reason, how many Seats were
in the Room when it ended, how long the Match lasted, and the Screen's visitor address. `Rooms`
records when a Match started; it decides nothing about plays.

**A play is counted when all of these hold** (a new module, `server/src/plays.ts`, with tests):

- The reason is `finished`. Stopped, broken and too-few-Players Matches don't count.
- The `gameId` is an Official game's name, or a `ready` Version of a Game that is published now.
  A Creator's private plays of an unpublished Game don't count. A play of an older Version of a
  published Game counts for the Game: the count belongs to the Game, not the Version.
- The Room had at least the Game's fewest Players when it ended, by the server's own list of Seats
  and the Player count the server reads from the Version's `about`, never a number from the Screen.
- The Match lasted at least 30 seconds. A Room plays one Match at a time, so this alone caps a
  Room at 120 counted plays an hour.
- The Screen's visitor address has had fewer than 60 counted plays today (in memory, like
  `limits.ts`; a campus network can put many people behind one address, so the cap is generous).

A play that isn't counted is not an error and nobody is told. Counting never delays or breaks the
Room: a database error is logged and the Match's end goes ahead.

**Done when:** tests show each rule on its own, that a taken-down or unpublished Game's plays
aren't counted, and that `rooms.ts` still imports nothing from `db/`.

## Step 19: the Library and a Game's page (`server`, `client`, `games`)

**Addresses that last.** The Lobby's list names an uploaded Game by its published Version's id,
which changes with every publish. A page people link to can't. So the Library names a Game by its
**Game id** (an Official game by its name).

- `GET /api/library`: every Official game, then every published Game (up to 500). Each: `id`,
  `playId` (what `/screen?play=` takes: the published Version's id, or the Official game's name),
  title, Player count, Look, description, the Creator's display name, how it was made (`Official`
  or `Uploaded`; `AI-made` comes with milestone 3), when the published Version was made, and
  `plays`. Never the source, the bundle, an email address or an account's id.
- `GET /api/library/<id>`: one of them. An unpublished or taken-down Game, and an id that never
  existed, get the same "not found", so nobody learns which private Games exist.
- Both are read-only and public. `/api/games` doesn't change. The Lobby gained one thing: a Game
  opened from its page shows in a "Chosen" box above the list.
- The server serves the site's page at `/library`, `/library/<id>`, and at Step 21's and 23's
  addresses when those are built (`PAGES` in `site.ts`).
- Each Official game gets a description, written beside its code in `games` and carried in
  `games.json`. Write them plainly: what the Players do, in two sentences.

**The pages.**

- `/library`: a card for each Game (title, Player count, Creator, "about N plays"), a search box
  over titles, descriptions and Creators' names, a "how many of you are there?" filter, and the
  three sort orders. The browser holds the whole list and filters it there: with a few hundred
  Games that is one small response and no search code on the server. If the Library ever nears the
  500 cap, searching moves to the server; say so in a comment where the cap is.
- `/library/<id>`: the title, the description, the Player count, who made it and how, about how
  often it was played, and **Host this Game**, which opens `/screen?play=<playId>`.
- The front page links to the Library. A Creator's page for a published Game links to its public
  page.
- A Game's title, description and Creator's name are a stranger's text: rendered as text, never as
  HTML, and long ones wrap or are cut off without breaking the page. A card may use the Game's
  Look for its colours: a `ready` Version's Look has already been checked for readable contrast.

**Done when:** unit tests cover both routes, including that a private or taken-down Game is "not
found" by its Game id and that no listing carries an email address; browser tests search, filter,
sort, open a Game's page and host it from there; the page works at phone width.

## Step 20: blocked words (`server`, `client`)

- One list, in one file in `server`, of words the site refuses. Matching is on whole words, after
  lower-casing and removing accents, so that a harmless word that merely contains a blocked one is
  not refused (the classic mistake). It will miss deliberate misspellings; admins' takedowns are
  for those.
- Checked where text becomes public: a display name when it is chosen; a Game's title (from its
  Version's `about`) and description when it is published; a description changed while published.
- A refusal names the word, so the Creator knows what to change (story 41).
- Digits, underscores and punctuation separate words too, so a display name like `x_word_99` is
  caught. Words run together with others are not.
- Keep the list short: slurs and the crudest words, the ones nobody could defend in a title. The
  owner edits the file to change it. Names and Games that already exist are not gone back over.

**Done when:** tests show a refusal at each of the three places with the word named, and that a
harmless word containing a blocked one passes.

## Step 21: the page for Creators' own AIs (`client`, `sdk`)

`/make`: how to write a Game for the site with any AI, or by hand (story 36).

- **The rules a file must follow**, the ones the Playtest enforces: one `.ts` file; its only import
  is `@boilergames/sdk/v1`; it ends with `export default defineGame({ ... })`; the size limit; what
  the Playtest will do to it.
- **The SDK's types**, as text, made from the SDK's own declarations, so the page can't say
  something the SDK doesn't. Unit tests run without a build (see "Where things stand"), so decide
  where the text is made so that the test below needs none: say how in the report.
- The limits the page quotes (the source's size and so on) are the Playtest's own numbers. The
  `client` must not import the `playtest` package, which brings TypeScript and Vite with it: give
  the numbers a home both can read (the `sdk`, or `/api/config`).
- **A ready-made prompt** with a Copy button: the rules, the types, and a place for the Creator's
  idea. **No example Game in it**: the owner's rule for the site's own AI applies here too, since
  an example is what every Game then copies.
- Linked from `/my/games`, beside Upload.

**Done when:** a test type-checks the three Official games against the page's types text as the
only declaration of `@boilergames/sdk/v1` (so the text is complete), and a test fails if the
page's rules and the Playtest's limits disagree.

## Step 22: what changed between Versions (`server`, `client`)

- `GET /api/my/games/<id>/versions/<versionId>/source`: the Version's source, as plain text, to its
  Game's owner only, never kept by a browser. Anyone else gets "not found".
- On `/my/games/<id>`, each Version after the first has **See what changed**: its lines against the
  Version before it, added and removed lines marked by a sign and a word as well as a colour. And
  **Download the code** for any Version.
- The comparison runs in the browser. Source is at most 256 KB; a comparison that would take too
  long says so and offers the two downloads.
- Check that a Creator can publish an older `ready` Version from this page ("go back", story 29).
  The server allows it already.

**Done when:** tests cover the route (owner only) and the comparison (added, removed, unchanged,
identical files, one empty file); a browser test opens a comparison.

## Step 23: the privacy page (`client`)

`/privacy`, linked from every page's foot and from the sign-in page. **Write it from what the
system does, checked in the code and on the server's settings, not from memory.** It must say:

- **What is kept about an account:** the email address, the display name, the Games and every
  Version's code, and a record of being signed in (not the email's link or the cookie's value, only
  a scrambled form of each).
- **What is kept about playing:** nothing about a person. A Room and its Players' names live in
  memory and are gone when the Room closes. A Game's count of plays is a number.
- **What the server's logs hold**, and for how long: find out (`deploy/Caddyfile`, what the server
  writes to its journal) and say it truthfully.
- **Who else handles it:** the site runs on a rented AWS server in Ohio, and AWS sends the sign-in
  email. Nothing is sent to an AI (milestone 3 changes this page).
- **What a browser keeps:** one cookie, to stay signed in. On a phone, the Seat's token, so a
  reload returns to the same Seat. On the Screen, the Match in progress, so a reload resumes it.
  Find every use of the browser's storage and list each. No tracking, no adverts.
- **Visitor addresses** are held in the server's memory for the limits (sign-in emails, Room Code
  guessing, counted plays) and are gone at a restart. Check each limit and say so.
- **Games are not reviewed before they are public.** A stranger wrote them; they run walled off in
  the Host's browser (story 42); an admin can take one down.
- **Backups** are kept 30 days, so something removed is gone from them 30 days later.
- **How to have an account and its Games removed**, until account deletion exists (milestone 4):
  write to `hello@boilergames.party`.

**Removal has to be real.** The README gets "Removing an account by hand": the commands that
delete an account's sessions, sign-in links, Versions, Games and the account itself, in the order
the tables' keys allow, and what to do about a published Game people are playing. Test the same
SQL on a database in memory.

**Done when:** every sentence on the page has been checked against the code or the server, and the
check is written in the step's report, sentence by sentence; the removal commands are tested.

## Step 24: deploy 2b, with the owner

- `0004-plays.sql` only adds a table, so the release before it still runs (ADR 0007).
- No change in AWS is expected. `hello@boilergames.party` is at the site's own domain, so its
  forwarding is set up at the DNS host first, and a test message sent to it.
- The owner opens the Library on a phone, hosts a Game from its page, and sees its count go up.

## Milestone 3: the AI

Drafted 2026-11-19, the night the owner asked for it to be built unattended. **Every choice below
is a default the owner has not yet confirmed**; the ones most likely to change are listed first.
ADR 0008 (proposed) records the shape. Steps 25 to 36 are for the building agent; Step 37 is not.

A **Generation** turns a Creator's idea into a Game: the AI drafts a Concept, the Creator approves
or edits it, the AI writes the code (a Build), and the Playtest checks it; a failed check goes back
to Build with every problem found. A **Revision** changes an existing Game the same way, without a
new Concept. Creators use their own Purdue GenAI Studio key. Stories 24–28, 31–34, 53.

### Defaults waiting for the owner's yes

| # | Default | Why this one |
| - | ------- | ------------ |
| 1 | The model is `qwen3.8:27b` at `https://genai.rcac.purdue.edu/api`, both settings (`GENAI_MODEL`, `GENAI_BASE_URL`). | It is what the experiment measured. |
| 2 | At most 4 Builds per Generation, 4 type fixes per Build, 3 invalid Concepts per draft, 16 model calls in all. A call GenAI Studio turns away as busy at once is given back, up to 12 per Generation. | The experiment needed 2 to 4 Builds for every Game, and every Concept in it needed at least one call made again. |
| 3 | An account may start 5 Generations and 10 Revisions a day, and has one running at a time. 2 run at once on the site; 20 may wait. | A Generation takes 4 to 14 minutes and holds a Playtest slot. |
| 4 | Keys are encrypted with a secret kept in a file on the server, outside the database and its backups. | No AWS service and no dependency. A stolen backup can't reveal a key. Losing the server loses the secret, and Creators enter their keys again. |
| 5 | A Revision has no written Plan yet (the glossary's Plan). | A Plan is a second approval step; build the simple path first and see if it is missed. |
| 6 | No example Game is ever shown to the model. | The owner's standing rule. |
| 7 | A Concept waiting for its Creator for 7 days is cancelled. | So the list doesn't fill with abandoned drafts. |

Every number is a named constant in one file, with this table's reason beside it. **The
experiment's numbers are weak evidence here:** it had a different SDK, a Playtest that stopped at
the first problem, and an eval that began at Build. The eval set (Step 35) is what will tell.

### What must stay true

- **Off unless configured.** A release must start, and pass the installer's check, with no model
  settings and no key secret: then the AI maker is off, its pages say so, and its routes answer "not
  available". The same way Uploads are refused without `PLAYTEST_SOCKET`. The first push after
  these steps deploys with the maker off.
- **No new dependency.** Nothing is approved for milestone 3. The model client uses `node:https`,
  the encryption `node:crypto`.
- **No live model call.** Nothing in this plan's steps, tests or scripts calls GenAI Studio. Tests
  use a scripted fake model, and the real client is tested against a small server the test starts
  itself. A live call needs the owner's yes each time (Step 37).
- **Only the Playtest runs a Game's code.** What the model writes is a stranger's code, exactly as
  an Upload is: it runs in the walled runner and in the Game frame, nowhere else. The pipeline only
  passes text.
- **A key is a secret.** It is never logged, never sent back to a browser (only its last 4
  characters), never put in an error message, and never in a test's snapshot.
- **2b's promises hold.** Removing an account removes its key, its Generations and their text, with
  the same proof (the raw bytes). The privacy page stops saying nothing is sent to an AI in the
  same commit that makes it untrue.
- **Uploads are untouched.** A Game uploaded today passes tomorrow. Anything added to the SDK or
  the Playtest for Generations is an addition, off unless asked for.

### The data

Three new migration files. 0005 and 0006 shipped with `fd5863d`; 0007 came after. Shipped files
are never edited: a change is a new file (a test in `server/src/db/database.test.ts` pins each
shipped file's hash).

- `0005-genai-keys.sql`: `genai_keys`, one row per account: the encrypted key, what the decryption
  needs (nonce, tag), its last 4 characters, when saved.
- `0006-generations.sql`:
  - `generations`: id, account, kind (`generation` or `revision`), the Game (none until a Build
    passes, for a Generation), the idea or the request, its state, the Concept (JSON), the latest
    Build's code, how many Builds and model calls it has used, the Version it produced, why it
    failed, a notice (waiting on GenAI Studio until a time), when made and when last changed.
  - `generation_steps`: one row per thing the pipeline did (a Concept draft, a Build, a type fix, a
    Playtest): which Generation, its number, what kind, when it began and ended, how it came out,
    and every problem found. This is what makes a restart resume, what the Track shows, and what
    the eval reads. (The experiment kept none of it, so nobody can say why its Builds failed.)
- `0007-busy-retries.sql`: `generations.busy_retries`, the busy calls given back (Step 32), 0 for
  rows from before it.
- `versions.made_by` gains `generation` and `revision` (the row schema checks the value, so no
  table changes).

A Generation's states: `concept` (the AI is drafting) → `review` (waiting on the Creator) →
`build` → `playtest` → back to `build`, or → `ready`. From any of them: `failed` or `cancelled`.
The Track says which, and whether it waits on the AI, on the Creator, or failed and why.

**Only a Build that passes becomes a Version.** The Game and its first Version are made, already
`ready`, in one transaction when the Playtest passes. A failed Generation leaves no Game behind.

### How the Playtest sees a Concept's phases

The spec asks the Playtest to check a generated Game against its Concept: every phase reached,
scores moving when the Concept has scoring. SDK v1 has no notion of a phase, and must not gain one
that Uploads have to follow. So:

- A Concept's phases each have an id (`write`, `vote`). The Build's typed skeleton declares
  `type Phase = "write" | "vote"` and a state with `phase: Phase`. That is a convention of
  generated Games, held by the type check, not a rule of the SDK.
- A Playtest request may carry `expect`: the phases' ids, whether there is scoring, and the Player
  count. Given it, the Playtest also reports: a phase no simulated Match ever reached; a `phase`
  that isn't one of the ids; a Game with scoring whose Matches all end without scores or with every
  score equal in every run; a Player count that differs from the Concept's.
- Without `expect` (every Upload) the Playtest does exactly what it does today.
- The simulator needs one addition to let the harness see the state as a Match goes: additive, and
  not part of what a Game author sees. If it can't be done without changing what a Game author
  sees, take the conservative path: skip the phase check, keep the scoring and Player-count checks,
  and say so.

**The wall.** This changes the runner's request and harness, and they ship in the release whether
the maker is on or off: every Upload runs through them. So the attack test is run again on a
throwaway server **before the push that carries Step 30**, not when the maker is turned on.

## Step 25: split the browser tests in CI (`.github`, `e2e`)

The browser job took 21 of its 30 minutes on the last push. A night of new tests would fail a
good push.

- Run the browser tests as two jobs side by side (Playwright's `--shard`, or by project), each with
  the 30-minute limit. The release job waits for both.
- Keep every action pinned by commit, as now.

**Done when:** the workflow file is valid and the two halves together run every test (count them
locally with `--list`). **It can't be proven until the owner pushes**: say so.

## Step 26: one reference text (`sdk`, `client`, `server`)

`/make` holds the rules a Game's file must follow and the SDK's types as text, in `client`. The
Build prompt needs the same text, in `server`, and the two must never disagree.

- Give the rules and the types text one home both can read. Default: the `sdk` package, under a
  new export for text only (`@boilergames/sdk/v1/reference`). A Game still can't import it: a Game
  may import `@boilergames/sdk/v1` and nothing else, and the test of that stays.
- `/make` reads it from there and looks the same as today.

- If the server reads the text from a file as it runs, that file must be in the release
  (`deploy/package-release.sh` packs what a release holds). A workspace test would pass without it
  and the deploy would roll back.

**Done when:** `/make`'s tests pass unchanged in what they assert; a test shows the server and the
client get the same text; the built form is checked as well as the source (as `check-built` does
for the Playtest); `sdk` still has zero dependencies.

## Step 27: talking to the model (`server`)

One small interface, like `Mail`: `complete(messages, options) → text`, or a failure of a known
kind. Two makers of it: the real client and a scripted fake for tests.

- **The real client uses `node:https`.** GenAI Studio sends nothing, not even headers, until the
  whole answer is written, which takes minutes. `fetch` gives up after 5 minutes of no headers and
  can't be told otherwise without a dependency. The experiment lost a night of runs to this.
- `POST <base>/chat/completions` with `{ model, messages, stream: false }` and
  `authorization: Bearer <key>`. One call may take 12 minutes. The base address comes from the
  settings only, never from a request. A redirect is a failure, never followed.
- **Failures, by kind:** `keyRejected` (401, 403); `rateLimited` (429, or a JSON `null` body, which
  is how GenAI Studio says it); `unavailable` (no connection, a timeout, any other status, an
  answer that isn't the expected JSON, a web page). The Creator is told which (story 32).
- **Checking a key:** `GET <base>/models` within 5 seconds; valid only if the answer is JSON with a
  list in `data`.
- **Reading an answer:** drop `<think>...</think>`; for code, the longest fenced block; for a
  Concept, from the first `{` to the last `}`.
- **Which model the server uses is a setting**, as `MAIL` is: the real client, or the scripted fake
  for development and the browser tests. A test's stand-in server speaks plain `http`, so the client
  can; but **in production the server refuses to start with the fake or with a base address that
  isn't `https`**. Otherwise one mistyped setting would send a Creator's key unprotected.

**Done when:** the real client is tested against a server the test starts on this machine: a good
answer, 401, 429, a `null` body, a web page with status 200, a redirect, headers that arrive after
a long wait, a connection that never answers. No test and no script reaches the internet. The key
appears in no log line and no error (a test looks).

## Step 28: a Creator's key (`server`, `client`)

- `0005-genai-keys.sql`. The key is encrypted with AES-256-GCM (`node:crypto`), a new random nonce
  each time, bound to the account's id so one account's row can't be moved to another. The secret
  is 32 random bytes in a file named by the setting `KEY_SECRET_FILE`. Behind a small interface, so
  the secret's home can change later without touching the rest.
- No `KEY_SECRET_FILE`: the maker is off (see "What must stay true"). `/api/config` says whether it
  is on.
- Routes for the signed-in Creator: save a key (checked against GenAI Studio first; saved only if
  valid), see whether one is saved and its last 4 characters, delete it. Saving is limited (10 in
  15 minutes per account).
- A page to do those three things, reached from My Games. It says plainly whose key it is, what it
  is used for, and that it is kept encrypted and never shown again.

**Done when:** tests show the key never leaves the server once saved (every response is searched
for it), that a row copied to another account won't decrypt, that a wrong secret fails cleanly,
that the maker is off without the setting; a browser test saves and deletes a key against the fake.

## Step 29: the Concept (`server`)

A Concept is structured data, checked by a function, never free text:

- title (60 characters at most), pitch (400), Player count (1 to 16, min ≤ max);
- 1 to 8 phases, each: an id (lower-case letters, unique), a name (40), what the Screen shows
  (300), what each Player does on their phone (300), what ends it (200);
- scoring: `none`, `points` or `winner`, and how (400). `none` is a real choice: the AI adds a
  score only when the idea asks for one (story 33);
- how long a Match is (200); a Look (the SDK's own type, and it must pass `checkLook`; story 34).

The prompt says what the site is, what a phone and the Screen can show (the Kit's Parts, by name
and purpose, from the reference text), and the fields. **No example Concept and no example Game.**
An invalid answer goes back with every problem listed, at most 3 times a draft. The Creator can
approve it, edit any field (checked the same way), or ask for a redraft with a note.

**Done when:** tests cover the checker field by field; a draft that is invalid twice then valid;
three invalid ones failing the Generation with a reason a person can read; an edit that breaks a
rule being refused with the rule named.

## Step 30: the Playtest checks a Game against its Concept (`playtest`, `sdk`)

As "How the Playtest sees a Concept's phases" says. Additive only.

**Done when:** tests show each new problem on a small Game written for the test; every existing
Playtest test passes unchanged; a request without `expect` gives byte-for-byte the result it gave
before; the Official games still build; `/make`'s types test still passes.

## Step 31: the Build (`server`)

- **The skeleton** is made from the Concept, not written by the model: the import, the `Phase`
  type, a state with `phase`, `about` filled in (title, Player count, Look), and each function
  declared and empty. It type-checks as it stands except for what is left to fill in.
- **The prompt:** the reference text (rules and types), how the Playtest will test the file, the
  Concept, the skeleton. It asks for the whole file in one code block. No example Game.
- **A failed check goes back** as: the Concept, the model's last file, and every problem with its
  line, asking for the whole corrected file. Only the latest attempt is sent, so the conversation
  stays within the model's memory.
- **Two kinds of failure.** Problems from the source, type or bundle stages are a *type fix*: cheap,
  and they don't use up a Build. Problems from playing are a *Build*. Both have a cap (the table
  above), and so does the Generation's total of model calls.
- An answer with no code block is itself a problem that goes back.

**Done when:** tests, with the fake model and the real Playtest in a child process, show: a Build
that passes first time; type errors fixed without using a Build; a play failure using one; each cap
ending the Generation with a reason; the skeleton of a Concept type-checking against the SDK.

## Step 32: the pipeline and its queue (`server`)

- `0006-generations.sql`, and the state machine above. Every step writes its row before and after,
  so a restart finds where each Generation was and carries on from the start of that stage. A
  Generation in `review` just waits.
- **The queue:** 2 Generations at once on the site, 1 per account, 20 waiting, the daily limits in
  the table. A Generation that can't start says where it is in the line (story 31).
- **Sharing the Playtest's two slots.** Generations' Playtests take at most one slot at a time, so
  an Upload's check never waits behind more than one of them.
- **GenAI Studio down or busy:** wait 30, 60, 120 then 240 seconds, showing the Creator why and
  until when; after that the Generation fails as `unavailable`, and can be started again.
- **A busy answer doesn't use up a call.** Each call is still counted before it is made. One that
  GenAI Studio answers as busy (`rateLimited`) within a minute is given back in the same write that
  ends its step, and counted as a busy retry instead: 12 per Generation, and the 13th fails it,
  saying GenAI Studio was busy, without counting against the Creator's day (a redraft goes back to
  review). A quick `unavailable` (a 502, say) may have reached the model, so it stays counted; so
  does a call a restart cut short.
- **A rejected key** fails the Generation at once and says to check the key.
- A passing Build makes the Game and its Version as "The data" says. The Version's `made_by` is
  `generation`.
- Nothing here blocks the server's other work: a model call is minutes of waiting, not of work.
- **Every push restarts the server.** The count of model calls is written before each call, so
  restarts can't spend a Creator's key past the cap. A Generation that can't be resumed (a row that
  no longer makes sense) is marked failed with a reason; it never stops the server from starting.

**Done when:** tests with the fake model and a clock the test moves show: a whole Generation from
idea to a `ready` Version; a restart in each state resuming; the queue's limits; the waits and the
`unavailable` failure; cancelling at each state; that a failed Generation leaves no Game.

## Step 33: the Creator's pages (`server`, `client`)

- Routes: start a Generation from an idea (2,000 characters at most); list mine; one, with its
  Track; edit the Concept; redraft with a note; approve; cancel.
- Pages: describe an idea; read, edit, redraft or approve the Concept; **the Track**: where it is,
  whether it waits on the AI, on me, or failed, and why, with each step and its problems. It asks
  again every few seconds while the AI is working, and not otherwise.
- With the maker off, the pages say it isn't available yet and the routes refuse.
- A Game made this way shows on My Games like any other: play it privately, publish it.
- The Library and a Game's page say **AI-made** when any of its Versions was (the glossary's
  "Made by").
- Plain pages in the site's current style. The owner has mockups for a later restyle; don't design.

**Done when:** browser tests, against the fake model, take an idea to a published Game and show a
failed Generation's reason; the pages work at phone width.

## Step 34: Revisions (`server`, `client`)

A Creator asks, in plain words (1,000 characters at most), for a change to one `ready` Version of
their Game. The prompt holds the reference text, the Concept if the Game has one, that Version's
code and the request. It is checked like a Build, with the same caps, and a pass makes a new
Version with `made_by` `revision`. Nothing is published by it (story 29). An uploaded Game can be
revised too; it has no Concept, so its Playtest carries no `expect`.

**Done when:** tests show a Revision making a new Version, a failed one leaving the Game as it
was, and the limits; a browser test asks for one and sees the changed lines.

## Step 35: the eval set (`server`)

So that every change to the instructions or the Kit can be measured (story 53).

- A list of 12 ideas, each one or two sentences, as a Creator would type them. Make them varied:
  drawing, words, bluffing, a board, speed, a co-operative one, one with no scoring. Do not copy the
  Official games or any published game.
- A script that runs each idea through the whole pipeline (approving the first valid Concept),
  one at a time, and writes a report: per idea, pass or fail, Builds, type fixes, model calls (busy
  calls given back shown apart), time,
  and **every problem from every step**; and totals.
- **It refuses to run against the real GenAI Studio unless given `--live` and a key in the
  environment.** Its tests use the fake. Never run it live: that is the owner's decision each time.

**Done when:** a test runs the script on the fake model and checks the report's numbers.

## Step 36: promises and paperwork (`server`, `client`, docs)

- Removing an account removes its key, its Generations and their steps, in the main file and each
  copy, with the raw-bytes test extended to them.
- The privacy page: what the maker sends to GenAI Studio (the idea, the Concept, the code and the
  Playtest's problems), that it is Purdue's own service, that the Creator's own key is used and how
  it is kept. Every sentence checked against the code, as in Step 23.
- The README: the new settings, how the maker is turned on, how the key secret is made.
- `docs/SPEC.md` and `GLOSSARY.md` where this plan changed a meaning. ADR 0008 stays "proposed".

**Done when:** the tests pass and the report lists each privacy sentence with where it was checked.

## Step 37: turn it on, with the owner

Not for the building agent: this is the live server, a secret, and real model calls.

- The owner goes through "Defaults waiting for the owner's yes" and changes what they want.
- The attack test was already run again before Step 30 was pushed (see "The wall").
- The key secret is made on the server, readable by the site's user only, and left out of every
  backup. `KEY_SECRET_FILE`, `GENAI_BASE_URL` and `GENAI_MODEL` go in the settings.
- The owner saves their own key and makes one Game. Then, with the owner's yes, one live eval run.
- The server can reach GenAI Studio from AWS: checked 2026-11-19, `GET /api/models` without a key
  answers 401 as JSON in a tenth of a second. So no other route to the model is needed.

## Milestone 4: the community

Votes and Voted off, Profiles, Game reports and Site reports, Remixes, account deletion, the admin
page, a warning when the nightly backup fails, and play-test nights with real groups. (The switch-over from
the old site already happened, with milestone 1.)
