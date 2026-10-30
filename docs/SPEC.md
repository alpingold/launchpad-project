# BoilerGames: the rewrite spec

What the rewritten BoilerGames is, and the decisions it rests on, as of 2026-10-30. The rewrite
replaces the site at [boilergames.party](https://boilergames.party), which keeps running from
`main` until this is done. Words in bold are defined in [GLOSSARY.md](../GLOSSARY.md); lasting
decisions are ADRs in [docs/adr/](adr/). Work is in the issue tracker (`.scratch/rewrite/`).

## Problem Statement

A group in one room (a club meeting, a dorm, a party) wants to play something together on one
screen. Party-game kits cost money, need an app or a console, and only have the games someone else
chose to make. People with an idea for a game of their own have no way to make it without being a
programmer and building the networking, the phone controls and the hosting themselves.

The first BoilerGames solved this, but it was built in plain JavaScript as decisions changed under
it: its game model changed four times in five days, its security rested on an approval step that
was later removed, no single place owned what a Version is, its schema changed with every feature,
its three programs shared no types, and its games were free web pages that the AI often got wrong
and that could leak what they saw. Its owner now wants a design they understand and can defend,
built in TypeScript, keeping the decisions that proved right.

## Solution

A website. A Host opens a **Room** on a **Screen** and gets a **Room Code**; everyone else joins
from their phone's browser with the code and a name. No app, and no account to play.

Games are small TypeScript programs written against the platform's SDK: their logic runs walled
off on the Screen with no network at all, and phones draw what the Game describes from the
site's own **Kit** of controls. Anyone with a Purdue email can make a Game: describe it, approve
the **Concept** the AI writes, and get a Game that has already been played to the end by simulated
Players. Creators can also **Upload** a Game they wrote, or **Remix** someone else's. Published
Games go into the **Library**, where Purdue-verified accounts **Vote** on them.

The first release has bare, working pages. The site's look is designed later, around the finished
backend.

## User Stories

**Playing**

1. As a Host, I want to open a Room and get a Room Code, so that my friends have one code to join.
2. As a Host, I want to pick a Game from the Library in the Lobby and start a Match, so that the Room can play several Games in one night.
3. As a Player, I want to join from my phone's browser with a Room Code and a name, so that I don't install anything or make an account.
4. As a Player, I want my Seat kept when my phone refreshes or sleeps, so that a dropped connection doesn't throw me out.
5. As a Host, I want the Room and the Match to survive a Screen reload, resuming where they were, so that an accidental refresh doesn't end the night.
6. As a latecomer, I want to join a Room during a Match and either play straight away (if the Game takes late joiners) or keep a Seat for the next Match, so that I'm never turned away.
7. As a Host, I want up to 16 Players in a Room, with each Game able to set a lower limit, so that big groups can play.
8. As a Host, I want to remove a Player, so that I can deal with a rude name or someone who wandered in.
9. As a Host, I want to stop a Match at any time, and to be told why a Match ended (stopped, reloaded, not responding, broken), so that a bad Game never traps the Room.
10. As a Player, I want what's secret to me (my role, my word) shown only on my phone, so that the Screen, which everyone can see, never gives it away.
11. As a Player, I want Controllers that work well under a thumb (buttons, choices, text boxes, a drawing pad, a joystick, a timer), so that every Game is easy to play.
12. As a Player, I want my phone to stay awake and the site's own controls out of the way during a Match, so that the Game has the whole screen.
13. As a Host, I want to see the winner (or that everyone shares the win) when a Match ends, and start another, so that we can play several rounds.
14. As a Host, I want Official games ready to play, so that the site is worth opening before anyone has made a Game.

**The Library**

15. As a visitor, I want a Library with search, tags, player counts and sorting (A–Z, newest, top voted, most played), so that I can find something for the group in front of me.
16. As a visitor, I want a page for each Game, with its description, player count, length, who made it and how ("AI-made" or "Uploaded"), and how often it was played, so that I know what I'm starting.
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
28. As a Creator, I want to ask for a Revision in plain words (with a Plan first, or as a small fix), checked the same way, so that I can improve my Game without writing code.
29. As a Creator, I want every change to make a new Version, with a changed-lines view and the option to go back, so that a bad change never breaks the Game people play.
30. As a Creator, I want to play my Game with real phones before publishing it, so that I can judge it myself.
31. As a Creator, I want Generations to wait their turn in a queue when the site is busy, so that the site stays usable.
32. As a Creator, I want to be told when GenAI Studio is down, so that I know why making Games doesn't work while playing still does.
33. As a Creator, I want the AI to add a score and a winner only when my idea asks for one, so that Games about the moment don't get a pointless scoreboard.
34. As a Creator, I want my Game to have its own look (colours, fonts, styles of the Kit's parts), so that it doesn't look like every other Game.

**Uploads and Remixes**

35. As a Creator with my own tools, I want to upload a Game's code (TypeScript against the SDK, up to a size limit), checked and Playtested the same way, with no AI or key needed, so that I can bring Games made anywhere.
36. As a Creator using another AI, I want a page with a ready-made prompt and the SDK's types, so that my AI writes code that fits the site.
37. As a Creator, I want to Remix any public Game into my own copy, credited to the original, so that I can change a Game I like.
38. As a Remixer, I want to say what should be different and get a new Concept for my copy, so that a big rework starts from a plan.
39. As a Creator, I want to turn off Remixing of my Game, so that I control copies of my work.

**Publishing, trust and safety**

40. As a Creator, I want to publish and unpublish my own Game, so that I don't wait for an Admin.
41. As the owner, I want publishing to refuse names and descriptions with blocked words (and show which), so that the Library stays clean without a review queue.
42. As a Player, I want every Game walled off in my browser with no network of any kind, no access to the site's page, cookies or my Seat's token, and no way to leave its frame, so that a Game made by a stranger can't take over my account or tell anyone what I did in it.
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

## Implementation Decisions

**Shape of the system**
- One repository of npm workspaces: **shared** (types and schemas used by every other package),
  **server**, **client**, **sdk** (what Games are written against, and the runtime that runs them),
  **generator** (Generations and Playtests), and **e2e** (browser tests). TypeScript throughout,
  compiled with `tsc`; the client is built by Vite (ADR 0001).
- One server process on the existing EC2 instance (us-east-2), behind Caddy (HTTPS and `wss://`),
  under systemd, running as its own user. It serves the built client and the API. Scaling out isn't
  planned.
- Stack: Express 5 for HTTP, `ws` for WebSockets, SQLite through Drizzle on better-sqlite3 (ADR
  0002, proposed until the course has compared the options), Zod for every piece of data that comes
  from outside (socket messages, request bodies, Uploads, the model's replies). React and Vite for
  the client; Vitest for tests; Playwright for browser tests. New dependencies need the owner's
  approval.
- The server keeps its layers: transport (sockets, rate limits, checking messages against the
  shared schemas), rooms (who may do what, given a `send` function and a clock, no sockets), and
  the relay (passes Game messages between the Screen and phones, never reading what's inside).
  Rooms live in memory; the database holds accounts, Games and everything else that lasts.

**Rooms**
- Room Codes are short and easy to type; each Player's Seat has a secret token, and a dropped phone
  has a grace period to come back to its Seat. Rooms close when the Screen has been gone too long.
- The cap is 16 Players per Room; a Game may set a lower one.
- A latecomer gets a Seat at once. If the running Game takes late joiners, it is told and the
  Player plays; otherwise the Player waits in their Seat and plays from the next Match.
- Messages between the Screen, phones and server are one discriminated union defined in shared,
  checked by the server's transport and by the Screen, and sent as full snapshots of each phone's
  view, never as small changes (snapshots are tiny at 16 Players and repair themselves after a
  reconnect).

**Games (ADRs 0003 and 0004)**
- The Screen is the referee: the Game's logic runs on the Screen, and the server only relays.
- A Game is a TypeScript module written against the SDK: a manifest (name, player counts, length,
  whether it takes late joiners), its logic as pure functions (set up a Match, react to a Player's
  input or a timer), and its views as data: one view for the Screen and one per Controller.
- The logic runs in a Web Worker inside a sandboxed frame (`allow-scripts` only, never
  `allow-same-origin`) served from its own domain, boilergames-play.party, with a policy that blocks
  all network access. The worker has no page to navigate and no WebRTC. The frame's page belongs to
  the SDK runtime, which is platform code, not the Game's.
- Controllers draw views from the Kit on the phone, with the site's own code; phones never run Game
  code. The Screen draws the Kit plus canvas and SVG, which the Game draws through the runtime.
  Each Game may theme the Kit (colours, fonts, part styles), sent as data. The Kit grows when real
  Games show what's missing; an HTML-like view drawn through an allow-list is the next step if
  theming isn't enough.
- Every Version records the SDK version it was written for, and runs on that version's frozen
  runtime, so a new SDK version never breaks a published Game.
- Official games are ordinary Games published by the owner's account and marked official. The
  first three come from the owner's serverless experiment (a drawing game, a bluffing game and a
  trivia game, already written for this model); the seven Games of the first site are rewritten
  for the SDK one at a time.

**The SDK contract and the data model are designed by the owner first.** The two decisions the old
project got wrong first each get a design session (sketch it, get grilled, write it down) before
any code: the SDK's API and the room messages, and the database's tables and the life of a Version.
Where the serverless experiment already has a design we adopt, its code is brought over with its
tests, adapted to this repository.

**Making Games**
- A Generation is: Concept (written by the AI, checked against a schema, a few tries) → the
  Creator's approval or edits → Build → Playtest, with a failed Playtest's problems going back to
  Build, up to 4 Builds in all. A Revision is Plan (unless it's a small fix) → Build → Playtest.
  There is no AI code review; one is added back only if the eval set shows bugs it would catch.
- Build is given the Concept and the SDK's reference, and no example Games.
- The Playtest runs strict `tsc` on the Game, bundles it so it can import only the SDK, then plays
  three simulated Matches to the end (fewest Players, most Players, most with dropouts). Simulated
  Players read every possible input from the Controller views, so they always make valid moves. A
  Match must end. The same checks run on Uploads.
- Generations run in the OpenShell (Docker) sandbox on the server: no network except the model,
  no secrets but the Creator's key for that call, low privileges. The Playtest runs Game code in a
  child process inside that sandbox (Node's `vm` module is not a wall on its own).
- Creators use their own GenAI Studio key, encrypted at rest. A queue runs a few Generations at
  once and holds the rest in line.
- Every Version is made from an earlier one (except the first), records how it was made (a
  Generation, a Revision, an Upload, or a Remix's copy) and its SDK version, and one module owns
  what each kind of Version may do next.

**Accounts**
- Sign-in is passwordless: an emailed link, sent through SES from boilergames.party. Sessions are
  kept in the database. A confirmed Purdue email makes an account Purdue-verified, which is needed
  to Vote and to start a Generation; playing, Hosting, Uploads and Remixes are open.
- Sending email sits behind a small interface, so tests (and local development) use a version that
  records the link instead of sending it.

**Running it**
- `update.sh` builds (tsc, Vite), tests on a copy of the database, waits for an empty server,
  switches and rolls back on failure. CI runs the type checks and tests on every push.
- Nightly SQLite backups are kept on the server for 14 days and copied to an S3 bucket in us-east-2
  that deletes them after 30, written with an instance role (no keys on the server).
- The eval set runs only on the owner's request: it makes real GenAI Studio calls.

## Testing Decisions

- Tests check what a module offers the rest of the system, never its insides: a test should
  survive any rewrite of the module that keeps its behaviour. (The first project's generator tests
  checked internal fields and were edited 60 times.)
- The rooms layer is tested with a fake `send` and a fake clock, as before; the relay and transport
  through their public functions; the whole server once, in one process, over real HTTP and
  WebSockets.
- Games are tested by playing them: the Playtest's simulator is also the test harness for Official
  games (the serverless experiment's games each come with simulator tests).
- The generator is tested against the real server code with a fake model that plays back recorded
  replies, so the server and generator are never tested apart.
- The walls are tested by attacking them in a real browser (network requests, WebRTC, navigation,
  reaching the parent page), in Chromium, Firefox and WebKit.
- The first project's tests are not ported, but their scenarios (reconnect races, Screen reloads,
  removed Players, broken Games, the walls) are a checklist the new tests must cover.
- Browser tests are written for the new pages and rewritten when the pages are designed.

## Out of Scope

- The site's visual design: the first release's pages are bare and functional, and get designed
  later, around the finished backend (with their own stories, including a home page and search
  engine titles).
- Saving a Match to finish another night.
- A person reviewing Games before they go public.
- Games as free web pages (HTML and CSS written by the Game).
- Serverless hosting, Postgres, and moving the first site's data: the rewrite starts with an empty
  database.
- An AI code review step (unless the eval set calls for it).

## Further Notes

- The first project's code and its decision log stay on `main` until the rewrite is merged; its
  2,500-line plan is in git history (`git show baf3c04:docs/PLAN.md`). The old code is checked out
  next to this one, in `../practice-old`, for reference.
- The serverless experiment lives in `~/slopProjects/boilergamesretry`, with its own ADRs and
  glossary; this spec adopts its game model and pipeline but not its hosting.
- Redesign happens in passes: ideas found while building go on a "later" list, not into the
  current milestone.
- The owner writes the relay and the rooms layer by hand, after the TypeScript course
  (`~/LaunchPadstufs/typescript-course/`) has covered what they need.
