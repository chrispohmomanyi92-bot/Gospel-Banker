#!/usr/bin/env bash
# Make a dated backup of the database and uploaded videos in /var/backups.
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M)
OUT=/var/backups/gospel-banker-$STAMP.tar.gz
sudo tar -czf "$OUT" -C /var/lib gospel-banker /etc/gospel-banker.env
echo "Backup written to $OUT"
