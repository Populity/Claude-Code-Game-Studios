#!/usr/bin/env bash
# VSV one-command server setup (Ubuntu 22.04/24.04 or Debian 12, run as root):
#   curl -fsSL https://raw.githubusercontent.com/Populity/Claude-Code-Game-Studios/claude/exciting-darwin-vvv3fd/deploy/bootstrap.sh | DOMAIN=your.domain bash
# DOMAIN is optional: without it the app is served over plain HTTP on the server IP.
# Re-running is safe. The server then pulls updates from the branch every 5 minutes.
set -euo pipefail
REPO="${REPO:-https://github.com/Populity/Claude-Code-Game-Studios.git}"
BRANCH="${BRANCH:-claude/exciting-darwin-vvv3fd}"
DIR=/opt/vsv
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null || true

echo "==> Swap (builds need memory on small servers)"
if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 4000 ] && ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo "==> Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null
systemctl enable --now docker >/dev/null

echo "==> Firewall: only SSH, HTTP, HTTPS"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null

echo "==> Code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else git clone -q --branch "$BRANCH" "$REPO" "$DIR"; fi
echo "SITE_ADDRESS=${DOMAIN:-:80}" > "$DIR/deploy/.env"

echo "==> Start"
docker compose --project-directory "$DIR/deploy" -f "$DIR/deploy/docker-compose.yml" up -d --build

echo "==> Auto-update every 5 minutes"
cat > /usr/local/bin/vsv-update <<UPD
#!/usr/bin/env bash
set -euo pipefail
cd $DIR
git fetch -q origin $BRANCH
[ "\$(git rev-parse HEAD)" = "\$(git rev-parse origin/$BRANCH)" ] && exit 0
git reset -q --hard origin/$BRANCH
docker compose --project-directory $DIR/deploy -f $DIR/deploy/docker-compose.yml up -d --build
docker image prune -f >/dev/null
echo "\$(date -Is) updated to \$(git rev-parse --short HEAD)" >> /var/log/vsv-update.log
UPD
chmod +x /usr/local/bin/vsv-update
cat > /etc/systemd/system/vsv-update.service <<'UNIT'
[Unit]
Description=VSV pull-and-redeploy
[Service]
Type=oneshot
ExecStart=/usr/local/bin/vsv-update
UNIT
cat > /etc/systemd/system/vsv-update.timer <<'UNIT'
[Unit]
Description=VSV update every 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload && systemctl enable --now vsv-update.timer >/dev/null

echo "==> Nightly backups (7 days, $DIR/backups)"
cat > /etc/systemd/system/vsv-backup.service <<UNIT
[Unit]
Description=VSV nightly backup
[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $DIR/deploy/backup.sh
UNIT
cat > /etc/systemd/system/vsv-backup.timer <<'UNIT'
[Unit]
Description=VSV backup every night
[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=15min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload && systemctl enable --now vsv-backup.timer >/dev/null

IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
echo
echo "VSV is up: ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$IP}"
echo "Status: docker compose --project-directory $DIR/deploy ps   |   Updates log: /var/log/vsv-update.log"
