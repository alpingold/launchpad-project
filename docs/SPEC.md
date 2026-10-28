# BoilerGames: the spec

What BoilerGames is meant to be, what's built, and the decisions it rests on, as of 2026-10-28.
Live at [boilergames.party](https://boilergames.party). Open work is in the issue tracker
(`.scratch/boilergames/`); the step-by-step history of how each decision was made is in git (see
[Further notes](#further-notes)).

## Problem Statement

A group in one room (a club meeting, a dorm, a party) wants to play something together on one
screen. Party-game kits exist, but they cost money, need an app or a console, and only have the
games someone else chose to make. People with an idea for a game of their own ("like charades,
but everyone draws on their phone") have no way to make it without being a programmer and
building the networking, the phone controllers and the hosting themselves.

## Solution

A website. One person opens a game on a TV or laptop (the **big screen**) and gets a 4-letter room
code; everyone else joins from their phone's browser with the code and a name. No app, and no
account to play.

There are seven official games, and anyone with an account can make more:
- **describe it** in a few sentences, and the site's AI writes a design to read and edit, then
  builds the game, plays it with bot phones, reviews its own code and fixes what it finds;
- **upload a game file** they wrote by hand or with any AI of their own;
- **remix** someone else's public game into their own copy to change.

Creators publish their own games for everyone. Every game, official or not, runs walled off in
the players' browsers, and the server never runs game code.

## User Stories

✅ built · ⬜ not yet

**Playing (players and the big screen)**

1. ✅ As a host, I want to pick a game and open a room for it, so that my friends have one code to join.
2. ✅ As a player, I want to join from my phone's browser with a room code and a name, so that I don't install anything or make an account.
3. ✅ As a player, I want to get my place back after a refresh or my phone sleeping, so that a dropped connection doesn't throw me out of the game.
4. ✅ As a host, I want my room to survive a big-screen reload, and a game to resume where it was, so that an accidental refresh doesn't end the night.
5. ✅ As a host, I want to kick a player, so that I can remove a rude name or someone who wandered in.
6. ✅ As a host, I want to stop a game at any time, and to be told why a game stopped (stopped by me, a reload, not responding, broken), so that a bad game never traps the room.
7. ✅ As a player, I want what's secret to me (my role, my word) shown only on my phone, so that the big screen, which everyone can see, never gives it away.
8. ✅ As a player, I want phone controls that work for a thumb (a joystick that starts where I touch, a gamepad I can slide across, text boxes, a drawing pad), so that action and party games both play well.
9. ✅ As a player, I want my phone to stay awake and the site's header out of the way during a game, so that the game has the whole screen.
10. ✅ As a host, I want to see the winner (or "Everyone shares the win!") after a game, and start again, so that we can play several rounds.
11. ⬜ As a latecomer, I want to join a game already in progress or watch it, so that I'm not left out. _(Shelved: rooms are closed once a game starts.)_
12. ⬜ As a group, I want to save a game and finish it another night. _(Shelved.)_

**Finding games**

13. ✅ As a visitor, I want a games page with search, tags, player counts and sorting (A–Z, newest, top rated), so that I can find something for the group in front of me.
14. ✅ As a visitor, I want a page for each game, with screenshots, its length, who made it and how ("AI-made" or "Uploaded"), so that I know what I'm starting.
15. ✅ As a member, I want to vote games up or down (not my own), so that good games rise.
16. ✅ As a member, I want a profile with a bio that lists my games, so that people can find what else I made.
17. ✅ As a visitor, I want the home page to lead with making a game, and show top and newest games, so that I see what's special about the site.
18. ✅ As someone searching the web, I want BoilerGames' pages to show up with real titles and descriptions, so that I can find the site.
19. ⬜ As a visitor, I want to sort by most played, so that I see what groups actually enjoy. _(Games played are recorded now, and a game's page shows its count; the sort isn't built yet.)_

**Making a game with the site's AI**

20. ✅ As a member, I want to save my own Purdue GenAI Studio key (stored encrypted, shown only as its last 4 characters), so that I can make games without the site paying for the AI.
21. ✅ As a maker, I want to type an idea and get a written design first, which I can read, edit or ask to redraft, so that no code is written for a game I don't want.
22. ✅ As a maker, I want to follow my game on a track (Idea → Design → Build → Play) that says whether it's waiting on the AI, on me, or failed, so that I always know where it is.
23. ✅ As a maker, I want each build checked (a static check, then a playtest in a real browser with bot phones that reloads screens and fast-forwards to the end), and failures fixed automatically, so that what I get usually works.
24. ✅ As a maker, I want an AI code review after each build that fixes crashes and dead ends, and a "Review again" button, so that bugs the playtest can't see still get caught.
25. ✅ As a maker, I want to ask for changes in plain words (a plan first, or "small fix: skip the plan"), so that I can improve my game without writing code.
26. ✅ As a maker, I want every change to be a new version, with a changed-lines view and the option to go back, so that a bad change never breaks the game people play.
27. ✅ As a maker, I want to play my game with real phones before publishing it, so that I can judge it myself.
28. ✅ As a maker, I want several people's games made at once, with mine waiting its turn in line, so that the site stays usable when it's busy.
29. ✅ As a maker, I want to be told when GenAI Studio is down, so that I know why making games doesn't work while playing still does.
30. ✅ As a maker, I want the AI to add a score and a winner only when my idea asks for one, so that games about the moment don't get a pointless scoreboard.

**Uploads and remixes**

31. ✅ As a maker with my own tools, I want to upload or paste a game file (up to 1 MB), checked the same way, with no AI or key needed, so that I can bring games made anywhere.
32. ✅ As a maker using another AI, I want a ready-made prompt on `/kit` that contains the full rulebook, so that my AI writes a file that fits the site.
33. ✅ As a maker, I want "Ask the AI to fix these" and "Ask the AI to review it" on an upload when I have a key, so that I can still use the site's AI if I want.
34. ✅ As a player, I want to remix any public game into my own copy, credited to the original, so that I can change a game I like.
35. ✅ As a remixer, I want to say what should be different and get a new design for my copy ("Make it your own"), so that a big rework starts from a plan, not piecemeal edits.
36. ✅ As a creator, I want to turn off remixing of my game, so that I control copies of my work.

**Publishing, trust and safety**

37. ✅ As a creator, I want to publish and unpublish my own game, so that I don't wait for an admin.
38. ✅ As the site owner, I want publishing to refuse names, descriptions and About text with blocked words (and show which ones), so that the public pages stay clean without a review queue.
39. ✅ As a player, I want every game walled off in my browser (no network, no access to the site's page, cookies or my room token, no leaving its frame), so that a game made by a stranger can't take over my account.
40. ✅ As a player, I want to report a game as broken or offensive, and members to vote and comment on bug reports, so that problems get seen and fixed.
41. ✅ As anyone, I want to send a site-wide report (broken, idea, other) without an account, so that I can tell the owner something.
42. ✅ As a member, I want to delete my account and everything tied to it, so that I can leave cleanly.
43. ✅ As a visitor, I want a privacy page that says what's stored, what's sent to the AI, and that games aren't reviewed before going public, so that I can decide whether to play.
44. ✅ As a player, I want to be reminded on my phone that BoilerGames never asks for my password in a game, so that a fake login box in a game doesn't fool me.
45. ⬜ As a player, I want published games reviewed by a person first, so that a game built to misbehave can't reach me. _(Decided against for now; the accepted risk is under Implementation Decisions.)_
46. ⬜ As a member who forgot their password, I want to reset it myself. _(No email on purpose; only an admin can reset one, on the server.)_

**Running the site (admin)**

47. ✅ As an admin, I want an admin page with every game, the site-wide reports, and the power to unpublish any game, so that I can act on problems.
48. ✅ As an admin, I want to update the live site with one script that tests the new version on a copy of the database, waits until nobody is playing, switches over and rolls back on failure, so that updates don't interrupt game nights.
49. ✅ As an admin, I want nightly database backups kept for 14 days, so that a mistake can be undone.
50. ⬜ As an admin, I want backups copied off the server, so that losing the server doesn't lose the data. _(This happened once, when the old AWS project was closed.)_
51. ⬜ As the owner, I want real groups to play-test the games, so that difficulty, timers and balance are tuned on people, not bots.

## Implementation Decisions

**Shape of the system**
- Three programs, plain JavaScript with JSDoc (no TypeScript, no ORM): the **server** (Node,
  Express, `ws`, SQLite through better-sqlite3), the **client** (React, Vite, a small hand-written
  router) and the **generator** (the AI side, which runs only inside a sandbox). New dependencies
  need approval; the generator's one is Playwright's core, for the browser playtest.
- One server process behind Caddy (HTTPS and `wss://`), under systemd. It serves the built client
  itself. Scaling out isn't planned: it would first need rooms and the database moved off the one
  server.
- The server is layered so most logic is testable without a network: **transport** knows sockets
  but not rooms; **rooms** (RoomManager) knows rooms but not sockets, with `send` and the clock
  passed in; **protocol** validates messages; a router decides who may send what; all SQL stays
  in the database layer; every tunable number lives in one config module.

**Rooms and the protocol**
- Rooms, players and game state live only in memory; a restart loses them (deploys wait for an
  empty server). SQLite holds accounts, sessions, games and their versions, pages, votes, reports and games played.
- Room codes are 4 letters from 20 consonants. Up to 12 players; a game may set fewer. No joining
  once a game has started.
- Each player has a public `playerId` and a secret resume `token` (kept in the tab's
  sessionStorage). A refresh uses the token to reclaim the same slot; the newest tab wins.
  Grace periods: 30 s for the host, 30 s for a player in the lobby, and until the game ends for a
  player in a game.
- Messages are flat JSON `{type: "domain:action", ...}`. Every incoming message is checked in
  order: size cap, no binary, safe parse, known type, then a hand-written checker per type that
  copies only the expected fields. Too many bad messages close the socket. Each socket has a
  rate limit (20/s, bursts of 40) and a cap on unsent data; each address has caps on connections
  and failed joins.
- The WebSocket upgrade checks the Origin header (the login cookie rides along on it).

**Frame games**
- A game is **one HTML file**. It starts with a `game-info` JSON block (name, description, player
  counts, optional tags and length), the only part the server reads, with `JSON.parse`, never
  running it. The same file is both the big screen and the phones, told apart by its role.
- **The big screen is the referee.** Phones send events only to the big screen; the big screen
  answers with messages, per-phone state (kept and resent after a phone reloads) and a save
  (restored after a big-screen reload), and finally ends the game with rankings and optional
  scores. The server (FrameRelay) only relays and checks these, batched every 50 ms.
- Games talk to the site only through the `party` SDK, which includes ready-made phone pieces
  (joystick, gamepad, text input, timer, draw pad, countdown, sound). The site is dark only.
- **The walls:** the game runs in `<iframe sandbox="allow-scripts">` with no `allow-same-origin`,
  so it has its own "null" origin: no cookies, storage, or access to the site's page. Its code
  arrives over the room's WebSocket into `srcdoc`. A Content-Security-Policy allows no network
  at all (pictures only from the site's art library). The site's page checks every message from
  the frame; the server checks again. A frame that navigates away is removed. A heartbeat every 2 s
  catches a frozen game, which is stopped after 15 s of silence.
- **Accepted risk:** two holes no browser setting closes. WebRTC ignores the CSP, so the frame
  deletes WebRTC before the game runs and removes any child frame (which would bring its own)
  before that child's script can run (tested both ways, 2026-10-28). And a game that loads
  another page into its own frame gets one request out before the frame is removed. That request
  can carry whatever the game knows (names, answers) and reveals players' IP addresses. The
  static check flags both, the Privacy page states it, and a person reviewing games before
  publishing is the real fix if that ever matters more than self-publishing.

**Making games**
- Generation uses Purdue GenAI Studio (OpenAI-compatible), with the model `qwen3.8:27b` at medium
  reasoning effort, on **each maker's own key**: the site pays only for the server. The key is
  encrypted at rest (AES-256-GCM, bound to the user); the encryption secret is kept off the
  server's backups.
- Every AI step runs in an **OpenShell sandbox** (Docker) created per job and always deleted: 1
  CPU, 1 GB, network only to GenAI Studio, and the real key swapped in by OpenShell's proxy so
  the sandbox only sees a placeholder. The server calls the CLI without a shell, and the prompt
  never goes in arguments. Uploads are checked in a sandbox with no network at all.
- A game's history is a list of **versions**; a version's **kind** (new game, change, "Review
  again", a remix's own design, a remix's copy, an upload) and status decide its next step, its
  **track**, and whether it needs the AI. One place in the server owns this.
- Each step a version takes is one **job**, made and checked by the generator's own job module.
  The server passes facts (the idea, design, requests and history it walks); it writes no job
  fields. Steps: design (a new game's design, a change's plan, a new draft), build, a "Review
  again" round, an upload's check.
- **Designs** come back as JSON with one field per heading (rules, screens, art, secrets,
  length...); a design that copies the format's instructions is asked for again. A **build**
  writes the whole file for a new game, then edits (all-or-nothing search and replace) for fixes
  and changes, so games up to 100 KB can be changed. Each build is write → check → fix, up to 4
  attempts, then one critical-only code review with a small fix (a fix that fails the checks is
  dropped).
- **Checks:** a static check (errors fail, warnings don't; up to 8 syntax errors at once), then a
  playtest in headless Chromium with the real relay and bot phones: a phone reload, a big-screen
  reload, CSP violations, leaving the frame, blank or frozen screens, games that never move on
  (fast-forwarding past the game's whole length), players' names put in as HTML, and broken values
  like "NaN" on screen, each with the line at fault and screenshots.
- The rules the AI follows are one rulebook (also served on `/kit` and inside the upload prompt)
  plus a design guide used only for designs. No example games are given to the AI; problems are
  fixed by rewording rules.
- Up to 4 jobs run at once and 4 more wait; one per person; the browser playtest takes turns
  (one at a time) through a token handshake over the sandbox's stdin and stderr.

**Accounts and limits**
- Usernames and scrypt password hashes; no email at all. Sessions are random ids in an HttpOnly,
  SameSite=Lax cookie, stored only as hashes; POSTs are JSON-only. Admin is a database flag set
  from the command line.
- Limits per account and address: 50 games per account, 10 remixes an hour, 6 uploads an hour, 2
  running jobs per address, sign-up/login and report rate limits (all in the config module).
- Publishing checks names, descriptions and About text against a word filter (whole words, common
  disguises, a short list of roots that count inside words).

**Hosting**
- One AWS EC2 `t3.small` (2 GB, measured enough for the site plus one browser playtest) in the
  AWS project's selected Region, us-east-2, with an Elastic IP, a security group open only on 22
  (key only), 80 and 443, IMDSv2 with hop limit 1, and a $25/month budget. About $21/month, paid
  by the free plan's credits until it ends on 2027-04-25. The service runs with systemd hardening.
- Database migrations are numbered, run at startup, and save a copy first.

## Testing Decisions

- A good test checks what a user or another module can see (messages sent, statuses, what a
  maker sees, what reached the AI), not how the code inside got there. Tests that pinned a
  module's internal fields were removed when they got in the way (the job's raw fields).
- **Server:** Node's built-in test runner, no extra dependencies, an in-memory database.
  RoomManager is tested with a fake `send` that records messages and mock timers; the lobby is
  tested on the real server with real WebSocket clients (garbage, oversized frames, dead clients).
  The generation module is tested against the **real generator** run in-process with a fake model,
  driving every version kind through the module's own actions.
- **Browser (Playwright):** the real client and server with a test admin and a fake AI, so no
  Docker, key or network. Every official game has a test that plays it with phones. The test-only
  **Probe** game tries every way out of its frame on both screens; every wall must say "blocked".
- **The game checker** has its own fixtures: broken games that each hide one mistake from the
  static check, so only the browser can catch it. A new playtest check starts as a warning and
  becomes a failure only after it shows no false alarms on the whole collection of made games.
- **Generation changes** (prompts, rules, model settings) are decided by experiments: the same
  ideas built several times per option, the games read by hand, results written up in
  [experiments/](experiments/README.md).
- Tests run on every push (GitHub Actions) and again before every deploy.

## Out of Scope

- A mobile app; accounts for players; email (so no password reset by email).
- Long games, platformers and RPGs as a focus (allowed, not aimed for); the focus is short games
  that fit a big screen and phones: drawing and guessing, writing and voting, bluffing and
  secrets, trivia, short board games, loose real-time action.
- Running game code on the server, or a second server; true zero-downtime deploys.
- Real-time 3D and outside art packs (not yet approved as dependencies).
- Training a model on the site's games (would need the terms to say so first).

## Further Notes

**Open engineering items** (not user stories; carried over from the old plan, to become tickets):
- Confirm the live server runs the newest generator image (the playtest fast-forward and the
  generator-owned job both need it rebuilt) and that one real game still generates with the
  service's newer limits.
- Run the service as a user of its own, outside the docker group (deploy/README.md says why).
- Untangle build and review in the generator's job runner.
- A config comment still says the AI's rulebook allows 300 KB; it's 100 KB.
- The upload rate limit is in memory, so a restart forgets it.
- Watch how often the AI's edits fail to apply, and fix calls that end with no reply.
- Later, if wanted: a length choice on the new-game form; using the record of games played
  (built: every finished or stopped game) for "most played" and for judging AI games; a shape-drawing helper and an openly licensed
  art set; vibration on phones; an automatic secret-leak check in the playtest.
- Real-group play-tests to tune: Stowaways balance, Comet Crew's late waves, Doodle Drift and
  Punchline timers.

- **Where the reasons went.** Until 2026-10-28 every decision was recorded, with its reasoning, in
  a long plan file, and code comments cite it as "plan §N". It was replaced by this spec; read
  the last version with `git show baf3c04:docs/PLAN.md`.
- Words like version, version kind, job, design, plan, upload, remix, track and "made by" have
  fixed meanings in [GLOSSARY.md](../GLOSSARY.md).
- Designs that were replaced are written up in [history/](history/README.md) (the earlier
  "block games", where the server ran the games).
- Setup guides: the root README (development), `generator/README.md` (AI generation) and
  `deploy/README.md` (the server).
