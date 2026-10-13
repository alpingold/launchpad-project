# A0 spike image: just Node and one test script. Not the real generator (that's A4).
# Build:  docker build -t boilergames-spike:local generator/spike
FROM node:24-bookworm-slim

COPY spike.mjs /app/spike.mjs

# OpenShell refuses images that run as root; the node image ships a "node" user.
USER node
WORKDIR /tmp
