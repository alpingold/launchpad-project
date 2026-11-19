# BoilerGames

Party games for one shared Screen and everyone's phones, and the tools to make your own.

This branch (`rewrite`) is a from-scratch rewrite in TypeScript, and it is what runs at
[boilergames.party](https://boilergames.party): every push here that passes its tests is deployed
(see [How the site is deployed](#how-the-site-is-deployed)). The first site's code is on `main`.

- What it is and the decisions behind it: [docs/SPEC.md](docs/SPEC.md)
- The order of work: [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md)
- The words it uses: [GLOSSARY.md](GLOSSARY.md)
- Lasting decisions: [docs/adr/](docs/adr/)

## The packages

One repository of npm workspaces, each a folder at the root:

| Package  | What it holds                                                          |
| -------- | ---------------------------------------------------------------------- |
| `sdk`    | What Games are written against (`sdk/src/v1`), with no dependencies    |
| `protocol` | The messages between the Screen, the server and the phones (Zod)     |
| `server` | The one server process                                                 |
| `client` | The site's pages (React, built by Vite)                                |
| `games`  | The Official games, each built into one bundle the Game frame runs     |
| `playtest` | The Playtest: type-checks, bundles and plays a Game's source; the one definition of a bundle |

Packages import each other by name (`import { defineGame } from "@boilergames/sdk/v1"`). Every
package's `tsconfig.json` extends the strict `tsconfig.base.json`.

## Working on it

You need Node 24. Everything runs from the root folder.

```sh
npm ci             # install every package's dependencies (npm install to add or update one)
npm run build      # tsc compiles sdk, protocol and server to dist/; Vite builds the client and the games
npm run typecheck  # type-check every package, tests included
npm test           # run every package's tests (Vitest)
npm run test:e2e   # the browser tests (Playwright): Chromium, Firefox and WebKit, fresh and saved profiles
npm run dev        # recompile on every change and restart the server (http://localhost:3000)
npm run dev -- --lan  # the same, reachable from phones on the same Wi-Fi (see "Playing a Room with real phones")
```

`SCREENSHOTS=1 npx playwright test -c e2e/playwright.config.ts screenshots --project=chromium` takes
screenshots of the Lobby and each Official game, on the Screen and a phone, into
`.scratch/rewrite/screenshots/`.

The browser tests need the browsers once: `npx playwright install chromium firefox webkit`, and on
Linux their system libraries: `sudo npx playwright install-deps`. They build most of what they need
themselves, into `e2e/.build/`, but not the Playtest's runner, which their uploads run: run
`npm run build` first.

### Signing in and uploading a Game, on your own computer

1. `npm run dev`, and open http://localhost:3000.
2. Sign in with any `@purdue.edu` address. No email is sent while developing: the server prints the
   sign-in link to its console (the terminal running `npm run dev`). Open that link in the same
   browser and press **Sign in**, then pick a display name.
3. **My Games** (http://localhost:3000/my/games): choose a Game's `.ts` file or paste its code, and
   upload it. The real Playtest checks it, in a child process with no wall around it: fine for your
   own code on your own computer, and never how the server runs it (`PLAYTEST_SOCKET` below).
4. When it is ready, **Play it** opens a Screen with a Room on that Version; **Publish** puts it in
   every Screen's list of Games.

Without `DATABASE_FILE` the database is in memory, so every restart forgets every account and Game.
To keep them: `DATABASE_FILE=dev.db npm run dev` (`*.db` files are never committed).

Settings, as environment variables: `HOST` (`localhost`: only this computer can reach the server),
`PORT` (3000) and `FRAME_PORT` (the next one up); `SITE_ORIGIN`
(`http://localhost:3000`), the only origin whose pages may open a WebSocket; `MAX_ROOMS` (30), how
many Rooms may be open at once; `FRAME_URL`, where the Game frame's page is served (the next port
up in development). Behind a proxy such as Caddy, set `TRUST_PROXY=1`, so the
per-address limits see each phone's own address (the one the proxy appended to X-Forwarded-For)
rather than the proxy's.

`DATABASE_FILE` is the database (SQLite, one file; ADR 0007). The server applies the migrations in
`server/migrations` at start, copying the file beside itself first if it already holds data. Without
`DATABASE_FILE` the database is in memory and forgotten on every restart, which is fine while
developing; with `NODE_ENV=production` the server refuses to start without it.

`MAIL=ses` sends the sign-in emails through Amazon SES, from `sign-in@boilergames.party`, in
`AWS_REGION` (us-east-2 unless set), signed with the server's own AWS role. Without `MAIL`, emails
are kept in memory and each one's link is printed to the console, so signing in works while
developing; with `NODE_ENV=production` the server refuses to start without `MAIL=ses`.

`PLAYTEST_SOCKET` is the Unix socket of the Playtest's walled runner (`deploy/boilergames-playtest.socket`
and `boilergames-playtest@.service`, whose runs share one budget in `boilergames-playtest.slice`,
inside `boilergames.slice` beside the site). Without it, a Playtest runs in a child process with no wall,
which is only for developing; with `NODE_ENV=production` and no `PLAYTEST_SOCKET`, there is no
Playtest at all, so Uploads are refused. `deploy/attack-playtest.sh` attacks the wall, on a
throwaway server only.

The server also serves the Game frame on the next port up (http://localhost:3001/v1/), from
`client/dist-frame`, which `npm run build` makes. It is built outside `client/dist` on purpose:
the site serves `client/dist`, and must never serve the frame's page from its own origin.

`npm run dev -w @boilergames/client` serves the client with Vite's own dev server, which reloads
the page on every change.

The type check and the tests read the other packages' TypeScript source directly, so they never
need a build first. CI (`.github/workflows/test.yml`) runs on every push and pull request: one job
runs the type check, the build and the tests; another installs the three browsers and runs the
browser tests, keeping each failed test's trace and screenshot.

## Playing a Room with real phones

The phones and the computer showing the Screen must be on the same Wi-Fi.

1. `npm ci`, then `npm run build` (again whenever the client or the Games change).
2. `npm run dev -- --lan`. It serves the site and the Game frame on this computer's network address
   instead of only to itself, and prints the addresses to use, such as
   `http://192.168.1.20:3000/screen` for the Screen and `http://192.168.1.20:3000/play` for phones.
3. On the computer, open the printed Screen address: that address, not `localhost`, because the
   server only accepts the pages of the site's own address (`SITE_ORIGIN`, which `--lan` sets).
4. On each phone, open the printed `/play` address and type the Room Code from the Screen.

`--lan` picks the first Wi-Fi or Ethernet address it finds and lists the others; name the right one
with `--lan=192.168.1.20` if it picks wrong.

What is different from the deployed site:
- Plain http from a network address is not a secure context. Nothing breaks, but phones can't be
  kept awake during a Match (the wake lock is unavailable): set their screen timeout longer.
- The site and the Game frame differ only by port, so to the browser they are the same site; in
  production the frame has its own domain (ADR 0004). The frame's sandbox and CSP still apply.
- If a firewall on the computer blocks ports 3000 and 3001, phones get nothing. On Linux with ufw:
  `sudo ufw allow 3000:3001/tcp`.

### When the server runs in WSL2

By default WSL2 sits behind a private network inside Windows: its address (`172.x.x.x`, what
`hostname -I` shows) can't be reached from the Wi-Fi. On the Windows side, one of:

**Mirrored networking** (Windows 11 22H2 or later). Then WSL2 has the Windows computer's own Wi-Fi
address, and `npm run dev -- --lan` finds it.
1. In `%UserProfile%\.wslconfig` (create it if needed):
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
2. In PowerShell: `wsl --shutdown`, then open WSL again.
3. Let the Wi-Fi in, in PowerShell as administrator:
   ```powershell
   Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
   ```
   (That GUID names WSL. To undo: the same with `-DefaultInboundAction Block`.)

**Port forwarding** (any Windows), in PowerShell as administrator, with the WSL address from
`hostname -I` in WSL:
```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=3000 connectaddress=172.28.125.110 connectport=3000
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=3001 connectaddress=172.28.125.110 connectport=3001
New-NetFirewallRule -DisplayName "BoilerGames dev" -Direction Inbound -Protocol TCP -LocalPort 3000,3001 -Action Allow -Profile Private
```
Then in WSL, with the Windows computer's Wi-Fi address (from `ipconfig` on Windows):
`npm run dev -- --lan=192.168.1.20`. The WSL address changes when WSL restarts; then redo the two
`portproxy` lines. To remove them: `netsh interface portproxy reset`.

Either way, Windows must count the Wi-Fi as a Private network (Settings, Network, the Wi-Fi's
properties), or its firewall turns the phones away.

What was tested: `--lan` binds every interface and prints the addresses; the Screen and phones work
in Chromium, Firefox and WebKit from the WSL2 network address on the same computer, where pages are
not a secure context; without `--lan` the server answers only `localhost`. Not tested: a real phone,
and every Windows-side step above (mirrored networking, the firewall commands, port forwarding).

## How the site is deployed

One small server (an EC2 `t4g.small` in us-east-2) runs the Node process behind Caddy, which
handles HTTPS for both domains. Everything the server needs is in [`deploy/`](deploy).

A push to `rewrite` deploys itself, without anyone logging in to the server:

1. CI type-checks, builds, and runs the unit and browser tests.
2. If all are green, CI packs the build (`deploy/package-release.sh`) and publishes it as a GitHub
   Release named after the commit.
3. Once a minute the server asks GitHub for the newest release (`deploy/check-release.sh`). If it
   isn't the one running, it downloads it, checks its checksum, switches to it, and checks that the
   site and the Game frame answer. If they don't, it switches back (`deploy/install-release.sh`).

The server fetches; nothing reaches in. GitHub holds no AWS credentials, the server has no SSH
port open, and the site's own user can read its code but not change it.

Worth knowing:
- A deploy restarts the site, which closes every open Room: Rooms live in the server's memory.
- To go back to an earlier release, run `boilergames-install-release <commit id>` on the server.
  From a signed-in AWS CLI:
  `aws ssm send-command --document-name boilergames-deploy --instance-ids <server> --parameters releaseId=<commit id>`.
- A release that fails to install is not retried every minute; fix it with a new commit.
- The server's settings are `deploy/boilergames.env`, installed as `/etc/boilergames.env`. A changed
  setting, service file or Caddyfile is not deployed by a push: run `deploy/setup-server.sh` again.
- Both domains' DNS records must point straight at the server (at Cloudflare: "DNS only"). Caddy
  needs that to get certificates, and nothing may sit in front of the game domain that could change
  its Content-Security-Policy header (ADR 0004).

### The database's backups

Accounts and Games live in one file on the one server, so every night at 09:00 UTC a timer
(`boilergames-backup.timer`) runs `deploy/backup-database.sh`. It makes a complete copy of the
database while the site keeps running, checks the copy, compresses it and uploads it to the S3
bucket `boilergames-party-backups` as `database/<the time>.db.gz`. The bucket stops listing a copy after
30 days and deletes it for good 30 days after that, so a copy exists for up to 60 days. (The second
30 days is what stops anyone, the server included, from destroying a backup by writing over it.) The server may only add files there: it can't read or delete them, so a break-in on the
server can't reach the backups. At most a day of changes can be lost.

Did last night's run work? On the server: `systemctl status boilergames-backup.service`. Nothing
warns anyone when it fails, so look now and then (`aws s3 ls s3://boilergames-party-backups/database/`
from a signed-in AWS CLI lists the copies).

To put a backup back, from a signed-in AWS CLI download one and unpack it:

    aws s3 cp s3://boilergames-party-backups/database/<name>.db.gz . && gunzip <name>.db.gz

Then on the server, as root: stop the site (`systemctl stop boilergames`), move the old
`/var/lib/boilergames/boilergames.db`, `.db-wal` and `.db-shm` aside, put the unpacked file there as
`boilergames.db` owned by `boilergames`, and start the site again.

### Removing an account by hand

Until account deletion exists (milestone 4), someone who wants their account gone writes to
hello@boilergames.party (the privacy page says so). Check that the message comes from the address
the account signs in with. Then, on the server, as the site's user:

    sudo -u boilergames /usr/local/bin/node /opt/boilergames/current/server/dist/remove-account.js

It asks for the email address and reads it as you type it, rather than taking it on the command
line: sudo writes every command line to the server's log, and the address of someone who asked to
be removed mustn't stay there. (The command that makes an admin, below, does put the admin's address
on its command line.)

It removes everything the database keeps about the account, in one transaction per file, in the
order the tables' keys allow (`server/src/db/remove-account.ts`, tested on a database in memory):

1. its Games are unpublished (a Game and its published Version point at each other, so that link
   goes first);
2. every Version of its Games, with their code;
3. its Games' counts of plays;
4. its Games;
5. its sessions;
6. its GenAI Studio key, encrypted;
7. sign-in links sent to its address;
8. the account.

It does the same in each copy the server made of the database before a migration (up to three,
`/var/lib/boilergames/boilergames.db.backup-*`), which would otherwise keep the account. For each
file it prints how many of each went, or that the account isn't in it. The site can keep running
while it does.

What it removes is overwritten with zeros, not only marked as free space (SQLite's `secure_delete`),
and each file's write-ahead log is then emptied, so the code and the address can't be read back out
of the files. If the site is too busy for the log to be emptied within 5 seconds, it says so: stop
the site (`systemctl stop boilergames`), run it again with the same address, and start the site.

A published Game of the account's leaves the Library and the Lobby at once, and its code is refused
from then on. A Room playing it at that moment finishes its Match on the code it already has, but a
reload of that Screen can't load the code again and says so. Nothing else needs doing.

The nightly copies still hold the account until each is deleted for good, up to 60 days after it was
made: tell the person so in the reply.

### Admins, and taking a Game down

Uploaded Games are public as soon as their Creator publishes them, without review, so an admin can
take any Game down. There is no page for it yet (milestone 4). An account is made an admin by hand,
on the server, as the site's user, with the account's email address:

    sudo -u boilergames /usr/local/bin/node -e 'const db = new (require("node:sqlite").DatabaseSync)("/var/lib/boilergames/boilergames.db"); console.log(db.prepare("UPDATE accounts SET admin = 1 WHERE email = ?").run(process.argv[1]).changes, "account(s) made an admin")' someone@purdue.edu

(`admin = 0` undoes it.) Then, signed in on the site as that account, in the browser's console on
any of the site's pages, with the `id` that `/api/games` lists for the Game (or the Game's own id),
to take it down:

    fetch("/api/admin/games/<id>/take-down", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json()).then(console.log)

The Game leaves the list at once, and its code is refused to everyone but its Creator. The takedown
sticks: its Creator can't publish it again (their page for it says an admin took it down), though
they can still upload Versions and play them privately. To lift it, so the Creator may publish
again (nothing is published by lifting it):

    fetch("/api/admin/games/<id>/lift-takedown", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json()).then(console.log)

Either id works for both; once the Game is down the list no longer shows it, so use the Game's own
id, which the first command answers with. The server's log names the admin and the Game each time.
