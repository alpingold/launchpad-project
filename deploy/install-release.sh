#!/bin/bash
# Runs on the server, as root: installs one release and switches the site to it.
#
#   boilergames-install-release <release id>
#
# The release id is the commit CI built. CI attaches the archive to a GitHub Release named
# r-<release id>; this script downloads it, checks it against its published checksum, unpacks it
# beside the earlier releases, and points `current` at it. If the site doesn't answer afterwards,
# `current` goes back to the release that was running, so a bad release costs seconds.
#
# To go back to an earlier release by hand, run this with its id: releases already on disk are not
# downloaded again.
#
# Restarting the site closes every open Room: Rooms live in the server's memory.
set -euo pipefail

REPO=https://github.com/alpingold/launchpad-project
ROOT=/opt/boilergames
KEEP=5

id=${1:-}
[[ $id =~ ^[0-9a-f]{40}$ ]] || { echo "usage: $0 <40-character commit id>" >&2; exit 2; }

release=$ROOT/releases/$id
if [ ! -d "$release" ]; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  curl -fsSL --max-time 120 -o "$work/release.tar.gz" "$REPO/releases/download/r-$id/release.tar.gz"
  curl -fsSL --max-time 30 -o "$work/release.tar.gz.sha256" "$REPO/releases/download/r-$id/release.tar.gz.sha256"
  (cd "$work" && sha256sum -c release.tar.gz.sha256 >/dev/null) || { echo "the archive does not match its checksum" >&2; exit 1; }
  mkdir "$work/release"
  tar -xzf "$work/release.tar.gz" -C "$work/release" --no-same-owner
  [ "$(cat "$work/release/RELEASE")" = "$id" ] || { echo "the archive is not release $id" >&2; exit 1; }
  # Owned by root and read-only to the site's user: the running site can't rewrite its own code.
  chown -R root:root "$work/release"
  chmod -R a+rX,go-w "$work/release"
  mv "$work/release" "$release"
fi

previous=$(readlink "$ROOT/current" 2>/dev/null || true)

switch_to() {
  ln -sfn "$1" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  systemctl restart boilergames
}

# One real Playtest of a small Game through the socket, as the site's user. Skipped on a server
# that has no Playtest socket, or for a release from before the check existed.
playtest_works() {
  [ -S /run/boilergames-playtest.sock ] && [ -f "$ROOT/current/deploy/check-playtest.mjs" ] || return 0
  runuser -u boilergames -- /usr/local/bin/node "$ROOT/current/deploy/check-playtest.mjs" >&2
}

# The site answers its settings, and the game domain serves the frame page with its policy header.
healthy() {
  for _ in $(seq 1 20); do
    if curl -fs -o /dev/null http://127.0.0.1:3000/api/config &&
      curl -fs -D - -o /dev/null http://127.0.0.1:3001/v1/ | grep -qi '^content-security-policy:'; then
      playtest_works
      return
    fi
    sleep 1
  done
  return 1
}

switch_to "$release"
if ! healthy; then
  echo "release $id did not come up; the last lines of its log:" >&2
  journalctl -u boilergames -n 30 --no-pager >&2 || true
  if [ -n "$previous" ] && [ -d "$previous" ] && [ "$previous" != "$release" ]; then
    switch_to "$previous"
    if healthy; then echo "back on $(basename "$previous")" >&2; else echo "the earlier release did not come up either" >&2; fi
  fi
  exit 1
fi

# Keep the newest few releases to go back to, and never remove the one that is running.
ls -1dt "$ROOT"/releases/*/ | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$ROOT/current")" ] || rm -rf "$old"
done

echo "running release $id"
