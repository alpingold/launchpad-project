#!/bin/sh
# Nightly backup of the database (run by cron, see deploy/README.md). SQLite's own backup
# copies the file safely while the server keeps running. Keeps the last 14 days.
# The key secret (server/data/key-secret) is NOT copied here (2026-10-21): next to the database
# copies, whoever got the backups could open every saved API key. Keep one copy of it off the
# server instead (deploy/README.md, "The key secret"); without it, restored keys can't be opened.
set -eu
APP=/home/ubuntu/boilergames
OUT=/home/ubuntu/backups
mkdir -p "$OUT"
STAMP=$(date +%Y-%m-%d)
cd "$APP/server"
node -e "require('better-sqlite3')('data/boilergames.db', { readonly: true }).backup(process.argv[1]).then(() => process.exit(0))" "$OUT/boilergames-$STAMP.db"
chmod 600 "$OUT"/*
find "$OUT" -name 'boilergames-*.db' -mtime +14 -delete
