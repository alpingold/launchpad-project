# BoilerGames

A Jackbox-style party game platform: a host shows a room code on a big screen, players join from their phones.

The full design, decisions, and milestone plan are in [`docs/PLAN.md`](docs/PLAN.md).

## Run it (development)

```sh
npm run install:all     # first time only
npm run dev:server      # terminal 1: Express on http://localhost:3000 (restarts on file changes)
npm run dev:client      # terminal 2: Vite on http://localhost:5173 (open this one)
```

Vite forwards `/api` and `/ws` to the server, so the browser only talks to :5173.
To test from phones on the same Wi-Fi: `cd client && npx vite --host`, then open the "Network" URL it prints.
On WSL2, phones can't reach WSL by default: add `networkingMode=mirrored` under `[wsl2]` in
`C:\Users\<you>\.wslconfig`, run `wsl --shutdown`, and allow port 5173 in Windows Firewall.
Some networks (e.g. campus Wi-Fi) block device-to-device traffic; a phone hotspot works instead.

## Test

```sh
npm test                # server unit + integration tests (Node's built-in test runner)
npm run test:e2e        # browser tests: real Chromium pages against the real client + server
npm run test:check      # the game checker on broken test games (uses the e2e tests' Chromium)
```

To check one frame game file (game info, static check, and 20 s of play in a headless
browser with simulated phones; it RUNS the game, so use it on files you wrote or chose):

```sh
npm run check-game -- server/src/games/bumper-blobs/game.html --shots /tmp/shots
```

The browser tests (`e2e/`) start their own server on :3100 and client on :5174 with 2-second
grace periods, so they don't touch your dev servers. That server (`e2e/server/testServer.js`)
is the real one plus a test admin account and a **fake AI generator**, so the admin-page tests
need no Docker, API key or network. First-time setup:

```sh
npm --prefix e2e install
npx --prefix e2e playwright install chromium   # downloads a test browser (~150 MB, once)
```

Useful while writing tests: `npm --prefix e2e run test:headed` (watch the browsers),
`npm --prefix e2e run report` (step-by-step trace of a failed test).

## Game art

Games can draw their own art (on a canvas, or with text characters), and can also show
approved pictures by **asset id** (e.g. `go-sign`) with `party.asset(id)`. The library lives in
`client/public/game-assets/`:

- `manifest.json` lists every asset: `id`, `file`, `alt` (description for screen readers), `tags`, `credit`.
- To replace a placeholder with your own drawing or Blender render: export a PNG (transparent
  background works well), put it in the folder, and change that entry's `file`. Keep the `id`,
  and games pick it up without code changes.
- To add new art: add the file and a new manifest entry. `npm test` checks that every entry's
  file exists. A game's security policy only lets it load pictures from this folder.

## Accounts

Hosting needs an account; players join as guests with just a room code.

- Accounts and login sessions are stored in SQLite at `server/data/boilergames.db` (created on
  first start, ignored by git). Set `DB_PATH` to use another file. Tests always use an
  in-memory database, so they never touch this file.
- Passwords are hashed with scrypt (never stored as typed); the login cookie is HttpOnly and
  SameSite=Lax, and only a hash of its token is stored.
- To wipe all accounts while developing: stop the server and delete `server/data/`.
- There is no email or password reset yet (open question Q8).
- The database upgrades itself on startup (`server/src/db/migrations.js`). Before changing an
  existing file it saves a copy next to it, named `boilergames.db.backup-<time>`.
- **Admin tasks** run on the server machine, not on the website:
  ```sh
  npm run admin -- users                 # list accounts
  npm run admin -- grant <username>      # make an account an admin (can generate games)
  npm run admin -- games                 # list AI-generated games, their versions, and what's live
  npm run admin -- import-game <file> --owner <username>   # store a game file (its game info must be valid)
  npm run admin -- set-live <game id> published|playtest <version|none>
  ```
  Game changes take effect when the server restarts. A `playtest` version shows up only in its
  owner's game picker; the `published` version shows up for every host.

## Games are web pages (frame games)

> **Branch `iframe-games`** (plan §13). On `main`, games are built from the game kit's blocks instead.

Each game is **one HTML file** (`server/src/games/<id>/game.html`). The same page runs on the
big screen and on every phone, each in a **sandboxed iframe**:

