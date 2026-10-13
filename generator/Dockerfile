# The generator's sandbox image (plan §11, A4). Build from the REPO ROOT:
#   docker build -f generator/Dockerfile -t boilergames-generator:local .
#
# Only what the generator needs is copied in (see Dockerfile.dockerignore, an allow-list):
# the generator, its spec, the server's game code (contract, views, GameRunner, the test
# harness, the example games), and the art manifest. No dependencies are installed: all of
# it is plain Node. Everything is read-only at runtime (generator/openshell/policy.yaml).
FROM node:24-bookworm-slim

WORKDIR /app
COPY server/package.json server/package.json
COPY server/src server/src
COPY generator/package.json generator/package.json
COPY generator/src generator/src
COPY generator/spec generator/spec
# Same relative path as in the repo, so config.js finds it without an environment
# variable (`openshell sandbox exec` doesn't pass the image's ENV to commands).
COPY client/public/game-assets/manifest.json client/public/game-assets/manifest.json

# OpenShell refuses images that run as root; the node image ships a "node" user.
USER node
WORKDIR /tmp
