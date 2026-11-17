# BoilerGames: the rewrite spec

What the rewritten BoilerGames is, and the decisions it rests on, as of 2026-11-16. Words in bold
are defined in [GLOSSARY.md](../GLOSSARY.md); lasting decisions are ADRs in [docs/adr/](adr/); the
order of work is in [BUILD-PLAN.md](BUILD-PLAN.md). This file is the current truth, kept short: when
a decision changes, change it here rather than adding to a log.

## Problem

A group in one room (a club meeting, a dorm, a party) wants to play something together on one
screen. Party-game kits cost money, need an app or a console, and only have the games someone else
chose to make. People with an idea for a game of their own can't make it without being a programmer
and building the networking, the phone controls and the hosting themselves.

The first BoilerGames solved this in plain JavaScript while its design changed under it. Its games
were free web pages that the AI often got wrong and that could leak what they saw, and its three
programs shared no types. The rewrite keeps what proved right and redesigns the rest in TypeScript,
because typed Games turned out to be both safer and easier for the AI to get right.

## Solution

A website. A **Host** opens a **Room** on a **Screen** and gets a **Room Code**; everyone else joins
from their phone's browser with the code and a name. No app, and no account to play.

A **Game** is a small TypeScript module of plain functions over plain data, written against the
site's SDK. It runs walled off on the Screen with no network at all. It never draws anything: it
returns **Views** made of the site's own **Kit** of **Parts**, which the site draws on the Screen and
on each phone. Anyone with a Purdue email can make a Game by describing it; Creators can also
**Upload** a Game they wrote or **Remix** someone else's. Published Games go into the **Library**.

The first release has bare, working pages. The site's look is designed later.

## Milestones

The rewrite ships in four milestones. Each one is usable on its own, and the old site keeps running
from `main` until the owner decides the new one replaces it.

1. **Play.** A Room plays a Match of an **Official game** on real phones, on the deployed site.
   Stories 1–14.
2. **Uploads.** Accounts, the database, the **Playtest**, and Games that Creators upload, publish
   and browse. Stories 15–16, 19–23, 29–30, 35–36, 40–42, 45–47.
3. **The AI.** **Generations** and **Revisions**, and the eval set. Stories 24–28, 31–34, 53.
4. **The community.** Votes, reports, Remixes, the admin page, backups and the switch-over.
   Stories 17–18, 37–39, 43–44, 48–52, 54.

## User Stories

**Playing**

1. As a Host, I want to open a Room and get a Room Code, so that my friends have one code to join.
2. As a Host, I want to pick a Game in the Lobby and start a Match, so that the Room can play several Games in one night.
3. As a Player, I want to join from my phone's browser with a Room Code and a name, so that I don't install anything or make an account.
4. As a Player, I want my Seat kept when my phone refreshes or sleeps, so that a dropped connection doesn't throw me out.
5. As a Host, I want the Room and the Match to survive a Screen reload, resuming where they were, so that an accidental refresh doesn't end the night.
6. As a latecomer, I want to join a Room during a Match and either play straight away (if the Game takes late joiners) or keep a Seat for the next Match, so that I'm never turned away.
7. As a Host, I want up to 16 Players in a Room, with each Game able to set a lower limit, so that big groups can play.
8. As a Host, I want to remove a Player, so that I can deal with a rude name or someone who wandered in.
9. As a Host, I want to stop a Match at any time, and to be told why a Match ended (finished, stopped, broken, too few Players), so that a bad Game never traps the Room.
10. As a Player, I want what's secret to me (my role, my word) shown only on my phone, so that the Screen, which everyone can see, never gives it away.
11. As a Player, I want Controllers that work well under a thumb (buttons, text boxes, a drawing pad, boards and cards I can tap, a timer), so that every Game is easy to play.
12. As a Player, I want my phone to stay awake and the site's own controls out of the way during a Match, so that the Game has the whole screen.
13. As a Host, I want to see the winner or the scores when a Match ends (or neither, for a Game that has none), and start another, so that we can play several rounds.
14. As a Host, I want Official games ready to play, so that the site is worth opening before anyone has made a Game.

**The Library**

