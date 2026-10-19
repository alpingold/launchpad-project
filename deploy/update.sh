#!/usr/bin/env bash
# Updates the live site to the newest commit on GitHub (main), with as little downtime as we can:
#
#   1. builds the new version off to the side (~/boilergames-next) while the site keeps running,
#      and runs its tests: a version that fails them stops here
#   2. tries it on a copy of the database, on another port: a broken build never goes live
#   3. waits until nobody is playing or making a game (a restart ends every open room, plan §9)
#   4. switches over and restarts: ~2 s, and Caddy holds visitors' requests meanwhile
#   5. checks the new version answers; if it doesn't, puts the old one back
#
# Usage (on the server, as ubuntu):  ~/boilergames/deploy/update.sh [--now] [--wait MINUTES]
#   --now            restart straight away, even if people are playing (their rooms end)
#   --wait MINUTES   how long to wait for nobody playing (default 30); after that it stops
#                    and changes nothing
#
# Needs sudo (restarting the service). See deploy/README.md, "Updating the site".

set -euo pipefail

APP="$HOME/boilergames"        # the live site (a git checkout)
NEXT="$HOME/boilergames-next"  # where the new version is built: a git worktree of APP
IMAGE=boilergames-generator    # :local is the one in use, :next the new one, :previous the old
TRY_PORT=3001                  # where the new version is tried before it goes live
tmp=''                         # step 2's private folder, and its trial server
try_pid=''
trap '[ -n "$try_pid" ] && kill "$try_pid" 2>/dev/null; [ -n "$tmp" ] && rm -rf "$tmp"' EXIT

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nupdate: %s\n' "$*" >&2; exit 1; }

# Swaps two folders (renames on the same disk: instant). Swapping again undoes it.
swap() {
  rm -rf "$1.swap"
  mv "$1" "$1.swap" && mv "$2" "$1" && mv "$1.swap" "$2"
}

# Prints "rooms generating" from the live server, or nothing if it can't tell (the server is
# down, or an older version without /api/status).
activity() {
  local json
  json=$(curl -fsS --max-time 5 "http://127.0.0.1:3000/api/status" 2>/dev/null) || return 0
  node -e 'const s = JSON.parse(process.argv[1]); console.log(`${s.rooms} ${s.generating}`)' "$json"
}

