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
Linux their system libraries: `sudo npx playwright install-deps`. They build what they need
themselves, into `e2e/.build/`.

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
