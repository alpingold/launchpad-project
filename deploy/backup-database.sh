#!/bin/bash
# Copies the database off the server: one compressed copy into the S3 bucket named by BACKUP_BUCKET,
# under database/, named after the time it was made. boilergames-backup.timer runs it once a night,
# as the site's user. The README's "The database's backups" says how to get one back.
#
# The copy is made with VACUUM INTO, which gives one complete, consistent file while the site keeps
# running. A plain copy of the database file can miss its latest changes, which sit in a second file.
#
# The server's AWS role may only add files to the bucket: it can't read, list or delete them. So a
# break-in on this server can neither read old backups nor destroy them.
set -euo pipefail
: "${DATABASE_FILE:?}" "${BACKUP_BUCKET:?}" "${AWS_REGION:?}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
copy="$work/boilergames.db"

# Make the copy, then ask SQLite whether the copy is sound before anything is uploaded.
/usr/local/bin/node -e '
  const { DatabaseSync } = require("node:sqlite");
  const [from, to] = process.argv.slice(1);
  const db = new DatabaseSync(from);
  db.prepare("VACUUM INTO ?").run(to);
  db.close();
  const check = new DatabaseSync(to, { readOnly: true }).prepare("PRAGMA integrity_check").get();
  if (check.integrity_check !== "ok") { console.error("the copy is damaged:", check.integrity_check); process.exit(1); }
' "$DATABASE_FILE" "$copy"
gzip "$copy"

# The role's short-lived keys, from the address every EC2 server can ask about itself. They are
# handed to curl in a file, not on its command line, where other programs could see them.
about=http://169.254.169.254/latest
token=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" "$about/api/token")
role=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" "$about/meta-data/iam/security-credentials/")
curl -fsS -H "X-aws-ec2-metadata-token: $token" "$about/meta-data/iam/security-credentials/$role" |
  /usr/local/bin/node -e '
    const keys = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    console.log(`user = "${keys.AccessKeyId}:${keys.SecretAccessKey}"`);
    console.log(`header = "x-amz-security-token: ${keys.Token}"`);
  ' > "$work/keys"

name="database/$(date -u +%Y-%m-%dT%H-%M-%SZ).db.gz"
curl -fsS --config "$work/keys" --aws-sigv4 "aws:amz:$AWS_REGION:s3" \
  -H "x-amz-content-sha256: $(sha256sum "$copy.gz" | cut -d' ' -f1)" \
  --upload-file "$copy.gz" "https://$BACKUP_BUCKET.s3.$AWS_REGION.amazonaws.com/$name"
echo "backed up: $name, $(stat -c %s "$copy.gz") bytes"
