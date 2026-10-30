# BoilerGames (rewrite in progress)

Party games for one shared Screen and everyone's phones, and the tools to make your own.

This branch (`rewrite`) is a from-scratch rewrite in TypeScript. The live site,
[boilergames.party](https://boilergames.party), still runs from `main`.

- What it is and the decisions behind it: [docs/SPEC.md](docs/SPEC.md)
- The words it uses: [GLOSSARY.md](GLOSSARY.md)
- Lasting decisions: [docs/adr/](docs/adr/)

## The packages

One repository of npm workspaces, each a folder at the root:

| Package     | What it holds                                                   |
| ----------- | --------------------------------------------------------------- |
| `shared`    | Types and schemas used by every other package                   |
| `sdk`       | What Games are written against, and the runtime that runs them  |
| `server`    | The one server process                                          |
| `generator` | Generations and Playtests                                       |
| `client`    | The site's pages (React, built by Vite)                         |
| `e2e`       | Browser tests of the whole site                                 |

Packages import each other by name (`import { siteName } from "@boilergames/shared"`). Every
package's `tsconfig.json` extends the strict `tsconfig.base.json`.

## Working on it

You need Node 24. Everything runs from the root folder.

```sh
npm ci             # install every package's dependencies (npm install to add or update one)
npm run build      # tsc compiles shared, sdk, server and generator to dist/; Vite builds the client
npm run typecheck  # type-check every package, tests included
npm test           # run every package's tests (Vitest)
npm run dev        # recompile on every change and restart the server (http://localhost:3000)
```

`npm run dev -w @boilergames/client` serves the client with Vite's own dev server, which reloads
the page on every change.

The type check and the tests read the other packages' TypeScript source directly, so they never
need a build first. CI (`.github/workflows/test.yml`) runs the type check, the build and the tests
on every push and pull request.
