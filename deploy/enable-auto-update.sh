#!/usr/bin/env bash
# Turn on automatic updates: the server checks GitHub every 5 minutes and
# installs any new version by itself. Safe to run again.
#   Turn off:  sudo systemctl disable --now gospel-banker-update.timer
#   History:   sudo journalctl -u gospel-banker-update
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo."; exit 1; }
APP_DIR=/opt/gospel-banker

cat > /etc/systemd/system/gospel-banker-update.service <<UNIT
[Unit]
Description=Install the latest version of The Gospel Banker from GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $APP_DIR/deploy/auto-update.sh
UNIT

cat > /etc/systemd/system/gospel-banker-update.timer <<UNIT
[Unit]
Description=Check GitHub for a new version of The Gospel Banker every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now gospel-banker-update.timer
echo "Automatic updates are ON. The server checks GitHub every 5 minutes."
