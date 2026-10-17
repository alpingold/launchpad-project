#!/bin/sh
# Nightly backup of the database (run by cron, see deploy/README.md). SQLite's own backup
# copies the file safely while the server keeps running. Keeps the last 14 days.
# The key secret (server/data/key-secret) is copied too: without it, saved API keys can't be opened.
set -eu
APP=/home/ubuntu/boilergames
OUT=/home/ubuntu/backups
mkdir -p "$OUT"
STAMP=$(date +%Y-%m-%d)
cd "$APP/server"
node -e "require('better-sqlite3')('data/boilergames.db', { readonly: true }).backup(process.argv[1]).then(() => process.exit(0))" "$OUT/boilergames-$STAMP.db"
cp data/key-secret "$OUT/key-secret" 2>/dev/null || true
chmod 600 "$OUT"/*
find "$OUT" -name 'boilergames-*.db' -mtime +14 -delete
