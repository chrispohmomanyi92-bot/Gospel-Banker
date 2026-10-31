#!/usr/bin/env bash
# The Gospel Banker: one-command installer for a fresh Ubuntu server
# (tested target: Oracle Cloud "Always Free", Ubuntu 22.04 / 24.04, ARM or x86).
#
#   curl -fsSL https://raw.githubusercontent.com/chrispohmomanyi92-bot/Gospel-Banker/main/deploy/install.sh | sudo bash
#
# It installs Node.js 22, the app (as a background service that restarts on
# reboot), and Caddy for free automatic HTTPS. Safe to run again to repair.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/chrispohmomanyi92-bot/Gospel-Banker.git}"
APP_DIR=/opt/gospel-banker
DATA_DIR=/var/lib/gospel-banker
ENV_FILE=/etc/gospel-banker.env
APP_USER=gospel

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ask() { # ask "question" default -> echoes answer (reads from the terminal even when piped)
  local reply=""
  if [ -r /dev/tty ]; then read -r -p "$1 [$2]: " reply < /dev/tty || true; fi
  echo "${reply:-$2}"
}

[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo."; exit 1; }
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || echo "Warning: this script is written for Ubuntu; continuing anyway."

PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || curl -fsS --max-time 5 https://ifconfig.me || echo '')"
DEFAULT_DOMAIN="${PUBLIC_IP:+${PUBLIC_IP//./-}.sslip.io}"

say "Settings (press Enter to accept the value in brackets)"
DOMAIN="${DOMAIN:-$(ask 'Web address for the app (your own domain, or the free one offered)' "${DEFAULT_DOMAIN:-localhost}")}"
if [ -f "$ENV_FILE" ] && grep -q '^ADMIN_PASSWORD=' "$ENV_FILE"; then
  ADMIN_PASSWORD="$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
else
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(ask 'Password for the "admin" account' "$(openssl rand -base64 12)")}"
fi
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(ask 'Claude API key for AI language filtering (optional, Enter to skip)' '')}"

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https openssl

# Small free servers have 1 GB of RAM; add swap so npm installs don't run out of memory.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  say "Adding 2 GB of swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  say "Installing Caddy (automatic HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

NODE_BIN="$(command -v node)"

say "Installing The Gospel Banker"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
mkdir -p "$DATA_DIR/media"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
PORT=3000
NODE_ENV=production
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=$ADMIN_PASSWORD
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
DB_PATH=$DATA_DIR/gospel-banker.db
MEDIA_DIR=$DATA_DIR/media
MAX_VIDEO_MB=500
SEED_DEMO=false
ENV
fi
chmod 600 "$ENV_FILE"

cat > /etc/systemd/system/gospel-banker.service <<UNIT
[Unit]
Description=The Gospel Banker
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	request_body {
		max_size 600MB
	}
	reverse_proxy localhost:3000
}
CADDY

say "Opening web ports 80 and 443 in the server firewall"
# Oracle's Ubuntu images ship iptables rules that block everything except SSH.
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp; ufw allow 443/tcp; fi

say "Starting services"
systemctl daemon-reload
systemctl enable --now gospel-banker
systemctl restart gospel-banker caddy

for _ in $(seq 1 20); do curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
  say "Done! The Gospel Banker is running."
  echo "  Open:      https://$DOMAIN   (HTTPS can take a minute the first time)"
  echo "  Admin:     username 'admin', password: $ADMIN_PASSWORD"
  echo "  Settings:  $ENV_FILE    Data: $DATA_DIR"
  echo "  Update:    sudo bash $APP_DIR/deploy/update.sh"
  echo "  Logs:      sudo journalctl -u gospel-banker -f"
  echo
  echo "If the page does not open, check that ports 80 and 443 are open in Oracle's"
  echo "Security List (see deploy/ORACLE.md step 4)."
else
  echo "The app did not start. Showing the last log lines:"
  journalctl -u gospel-banker -n 40 --no-pager
  exit 1
fi
