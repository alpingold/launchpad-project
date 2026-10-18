# Game generator (AI-made games)

> **Branch `iframe-games`: frame games, designed first (F5, plan §13i).** Every game is
> made in two steps you approve: the AI writes a short **design**, you read it (ask for a new
> draft, or edit it), and only **Build it** writes the code, which is checked in the sandbox
> by the static check and a playtest in a headless browser. Changes work the same way, with
> a short **plan** first (a small fix may skip it). The block version is on `main`.

The code here runs **inside an OpenShell sandbox**, never on the game server: that's where
the GenAI Studio key is, and where freshly written games are played for the first time.
Each sandbox job is one step (`src/run.js`): a design (or plan, or new draft), or a build.
A build asks the model for the game file, checks it, and if it fails, sends the model the
problems (by line and screen) and tries again, up to 4 attempts.

```
generator/
  src/run.js                    one job: { step: 'design' | 'build', idea, design?, change?, redraft? }
                                design → a design or change plan; build → write → check → fix
  src/prompt.js                 what the model reads: design step = rulebook + design format + art list
                                + the idea; build step = rulebook + art list + the approved design
  src/llm.js                    GenAI Studio chat API (plain fetch, retries on rate limits)
  src/extract.js                pulls the game file, design or list of changes out of a reply
  src/models.js                 the allowed models
  src/check/checkGame.js        F4: game info + static check + browser playtest → one report
  src/check/playtest.js         F4: plays the game in headless Chromium with simulated phones
  src/check/cli.js              F4: `npm run check-game -- <file>`
  test/                         F4: the checker on broken games (`npm run test:check`)
  spec/GAME_SPEC.md             F5: the rulebook: how frame games work, the party SDK, party.ui (also /kit)
  spec/DESIGN.md                F5: how a design is written: the fixed headings (also /kit)
  spec/designs/                 F5: designs of the three official games, in that format
  Dockerfile                    the sandbox image (+ Dockerfile.dockerignore, an allow-list)
  openshell/genai-studio.yaml   provider profile: how the sandbox uses the API key without seeing it
  openshell/policy.yaml         sandbox policy: which files it may read/write (network comes from the provider)
  spike/                        A0 test image: proves the sandbox setup works (5 checks)
  out/                          results of `npm run generate` (not in git)
```

## Checking a game (F4)

```bash
npm run check-game -- <game.html> [--players 3] [--seconds 20] [--shots <folder>] [--headed]
```

Three steps, one report (the same shape the admin page shows):

1. **Game info**: the JSON block at the top (`server/src/games/frameGame.js`).
2. **Static check** (`server/src/games/staticCheck.js`): reads the file without running it and
   points at lines that use the network, leave the frame (`location`, links, forms), run code
   from text, use storage or pop-ups, or load outside files. It skips strings and comments.
   This catches a model's habits; the sandbox and CSP are the real wall.
