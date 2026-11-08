#!/usr/bin/env bash
# Run every few minutes by the gospel-banker-update timer: if GitHub has a newer
# version on the main branch, install it and restart. Does nothing otherwise.
set -euo pipefail
APP_DIR=/opt/gospel-banker
git_() { sudo -u gospel git -C "$APP_DIR" "$@"; }
git_ fetch --quiet origin main
if [ "$(git_ rev-parse HEAD)" = "$(git_ rev-parse origin/main)" ]; then exit 0; fi
echo "New version found: $(git_ log -1 --format='%h %s' origin/main)"
bash "$APP_DIR/deploy/update.sh"