15. As a visitor, I want a Library with search, tags, player counts and sorting (A–Z, newest, top voted, most played), so that I can find something for the group in front of me.
16. As a visitor, I want a page for each Game, with its description, player count, who made it and how ("AI-made" or "Uploaded"), and how often it was played, so that I know what I'm starting.
17. As a Purdue-verified member, I want to Vote Games up or down (not my own), so that good Games rise.
18. As a Player, I want a Game whose Votes reach −5 to drop out of the Library until they recover, so that bad Games disappear without waiting for an Admin.
19. As a Creator, I want a Profile with a description that lists my published Games, so that people can find what else I made.

**Accounts**

20. As a visitor, I want to sign in by entering my email and clicking the link I'm sent, so that I never make or forget a password.
21. As a member, I want to confirm a Purdue email address, so that I can Vote and start Generations.
22. As a member, I want to stay signed in on my device until I sign out, so that I don't sign in every visit.
23. As a member, I want to delete my account and everything tied to it, choosing whether my published Games stay up credited to "deleted user", so that I can leave cleanly without taking away Games people enjoy.

**Making a Game with the site's AI**

24. As a Creator, I want to save my own Purdue GenAI Studio key, stored encrypted and shown only as its last 4 characters, so that I can make Games without the site paying for the AI.
25. As a Purdue-verified Creator, I want to describe an idea and get a Concept first, which I can read, edit or ask to redraft, so that no code is written for a Game I don't want.
26. As a Creator, I want the approved Concept built into a Game and Playtested to the end by simulated Players (fewest Players, most Players, and Players dropping out), with failures sent back to Build automatically, so that what I get works.
27. As a Creator, I want to follow my Game on a Track that says whether it's waiting on the AI, on me, or failed, and why, so that I always know where it is.
28. As a Creator, I want to ask for a Revision in plain words, checked the same way, so that I can improve my Game without writing code.
29. As a Creator, I want every change to make a new Version, with a changed-lines view and the option to go back, so that a bad change never breaks the Game people play.
30. As a Creator, I want to play my Game with real phones before publishing it, so that I can judge it myself.
31. As a Creator, I want Generations to wait their turn in a queue when the site is busy, so that the site stays usable.
32. As a Creator, I want to be told when GenAI Studio is down, so that I know why making Games doesn't work while playing still does.
33. As a Creator, I want the AI to add a score and a winner only when my idea asks for one, so that Games about the moment don't get a pointless scoreboard.
34. As a Creator, I want my Game to have its own look (colours, a typeface, corner style), so that it doesn't look like every other Game.

**Uploads and Remixes**

35. As a Creator with my own tools, I want to upload a Game's code (TypeScript against the SDK, up to a size limit), checked and Playtested the same way, with no AI or key needed, so that I can bring Games made anywhere.
36. As a Creator using another AI, I want a page with a ready-made prompt and the SDK's types, so that my AI writes code that fits the site.
37. As a Creator, I want to Remix any public Game into my own copy, credited to the original, so that I can change a Game I like.
38. As a Remixer, I want to say what should be different and get a new Concept for my copy, so that a big rework starts from a plan.
39. As a Creator, I want to turn off Remixing of my Game, so that I control copies of my work.

**Publishing, trust and safety**

40. As a Creator, I want to publish and unpublish my own Game, so that I don't wait for an Admin.
41. As the owner, I want publishing to refuse names and descriptions with blocked words (and show which), so that the Library stays clean without a review queue.
42. As a Player, I want every Game walled off in the Host's browser with no network of any kind, no access to the site's page, cookies or any Seat's token, and no code of its own on my phone, so that a Game made by a stranger can't take over an account or tell anyone what I did in it.
43. As a Player, I want to send a Game report (broken or offensive), and members to vote and comment on reports of broken Games, so that problems get seen and fixed.
44. As anyone, I want to send a Site report (broken, idea, other) without an account, so that I can tell the owner something.
45. As a visitor, I want a privacy page that says what's stored, what's sent to the AI, and that Games aren't reviewed before going public, so that I can decide whether to play.
46. As a Player, I want to be reminded on my phone that BoilerGames never asks for my password or email in a Game, so that a fake sign-in box in a Game doesn't fool me.
47. As the owner, I want limits on abuse from the first day (message floods, Room Code guessing, filling the Generation queue, too many Uploads or sign-in emails), so that one person can't break the site for everyone.

