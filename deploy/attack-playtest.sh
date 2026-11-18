#!/bin/bash
# Attacks the Playtest's wall (boilergames-playtest@.service) through its real socket, and fails
# unless every attack is contained. BUILD-PLAN Step 13 wrote it; Step 16 runs it, with the owner.
#
# THROWAWAY SERVER ONLY. Run it on a server set up exactly like the live one (deploy/setup-server.sh,
# a release installed, the Playtest's socket and service), never on the live one. The attacks are
# real: they try to reach the network, read the site's secrets, fill memory and start processes.
#
# For the attacks to reach the wall at all, a hostile Game must first get out of Node's `vm`. So
# that one weak spot doesn't hide the others, the runner on the throwaway server is started with
# --attack-test, which hands each Game Node's `process` and `require`: install deploy/attack-test.conf
# as a drop-in first (it says how). The script refuses to run if the switch is off.
#
#   sudo deploy/attack-playtest.sh
#
# Each attack is described in deploy/attack-playtest.mjs: what it tries, and what "contained" means.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
socket=${PLAYTEST_SOCKET:-/run/boilergames-playtest.sock}
release=${RELEASE_DIR:-/opt/boilergames/current}

[ "$(id -u)" = 0 ] || { echo "run as root (sudo): the attacks connect as the site's user, and look at what is left afterwards" >&2; exit 1; }
[ -S "$socket" ] || { echo "no Playtest socket at $socket: is boilergames-playtest.socket running?" >&2; exit 1; }
[ -f "$release/playtest/dist/client.js" ] || { echo "no release at $release" >&2; exit 1; }

echo "This attacks the Playtest's wall on THIS server ($(hostname))."
read -r -p "Type THROWAWAY to confirm this is not the live server: " answer
[ "$answer" = "THROWAWAY" ] || { echo "Not confirmed; nothing done."; exit 1; }

# The site's user is the only one the socket lets in.
exec sudo -u boilergames PLAYTEST_SOCKET="$socket" RELEASE_DIR="$release" /usr/local/bin/node "$here/attack-playtest.mjs"
