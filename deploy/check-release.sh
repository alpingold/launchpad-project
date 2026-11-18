#!/bin/bash
# Runs on the server, as root, once a minute (boilergames-release.timer): installs the newest
# release if it isn't the one running.
#
# The server fetches; nothing logs in to it. CI publishes each tested build as a GitHub Release whose
# RELEASE file holds its commit id. GitHub's "latest release" address always points at the newest, so
# one small download says whether there is anything to do.
#
# A release that failed to install is remembered and not tried again every minute. To retry it, or
# to go back to an older one, run boilergames-install-release with its id.
set -euo pipefail

REPO=https://github.com/alpingold/launchpad-project
ROOT=/opt/boilergames

latest=$(curl -fsSL --max-time 20 "$REPO/releases/latest/download/RELEASE" 2>/dev/null | tr -d '[:space:]') || exit 0
[[ $latest =~ ^[0-9a-f]{40}$ ]] || exit 0

running=$(cat "$ROOT/current/RELEASE" 2>/dev/null || true)
[ "$latest" = "$running" ] && exit 0
[ -e "$ROOT/failed/$latest" ] && exit 0

echo "new release $latest (running: ${running:-none})"
if ! /usr/local/bin/boilergames-install-release "$latest"; then
  mkdir -p "$ROOT/failed"
  date -u +%FT%TZ > "$ROOT/failed/$latest"
  exit 1
fi
