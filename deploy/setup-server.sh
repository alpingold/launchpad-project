#!/bin/bash
# Prepares a fresh Ubuntu 24.04 (ARM) server to run BoilerGames. Run once, as root, from a copy of
# this folder. Safe to run again: each part is skipped or overwritten with the same thing.
#
# It installs Node and Caddy, creates the site's own user, and installs the service, its settings,
# the release scripts and the once-a-minute check for a new release. It does not install a release:
# the check does that within a minute, or run `boilergames-install-release <commit id>`.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
here=$(cd "$(dirname "$0")" && pwd)

# --- Node, from nodejs.org, checked against the checksum published with it
NODE=node-v24.22.3-linux-arm64
NODE_SHA256=6e51a2ada00f0011cc266f65d98922b403d7ad88f809ca2aa615a5fe1ce6e86c
if [ ! -x "/opt/$NODE/bin/node" ]; then
  cd /tmp
  curl -fsSLO "https://nodejs.org/dist/v24.22.3/$NODE.tar.xz"
  echo "$NODE_SHA256  $NODE.tar.xz" | sha256sum -c -
  tar -xJf "$NODE.tar.xz" -C /opt
  rm "$NODE.tar.xz"
fi
ln -sfn "/opt/$NODE/bin/node" /usr/local/bin/node

# --- Caddy, from its official package source
if ! command -v caddy >/dev/null; then
  apt-get update -q
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

# --- The site's own user, and where releases live. The site's user can read its code, not change it.
id boilergames >/dev/null 2>&1 || useradd --system --home-dir /opt/boilergames --shell /usr/sbin/nologin boilergames
mkdir -p /opt/boilergames/releases
chown root:root /opt/boilergames /opt/boilergames/releases

# --- Settings, the service, the release scripts and the timer
install -m 644 "$here/boilergames.env" /etc/boilergames.env
install -m 644 "$here/boilergames.service" /etc/systemd/system/boilergames.service
install -m 644 "$here/boilergames-release.service" /etc/systemd/system/boilergames-release.service
install -m 644 "$here/boilergames-release.timer" /etc/systemd/system/boilergames-release.timer
install -m 755 "$here/install-release.sh" /usr/local/bin/boilergames-install-release
install -m 755 "$here/check-release.sh" /usr/local/bin/boilergames-check-release
systemctl daemon-reload
systemctl enable boilergames.service
systemctl enable --now boilergames-release.timer

# --- Caddy. It asks for a certificate for each name in the Caddyfile, so the names' DNS records
# must already point at this server, or it will keep failing and may be rate-limited.
install -m 644 "$here/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy

echo "node $(node --version), $(caddy version | cut -d' ' -f1)"
