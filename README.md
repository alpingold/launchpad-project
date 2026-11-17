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

The browser tests need the browsers once: `npx playwright install chromium firefox webkit`, and on
Linux their system libraries: `sudo npx playwright install-deps`. They build what they need
themselves, into `e2e/.build/`.

The server also serves the Game frame on the next port up (http://localhost:3001/v1/), from
`client/dist/frame`, which `npm run build` makes.

`npm run dev -w @boilergames/client` serves the client with Vite's own dev server, which reloads
the page on every change.

The type check and the tests read the other packages' TypeScript source directly, so they never
need a build first. CI (`.github/workflows/test.yml`) runs the type check, the build and the tests
on every push and pull request.
