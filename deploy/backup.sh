#!/usr/bin/env bash
# Nightly VSV backup (run by vsv-backup.timer, installed by bootstrap.sh). Keeps 7 days in /opt/vsv/backups.
#  - SQLite: consistent snapshot with VACUUM INTO inside the api container (safe while the app writes; WAL-aware).
#  - secret.key: the battle-ticket signing key (without it, outstanding tickets break — keep it with the DB).
#  - videos: append-only mirror (new files copied, nothing overwritten); mirrored files whose clip is gone
#    are pruned once the file is older than 7 days.
# On-box only: protects against bad deploys and mistakes, NOT against losing the server. Copy off-box for that.
set -euo pipefail
DIR=/opt/vsv
OUT=$DIR/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
COMPOSE=(docker compose --project-directory "$DIR/deploy" -f "$DIR/deploy/docker-compose.yml")
VOLUME=deploy_vsv_data
install -d -m 700 "$OUT" "$OUT/db" "$OUT/videos"

TMP=/data/.backup-$STAMP.db
"${COMPOSE[@]}" exec -T api node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/vsv.db');
  db.exec(\"VACUUM INTO '$TMP'\");
  const ok = new DatabaseSync('$TMP').prepare('PRAGMA integrity_check').get();
  if (Object.values(ok)[0] !== 'ok') { console.error('integrity_check failed'); process.exit(1); }
"
docker run --rm -v "$VOLUME":/d -v "$OUT":/b alpine:3 sh -euc "
  cp /d/.backup-$STAMP.db /b/db/vsv-$STAMP.db && rm -f /d/.backup-$STAMP.db
  cp /d/secret.key /b/db/secret-$STAMP.key
  cp -a -n /d/videos/. /b/videos/
  cd /b/videos && for f in *; do [ -e \"/d/videos/\$f\" ] || find \"\$f\" -mtime +7 -delete; done 2>/dev/null || true
  chmod 600 /b/db/*
"
find "$OUT/db" -type f -mtime +7 -delete
echo "$(date -Is) backup ok: $(du -sh "$OUT" | cut -f1)" >> /var/log/vsv-backup.log
