# The generator's sandbox image (plan §11, A4; the browser since F4). Build from the REPO ROOT:
#   docker build -f generator/Dockerfile -t boilergames-generator:local .
#
# Only what the generator needs is copied in (see Dockerfile.dockerignore, an allow-list):
# the generator, its rulebook and designs, its game checker, the server's game
# code it reuses (game info, static check, FrameRelay, protocol checks, the example games),
# the frame document and SDK the site puts around a game, and the art library. Everything
# is read-only at runtime (generator/openshell/policy.yaml).
FROM node:24-bookworm-slim

WORKDIR /app

# The headless browser for the playtest (F4): playwright-core (the generator's one
# dependency), then Playwright's headless Chromium and the system libraries it needs.
# It goes under /app, which the sandbox may read; a home folder isn't readable there.
# First, so this slow layer is reused when only our code changes.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/ms-playwright
COPY generator/package.json generator/package-lock.json generator/
RUN cd generator \
 && npm ci --omit=dev \
 && npx playwright-core install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache

COPY server/package.json server/package.json
COPY server/src server/src
COPY client/src/game/frame client/src/game/frame
COPY client/public/game-assets client/public/game-assets
COPY generator/src generator/src
COPY generator/spec generator/spec

# OpenShell refuses images that run as root; the node image ships a "node" user.
USER node
WORKDIR /tmp