3. **Browser playtest** (`src/check/playtest.js`): headless Chromium, one page for the big
   screen and one per phone, each with the game in the same sandboxed iframe and CSP as the
   site, connected through the server's own `FrameRelay`. Bots tap buttons, drag, type and
   press keys; one phone and then the big screen reload mid-game. It reports errors (with
   the game's line), CSP violation reports (the game *tried* to reach something), requests,
   leaving the frame, a hung or blank screen, phones that never hear from the big screen,
   messages or results the server would refuse, and takes screenshots.

**It runs the game.** On your machine, use it on files you wrote or chose; generated games
are checked inside the sandbox. Locally it uses the Chromium the browser tests installed
(`npx playwright install chromium` in `e2e/`); the image installs its own under
`/app/ms-playwright` (about 1.2 GB on disk). In the sandbox Chromium runs with
`--no-zygote --disable-gpu`, because OpenShell forbids the user namespaces they need.

**WSL: don't use `networkingMode=mirrored`.** It puts a seccomp listener on every process in
WSL, and OpenShell's supervisor needs its own (the kernel allows one), so every sandbox fails
with "seccomp notification probe: notification launcher disappeared". To reach the dev
server from a phone, install Tailscale inside WSL instead.

To try the image without OpenShell:

```bash
docker run --rm --network none -v "$PWD/game.html:/tmp/game.html:ro" boilergames-generator:local \
  node /app/generator/src/check/cli.js /tmp/game.html
```

## Generating a game

The usual way is the admin page (`/admin`, needs `GENERATION_ENABLED=1`). From a terminal,
after the one-time setup below, from the repo root:

```bash
docker build -f generator/Dockerfile -t boilergames-generator:local .   # again after changing the
                                                                        # generator, spec, or game code
npm run generate -- "A racing platformer where everyone shares one level"
```

It writes the design to `generator/out/<time>/design.md` and shows it. Press Enter to build
it, type feedback for a new draft, `e` to edit the file yourself, or `q` to stop. The build
saves `game.html`, `result.json` (the report and every attempt) and the playtest's
screenshots next to it. `--design <file>` builds from a design you already have; `--yes`
builds the first design without asking. Nothing is stored or run on the server. **Read the
code**: the checks catch broken games, not unfair or confusing ones. If you like it:

```bash
npm run admin -- import-game generator/out/<time>/game.html --owner <your username>
```

How it runs (`server/src/generation/sandbox.js`): `openshell sandbox create` (a fresh
sandbox from the image, with the provider and policy) → `openshell sandbox exec` with the
job piped in on stdin → `openshell sandbox delete`, always. `sandbox create` doesn't
forward stdin and `sandbox exec` doesn't pass the image's `ENV`, which is why it's done this way
and why the image keeps files at their repo paths. Sandbox names may be at most 19 characters.

## Models

`qwen3.8:27b`, the only one. It "thinks" before it writes, so an attempt takes about 1–3
minutes. `gpt-oss:120b` was the fast default until 2026-10-14 (about 30 s per attempt), but
qwen made the better games in both comparisons (docs/PLAN.md §11g, §12j), so it was dropped.
Adding a model back is one line in `src/models.js`.

## One-time setup (milestone A0)

Needs Docker Engine and OpenShell on Linux / WSL 2.

1. **Docker:** `sudo apt install docker.io docker-buildx`, then `sudo usermod -aG docker $USER`,
   and restart WSL (`wsl --shutdown` from Windows). Check with `docker run --rm hello-world`.
   Being in the `docker` group is effectively root on this machine; fine for a personal dev box.
2. **OpenShell:** download `https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh`,
   read it, run it with `sh`, then check `openshell status`. If the gateway fails with
   "no compute driver", Docker isn't reachable yet (usually WSL wasn't restarted after step 1).
3. **API key:** create one at genai.rcac.purdue.edu → Settings → Account → API Keys.
4. **Provider** (from the repo root). `read -s` keeps the key off the screen and out of shell history.
   Paste the key when asked and press Enter:
   ```bash
   openshell profile import -f generator/openshell/genai-studio.yaml
   read -rsp "GenAI Studio key: " GENAI_API_KEY && export GENAI_API_KEY
   openshell provider create --name genai-studio --type genai-studio --from-existing
   unset GENAI_API_KEY
   ```
   From now on the key lives only in OpenShell's credential store. Sandboxes see a placeholder.
5. **Check everything works:**
   ```bash
   docker build -t boilergames-spike:local generator/spike
   openshell sandbox create --no-keep --from boilergames-spike:local \
     --provider genai-studio --policy generator/openshell/policy.yaml -- node /app/spike.mjs
   ```
   Expect five `PASS` lines: the key is a placeholder, GenAI Studio is reachable, a chat works,
   other websites are blocked, and `/app` is read-only.

Always pass `--policy generator/openshell/policy.yaml`: OpenShell's default policy doesn't let
the sandbox read `/app`, where our code lives.
