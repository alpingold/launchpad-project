#!/bin/bash
# Packs a built checkout into one archive the server can run. It writes three files in the repo's
# root, which CI attaches to a GitHub Release: release.tar.gz, release.tar.gz.sha256 (its checksum)
# and RELEASE (the commit id, which the server reads to see whether there is anything new).
#
# Run it after `npm ci` and `npm run build` have passed, from anywhere. CI runs it once the tests are
# green, so what is deployed is exactly what was tested. The archive holds the compiled output of
# every package and only the dependencies the server needs to run (no build or test tools).
set -euo pipefail
cd "$(dirname "$0")/.."

for built in sdk/dist protocol/dist server/dist/main.js client/dist/index.html client/dist-frame/v1/index.html games/dist/games.json; do
  [ -e "$built" ] || { echo "missing $built: run 'npm run build' first" >&2; exit 1; }
done

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

# npm needs every workspace's package.json to read the lockfile, built or not.
cp package.json package-lock.json "$stage/"
for package in sdk protocol server client games; do
  mkdir -p "$stage/$package"
  cp "$package/package.json" "$stage/$package/"
done
cp -r sdk/dist "$stage/sdk/dist"
cp -r protocol/dist "$stage/protocol/dist"
cp -r server/dist "$stage/server/dist"
cp -r client/dist "$stage/client/dist"
cp -r client/dist-frame "$stage/client/dist-frame"
cp -r games/dist "$stage/games/dist"

# Only what the server imports when it runs: its own dependencies and the two packages it uses.
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace=@boilergames/server >/dev/null)

# The release is named after the commit it was built from (CI passes it as RELEASE_ID).
echo "${RELEASE_ID:-$(git rev-parse HEAD)}" > "$stage/RELEASE"
tar -czf release.tar.gz -C "$stage" .
sha256sum release.tar.gz > release.tar.gz.sha256
cp "$stage/RELEASE" RELEASE
echo "release.tar.gz: $(du -h release.tar.gz | cut -f1), release $(cat RELEASE)"
