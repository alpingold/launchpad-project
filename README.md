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

Games show pictures by **asset id** (e.g. `go-sign`), never by URL. The library lives in
`client/public/game-assets/`:

- `manifest.json` lists every asset: `id`, `file`, `alt` (description for screen readers), `tags`, `credit`.
- To replace a placeholder with your own drawing or Blender render: export a PNG (transparent
  background works well), put it in the folder, and change that entry's `file`. Keep the `id`,
  and games pick it up without code changes.
- To add new art: add the file and a new manifest entry. `npm test` checks that every entry's
  file exists and that games only use ids that are in the manifest.

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
  npm run admin -- games                 # list AI-generated games and their status
  npm run admin -- import-game <file> --owner <username>   # store a game (must pass check-game)
  npm run admin -- set-status <game id> playtest|published|rejected
  ```
  Game changes take effect when the server restarts. A `playtest` game shows up only in its
  owner's game picker; `published` games show up for every host.

## AI-made games

Admins can generate new games with AI (plan §11); later, any host with their own GenAI
Studio key may too. The generator runs inside an
OpenShell sandbox using Purdue GenAI Studio; setup steps and model choices are in
[`generator/README.md`](generator/README.md). The game server itself doesn't need any of this.
With that set up, `npm run generate -- "<game idea>"` writes a game in the sandbox and saves
it under `generator/out/` for you to read.

Admins do it from the **admin page at `/admin`** (linked from the home page when you're
logged in as an admin). It uses the server's `/api/admin/generations` API. Generating is off
unless you start the server with `GENERATION_ENABLED=1`:

```sh
GENERATION_ENABLED=1 npm run dev:server
```

On the admin page you type an idea, pick a model, and watch its progress. Jobs run one at a
time. A finished game waits for review with its test report and code (shown as text; the
browser never runs it). **Playtest** makes it startable by you alone, **Publish** makes it
available to every host, and **Reject** takes it away. All of these apply immediately, without
a restart. Hosts see an **AI-made** badge on these games.

Games draw everything with the **game kit**: screens built from blocks (text, images, timers,
bars, buttons, choices, layouts…), all defined in `server/src/games/kit/blocks.js`.

Every game, hand-made or generated, can be checked with the **game test harness**:

```sh
npm run check-game -- server/src/games/reaction-race/index.js
```

It lints the code for rule-breaking (`Math.random`, `Date`, `async`, imports, …), checks the
GameModule, then plays 18 quick games with bot players on a simulated clock (different player
counts; eager, sloppy, and quiet players) and reports anything that went wrong, with a hint on
how to fix it. It runs the game's code in a separate, time- and memory-limited process. Only run
it on code you trust, or inside the generator's sandbox for code nobody has read yet.