**Running the site**

48. As an Admin, I want an admin page with every Game, Game reports and Site reports, and the power to unpublish any Game, so that I can act on problems.
49. As the owner, I want to grant and revoke Admin from the server, so that only people I trust have it.
50. As the owner, I want to update the live site with one script that builds and tests the new version on a copy of the database, waits until nobody is playing, switches over and rolls back on failure, so that updates don't interrupt game nights.
51. As the owner, I want nightly database backups kept on the server and copied off it, so that losing the server doesn't lose the data.
52. As the owner, I want the site's service to run as its own user with only what it needs, so that a bug in it can't reach the rest of the server.
53. As the owner, I want an eval set I can run on demand that makes a fixed list of Games end to end and reports how many passed, how many Builds they took and how long, so that I know whether a change to the AI's instructions or the Kit helped.
54. As the owner, I want real groups to play-test the Games, so that difficulty, timers and balance are tuned on people, not bots.

## Decisions

**Shape of the system**
- One repository of npm workspaces, TypeScript throughout (ADR 0001): **sdk** (what Games are
  written against and the Engine that runs a Match; no dependencies, because it is bundled into
  every Game), **protocol** (the room messages, with a Zod schema for each), **server** and
  **client**. A package is split off only when the code demands it.
- One server process in the AWS project (us-east-2), behind Caddy (HTTPS and `wss://`), under
  systemd, as its own user. It serves the built client and the API. Scaling out isn't planned.
- Stack: Express 5 for HTTP, `ws` for WebSockets, Zod for every piece of data that comes from
  outside, React and Vite for the client, Vitest for tests, Playwright for browser tests. SQLite
  arrives with milestone 2 (ADR 0002, still proposed). New dependencies need the owner's approval.

**Games (ADRs 0003, 0004, 0006)**
- A Game is one module: `about` (title, Player range, **Look**), logic functions (`start`,
  `onAction`, `onTimer`, `onLeave`, `onJoin`), and two view functions (`screen`, `controller`). The
  logic functions take the state and return a **Step**: the new state, optionally a timer change or
  the end of the Match. The contract is `sdk/src/v1/game.ts`.
- Everything a Player can do is one typed **Action**. Each button, text box, drawing pad and
  tappable shape carries the exact Action it sends, so a view and the code that handles it can't
  disagree without failing the type check.
- State and Actions are plain data, enforced by the compiler. That is what lets a Match be saved,
  resumed and replayed.
- The platform owns time, randomness and the Player list. A Match has one timer; randomness comes
  from a seeded generator; every function is handed the Players currently in the Match.
- A Game with `onJoin` takes late joiners; one without doesn't. A Match may end with scores,
  winners, both or neither.
- A Game's **Look** (colours, a typeface, corner style) is optional, and the site fills its gaps
  from one of two default Looks, light or dark, picked by how bright the Game's own background is
  (light when it sets none). So a Game that only sets a dark background needs nothing more. The
  filled-in Look must be readable, measured as the WCAG contrast ratio:
  text on the background and text on the surface at least 4.5 to 1, the accent (timer, highlights)
  on the background at least 3 to 1. A Look that isn't is refused, with a problem naming both
  colours, the ratio measured and the ratio needed. Button text is black or white, chosen by the
  site, so it needs no rule. The default Looks and the check live in the SDK
  (`sdk/src/v1/look.ts`), so the checker and the renderer use the same colours.
- Sizes fit together end to end. A Drawing is at most 2,000 whole-number points (about 32 KB as
  JSON). A Game's state is at most 1 MB, saved only in the Host's browser. Each Controller View is
  at most 128 KB, so it fits in one message to a phone; the Screen splits Views across `views`
  messages so none passes the server's 256 KB limit. The Screen's own View never leaves the Host's
  browser and may be as big as the state.
- Views are plain data made of Kit Parts (`sdk/src/v1/kit.ts`), written as object literals. The
  **Picture** Part (shapes at any position, tappable on a phone) is the way out when the ready-made
  Parts aren't enough. There is no Canvas and no Game-written HTML.
