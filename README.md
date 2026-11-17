# BoilerGames (rewrite in progress)

Party games for one shared Screen and everyone's phones, and the tools to make your own.

This branch (`rewrite`) is a from-scratch rewrite in TypeScript. The live site,
[boilergames.party](https://boilergames.party), still runs from `main`.

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
```

`SCREENSHOTS=1 npx playwright test -c e2e/playwright.config.ts screenshots --project=chromium` takes
screenshots of the Lobby and each Official game, on the Screen and a phone, into
`.scratch/rewrite/screenshots/`.

The browser tests need the browsers once: `npx playwright install chromium firefox webkit`, and on
Linux their system libraries: `sudo npx playwright install-deps`. They build what they need
themselves, into `e2e/.build/`.

Settings, as environment variables: `PORT` (3000) and `FRAME_PORT` (the next one up); `SITE_ORIGIN`
(`http://localhost:3000`), the only origin whose pages may open a WebSocket; `MAX_ROOMS` (30), how
many Rooms may be open at once; `FRAME_URL`, where the Game frame's page is served (the next port
up in development). Behind a proxy such as Caddy, set `TRUST_PROXY=1`, so the
per-address limits see each phone's own address (the one the proxy appended to X-Forwarded-For)
rather than the proxy's.

The server also serves the Game frame on the next port up (http://localhost:3001/v1/), from
`client/dist-frame`, which `npm run build` makes. It is built outside `client/dist` on purpose:
the site serves `client/dist`, and must never serve the frame's page from its own origin.

`npm run dev -w @boilergames/client` serves the client with Vite's own dev server, which reloads
the page on every change.

The type check and the tests read the other packages' TypeScript source directly, so they never
need a build first. CI (`.github/workflows/test.yml`) runs the type check, the build and the tests
on every push and pull request.
