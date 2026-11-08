#!/usr/bin/env bash
# Pull the latest version from GitHub and restart. Data and settings are kept.
set -euo pipefail
cd /opt/gospel-banker
sudo -u gospel git pull --ff-only
sudo -u gospel npm ci --omit=dev --no-audit --no-fund
sudo systemctl restart gospel-banker
echo "Updated to $(sudo -u gospel git log -1 --format='%h %s')"