- **The big screen is the referee.** Its copy of the game runs the rules, timers and scores,
  and draws the big picture.
- **Phones are controllers.** They draw whatever controls the game needs and send events to the
  big screen.
- **The server only passes messages along** (`server/src/games/FrameRelay.js`), checking who
  sent them, who they're for and how big they are. It never runs game code.

A game talks to BoilerGames only through the `party` SDK
(`client/src/game/frame/sdk.js`):
- `party.ready(fn)`, `party.on(…)` and `party.now()` work on every screen.
- Phones have `party.send(data)`.
- The big screen has:
  - `party.sendTo` / `party.sendAll`, sent in batches, so calling them every frame is fine
  - `party.setState(player, state)`, kept and resent after a phone reloads
  - `party.save(snapshot)`: after a big-screen reload the game starts again with
    `party.ready`'s `restored`
  - `party.end({ rankings, scores })`

Games also get **`party.ui`**, ready-made pieces styled like the rest of the site in both
themes: `joystick`, `gamepad` (hold buttons like ◀ ▶ Jump), `timer`, `scoreboard`, `drawPad` /
`drawing`, and `countdown`. There's also `el` (builds elements safely), plus a base style for
headings, buttons and inputs. Games draw with shapes on a canvas, or with HTML and CSS, in
their own style. `async`/`await` is fine in a game. (A game-logic library, `party.kit`, and
starter templates were tried and dropped: the games came out simpler without them, plan §20.)

If a game hangs the big screen (which freezes that whole tab), the server notices that the
page has gone quiet and stops the game after 15 s. A game that loads another page into its
frame is removed.

The file starts with its info, which is the only part the server reads:

```html
<script type="application/json" id="game-info">
  { "name": "Bumper Blobs", "description": "…", "minPlayers": 2, "maxPlayers": 12 }
</script>
```

**The walls:**
- **The iframe sandbox** (`sandbox="allow-scripts"`) means a game can't read the page, the login
  cookie or the room tokens, and can't redirect the page.
- **Its Content-Security-Policy** blocks all network access, outside scripts and `eval`.
- **A browser test proves it:** `e2e/tests/frames.spec.js` tries nine ways out on both screens.

**The games:**
- **Bumper Blobs:** phones are joysticks, and the big screen is an ice arena. (Tower Dash and
  Dungeon Party, the ASCII-art games, were removed on 2026-10-16: see plan §18.)

## AI-made games

Admins can generate new games with AI (plan §11); later, any host with their own GenAI
Studio key may too. The generator runs inside an
OpenShell sandbox using Purdue GenAI Studio; setup steps and model choices are in
[`generator/README.md`](generator/README.md). The game server itself doesn't need any of this.
With that set up, `npm run generate -- "<game idea>"` writes a design, lets you approve it,
then builds the game in the sandbox and saves it under `generator/out/` for you to read.

Admins do it from the **admin page at `/admin`** (linked from the home page when you're
logged in as an admin). It uses the server's `/api/admin/generations` API. Generating is off
unless you start the server with `GENERATION_ENABLED=1`:

```sh
GENERATION_ENABLED=1 npm run dev:server
```

On the admin page you type an idea and the AI writes a short **design** first (genre, what
the big screen and phones show, the rules, how it ends, edge cases). Read it, ask for a new
draft ("make it 2 rounds") or edit it yourself, then press **Build it** (plan §13i). Jobs run
one at a time. A finished game waits for review with its check report, the playtest's
screenshots, and its code (shown as text; the admin
page never runs it). **Playtest** makes a version startable by you alone, **Publish** makes it
available to every host, and **Unpublish** takes it away. All of these apply immediately,
without a restart. Hosts see an **AI-made** badge on these games.

**Asking for changes** (plan §12e) makes a new version of a game: describe what to change
("rounds are too long; show the scoreboard after each round"), read the AI's short **plan**
of the change, and build it; the AI rewrites the game from that version's code, checked the
same way. Tick **Small fix** to skip the plan. Each version shows the request, the AI's list
of changes and the **changed lines**. You can playtest a new version while everyone else keeps
playing the published one, then publish it; rolling back means playtesting an older version
and publishing it.

The AI follows the guide at **`/kit`**, which shows the same rulebook it reads
(`generator/spec/`). Games can also be added by hand with `npm run admin -- import-game`.