- SDK v1 is for turn- and phase-based Games. Real-time play (a tick, a joystick) is a goal for
  SDK v2, and nothing in v1 may rule it out.
- One **Engine** runs every Match: in the Host's browser, in the Playtest and in tests. It calls the
  Game's functions and checks everything they return, so "what a valid Game does" has one definition.
- In the Host's browser the Engine and the Game run in a Web Worker inside a hidden, sandboxed
  **Game frame** (`allow-scripts` only) served from its own domain, with a policy that blocks all
  network access. The Game draws nothing, so the frame shows nothing: it is only a wall.
- Every Version records the SDK version it was checked against and runs on that version's frozen
  Engine. The view format is the part phones depend on, so within an SDK version it only grows.
- Official games are ordinary Games published by the owner. None of the first site's games is
  carried over; new ones are written for the SDK.

**Rooms (ADR 0005)**
- The Screen is the referee: it runs the Game and decides every view. The server only passes
  messages along, and a view or an Action is `unknown` to it.
- Messages are snapshots, never changes: the server sends the whole Room, the Screen sends a phone's
  whole view. The Screen works out who joined or left by comparing Rooms. The contract is
  `protocol/src/messages.ts`.
- The server remembers each Seat's latest view, so a phone that wakes gets it back at once.
- A Match survives a Screen reload because the Screen saves it in its own browser storage after
  every Step. It does not survive the Host's browser being lost; the Room and its Seats do.
- Actions sent while the Screen is away are dropped. Two Players may share a name; the server shows
  the second as "Ada (2)".
- Rooms live in memory. The server's layers: transport (sockets, limits, checking each message
  against its schema) and rooms (who may do what, given a `send` function and a clock, no sockets).

**Making Games**
- A Generation is: Concept → the Creator's approval or edits → Build → Playtest, with failures going
  back to Build. A Revision is the same without a new Concept.
- The Concept's phases are structured data, and the Playtest checks the Game against them (every
  phase reached, every Player offered something to do, scores moving when the Concept has scoring),
  not only that the Match ends. There is no AI code review.
- Type errors get their own fast loop and don't use up Builds. The Playtest reports every problem
  it finds, not the first.
- Build starts from a typed skeleton and the SDK's reference, never from an example Game.
- The Playtest runs strict `tsc`, bundles the Game so it can import only the SDK, then plays
  simulated Matches to the end (fewest Players, most Players, most with dropouts). The same checks
  run on Uploads.
- Only the Playtest runs Game code on the server, in a locked-down child process with no network.
  The rest of the pipeline only exchanges text with the model and needs no sandbox.
- A Generation's progress is rows in the database, resumable at each stage. Creators use their own
  GenAI Studio key, encrypted at rest; a queue runs a few Generations at once.
- This section is a direction, not a finished design: it gets its own design pass with the owner
  before milestone 3, as the data model does before milestone 2.

**Accounts**
- Sign-in is passwordless: an emailed link, sent through SES. A confirmed Purdue email makes an
  account Purdue-verified, which is needed to Vote and to start a Generation; playing, Hosting,
  Uploads and Remixes are open.
- Sending email sits behind a small interface, so tests and local development record the link
  instead of sending it.

## Testing

- Tests check what a module offers the rest of the system, never its insides: a test should survive
  any rewrite of the module that keeps its behaviour.
- The contract is tested by the compiler: `sdk/src/v1/game.test.ts` holds the mistakes the type
  check must refuse.
- Games are tested by playing them in the simulator, which is also what the Playtest uses.
- The rooms layer is tested with a fake `send` and a fake clock; the whole server once, in one
  process, over real HTTP and WebSockets.
- The walls are tested by attacking them in a real browser (network requests, WebRTC, navigation,
  reaching the parent page), in Chromium, Firefox and WebKit.

## Out of scope

- Real-time Games, a joystick and Canvas: SDK v2.
- The site's visual design: pages are bare until the backend is finished.
- Saving a Match to finish another night, or moving one to another browser.
- A person reviewing Games before they go public.
- Games as free web pages, and Game code on phones.
- Serverless hosting, Postgres, and moving the first site's data or games.