# Waits until /api/health answers ok on this port, for up to $2 seconds. $3: a process that must
# stay alive meanwhile (optional).
wait_healthy() {
  local port=$1 seconds=$2 pid=${3:-}
  for _ in $(seq "$seconds"); do
    [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && return 1
    [[ "$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null)" == *'"ok":true'* ]] && return 0
    sleep 1
  done
  return 1
}

# Everything is in main(), which bash reads in full before running it: step 4 changes this very
# file (git), and bash would otherwise go on reading the new version halfway through.
main() {
  local wait_minutes=30 now=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --now) now=1 ;;
      --wait) wait_minutes=${2:?--wait needs a number of minutes}; shift ;;
      -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
      *) die "unknown option $1 (try --help)" ;;
    esac
    shift
  done

  # One update at a time. The lock is held by the open file 9 until the script ends; the
  # servers it starts close that file, so they never hold the lock.
  exec 9>"$HOME/.boilergames-update.lock"
  flock -n 9 || die "another update is already running"

  # --- 1. What's new, built off to the side ------------------------------------------------
  [ -z "$(git -C "$APP" status --porcelain --untracked-files=no)" ] ||
    die "$APP has changes that aren't in git (git -C $APP status): sort those out first"
  git -C "$APP" fetch --quiet origin main
  local old new
  old=$(git -C "$APP" rev-parse HEAD)
  new=$(git -C "$APP" rev-parse FETCH_HEAD)
  if [ "$old" = "$new" ]; then
    echo "Already up to date ($(git -C "$APP" log -1 --format='%h %s'))."
    exit 0
  fi
  git -C "$APP" merge-base --is-ancestor "$old" "$new" ||
    die "the live copy has commits GitHub doesn't: it can't simply move forward"
  say "New on GitHub:"
  git -C "$APP" log --oneline "$old..$new"

  say "Building $(git -C "$APP" rev-parse --short "$new") in $NEXT (the site keeps running)"
  if [ ! -e "$NEXT/.git" ]; then
    git -C "$APP" worktree prune
    git -C "$APP" worktree add --quiet --detach "$NEXT" "$new"
  else
    git -C "$NEXT" checkout --quiet --force --detach "$new"
    git -C "$NEXT" clean -fdq
  fi
  npm --prefix "$NEXT/server" ci --omit=dev --no-audit --no-fund --loglevel=error
  npm --prefix "$NEXT/client" ci --no-audit --no-fund --loglevel=error
  npm --prefix "$NEXT/client" run build --silent >/dev/null
  # The server's tests (a few seconds): a version that fails them never goes live.
  npm --prefix "$NEXT" test --silent >"$NEXT/test.log" 2>&1 || {
    grep -E '^(not ok|✖)' "$NEXT/test.log" | head -n 20 >&2
    die "the new version fails its tests (the whole output: $NEXT/test.log). The site was not changed."
  }
  docker build --quiet -f "$NEXT/generator/Dockerfile" -t "$IMAGE:next" "$NEXT" >/dev/null

  # --- 2. Try it on a copy of the database ---------------------------------------------------
  # Database changes (migrations) run on the copy first. It holds real accounts, so it's
  # private to us and deleted when the script ends, whatever happens.
  say "Trying the new version on a copy of the database (port $TRY_PORT)"
  tmp=$(mktemp -d)
  chmod 700 "$tmp"
  (cd "$NEXT/server" && node -e "require('better-sqlite3')(process.argv[1], { readonly: true }).backup(process.argv[2]).then(() => process.exit(0))" \
    "$APP/server/data/boilergames.db" "$tmp/boilergames.db")
  (
    cd "$NEXT/server"
    # A throwaway key secret: saved API keys can't be opened here, and don't need to be.
    NODE_ENV=production HOST=127.0.0.1 PORT=$TRY_PORT GENERATION_ENABLED=0 \
      DB_PATH="$tmp/boilergames.db" KEY_SECRET_PATH="$tmp/key-secret" exec node src/index.js
  ) >"$tmp/server.log" 2>&1 9>&- & # 9>&-: it doesn't get the lock (see "One update at a time")
  try_pid=$!
  if ! wait_healthy "$TRY_PORT" 30 "$try_pid" ||
    ! curl -fsS "http://127.0.0.1:$TRY_PORT/api/games" >/dev/null ||
    [[ "$(curl -fsS "http://127.0.0.1:$TRY_PORT/")" != *'id="root"'* ]]; then
    tail -n 30 "$tmp/server.log" >&2
    die "the new version didn't work on the copy (its log is above). The site was not changed."
  fi
  kill "$try_pid"
  wait "$try_pid" 2>/dev/null || true
  try_pid=''
  echo "It starts, reads the database and serves the site."

  # --- 3. Wait until nobody is playing ---------------------------------------------------------
  if [ "$now" = 0 ]; then
    say "Waiting until nobody is playing or making a game (up to $wait_minutes min; Ctrl+C is safe)"
    local deadline=$((SECONDS + wait_minutes * 60)) seen='' busy rooms making
    while :; do
      busy=$(activity)
      if [ -z "$busy" ]; then
        echo "Can't tell whether anyone is playing (the running version has no /api/status yet). Going ahead."
        break
      fi
      [ "$busy" = "0 0" ] && break
      if [ "$busy" != "$seen" ]; then
        read -r rooms making <<<"$busy"
        echo "$(date +%H:%M) open rooms: $rooms, AI games being made: $making"
        seen=$busy
      fi
      [ "$SECONDS" -ge "$deadline" ] &&
        die "still busy after $wait_minutes min. Nothing was changed: run it again later, or with --now."
      sleep 15
    done
  fi

  # --- 4. Switch over ----------------------------------------------------------------------------
  say "Switching over"
  # Old tabs still ask for the old version's files (their names change with every build), so
  # the new build keeps the last week's ones. cp -p keeps their dates, so they age out.
  find "$APP/client/dist/assets" -type f -mtime -7 -exec cp -pn {} "$NEXT/client/dist/assets/" \; 2>/dev/null || true
  git -C "$APP" merge --quiet --ff-only "$new"
  swap "$APP/server/node_modules" "$NEXT/server/node_modules"
  swap "$APP/client/dist" "$NEXT/client/dist"
  docker image inspect "$IMAGE:local" >/dev/null 2>&1 && docker tag "$IMAGE:local" "$IMAGE:previous"
  docker tag "$IMAGE:next" "$IMAGE:local"

  if ! cmp -s "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile; then
    if caddy validate --config "$APP/deploy/Caddyfile" --adapter caddyfile >/dev/null 2>&1; then
      sudo cp "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
      sudo systemctl reload caddy # a reload keeps every connection open
      echo "Caddy: new Caddyfile loaded."
    else
      echo "Caddy: the new Caddyfile doesn't validate, so the old one stays (caddy validate says why)."
    fi
  fi
  if ! cmp -s "$APP/deploy/boilergames.service" /etc/systemd/system/boilergames.service; then
    sudo cp "$APP/deploy/boilergames.service" /etc/systemd/system/boilergames.service
    sudo systemctl daemon-reload
    echo "systemd: new boilergames.service loaded."
  fi
  git -C "$APP" diff --quiet "$old" "$new" -- deploy/boilergames.env.example ||
    echo "Note: deploy/boilergames.env.example changed: compare it with /etc/boilergames.env (sudo nano)."

  sudo systemctl restart boilergames 9>&-

  # --- 5. Check, or put the old version back -------------------------------------------------------
  if wait_healthy 3000 30; then
    say "Live: $(git -C "$APP" log -1 --format='%h %s')"
    curl -fsS --max-time 10 https://boilergames.party/api/health >/dev/null 2>&1 &&
      echo "https://boilergames.party answers." ||
      echo "Warning: the server is up, but https://boilergames.party didn't answer (journalctl -u caddy)."
    return 0
  fi

  journalctl -u boilergames -n 30 --no-pager >&2 || true
  say "The new version didn't come up (its log is above): putting the old one back"
  git -C "$APP" reset --quiet --hard "$old"
  swap "$APP/server/node_modules" "$NEXT/server/node_modules"
  swap "$APP/client/dist" "$NEXT/client/dist"
  docker image inspect "$IMAGE:previous" >/dev/null 2>&1 && docker tag "$IMAGE:previous" "$IMAGE:local"
  sudo systemctl restart boilergames 9>&-
  if wait_healthy 3000 30; then
    echo "The old version ($(git -C "$APP" rev-parse --short "$old")) is live again."
    echo "If the new one changed the database, the copy from before is server/data/boilergames.db.backup-*."
  else
    echo "The old version didn't come up either: journalctl -u boilergames" >&2
  fi
  exit 1
}

main "$@"
exit
