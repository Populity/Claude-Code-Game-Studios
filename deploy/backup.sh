#!/usr/bin/env bash
# Nightly VSV backup (run by vsv-backup.timer, installed by bootstrap.sh). Keeps 7 days in /opt/vsv/backups.
#  - SQLite: consistent snapshot with VACUUM INTO inside the api container (safe while the app writes; WAL-aware).
#  - secret.key: the battle-ticket signing key (without it, outstanding tickets break — keep it with the DB).
#  - videos: append-only mirror (new files copied, nothing overwritten); mirrored files whose clip is gone
#    are pruned once the file is older than 7 days.
# On-box only: protects against bad deploys and mistakes, NOT against losing the server. Copy off-box for that.
# Backups hold session hashes, device ids and IPs: everything is root-only (umask 077, dirs 700, files 600).
set -euo pipefail
umask 077
DIR=/opt/vsv
OUT=$DIR/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
COMPOSE=(docker compose --project-directory "$DIR/deploy" -f "$DIR/deploy/docker-compose.yml")
exec 9>/run/vsv-backup.lock; flock -n 9 || { echo "another backup is running"; exit 0; }
install -d -m 700 "$OUT" "$OUT/db" "$OUT/videos"

# Host path of the api's /data volume, read from the running container (no hardcoded compose project name).
API=$("${COMPOSE[@]}" ps -q api)
[ -n "$API" ] || { echo "api container is not running"; exit 1; }
SRC=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$API")
[ -d "$SRC" ] || { echo "data volume not found"; exit 1; }

TMP=.backup-$STAMP.db
trap 'rm -f "$SRC/$TMP"' EXIT
"${COMPOSE[@]}" exec -T api node --disable-warning=ExperimentalWarning -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/vsv.db');
  db.exec('PRAGMA busy_timeout = 10000');
  db.exec(\"VACUUM INTO '/data/$TMP'\");
  const ok = new DatabaseSync('/data/$TMP').prepare('PRAGMA integrity_check').get();
  if (Object.values(ok)[0] !== 'ok') { console.error('integrity_check failed'); process.exit(1); }
"
mv "$SRC/$TMP" "$OUT/db/vsv-$STAMP.db"
cp "$SRC/secret.key" "$OUT/db/secret-$STAMP.key"
# Partial uploads (tmp-*) are skipped; existing mirror files are never overwritten.
find "$SRC/videos" -maxdepth 1 -type f ! -name 'tmp-*' -exec cp -a -n -t "$OUT/videos/" {} +
( cd "$OUT/videos" && for f in *; do [ -e "$f" ] || continue; [ -e "$SRC/videos/$f" ] || find "$f" -mtime +7 -delete; done )
chown -R root:root "$OUT"; chmod -R go-rwx "$OUT"
find "$OUT/db" -type f -mtime +7 -delete
echo "$(date -Is) backup ok: $(du -sh "$OUT" | cut -f1)" >> /var/log/vsv-backup.log
