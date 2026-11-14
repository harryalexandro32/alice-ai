#!/usr/bin/env bash
# Pasang server bot dari nol — Ubuntu 24.04, dijalankan SEKALI sebagai root:
#
#   REPO=git@github.com:OWNER/alice-ai.git \
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA... deploy" \
#   bash setup-server.sh
#
# Yang dipasang: Node 22, Caddy (HTTPS otomatis), sqlite3, ufw; pengguna
# `alice`; repo di /opt/alice-ai; layanan systemd alice-ai + cadangan harian.
# Skrip ini aman dijalankan ulang.
#
# Sesudahnya (manual, sekali):
#   1. Tambahkan kunci deploy yang dicetak skrip ini ke GitHub (repo > Settings >
#      Deploy keys, read-only), lalu jalankan skrip ini lagi kalau clone gagal.
#   2. Isi /opt/alice-ai/.env (salin dari .env.example), salin data/ dan auth/
#      dari mesin lama kalau ada.
#   3. systemctl start alice-ai && journalctl -u alice-ai -f
set -euo pipefail

REPO="${REPO:?isi REPO=git@github.com:OWNER/alice-ai.git}"
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-}"
DOMAIN="${DOMAIN:-alice-api.lukicenturi.com}"
APP_DIR=/opt/alice-ai
APP_USER=alice
export DEBIAN_FRONTEND=noninteractive

echo "== paket dasar"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https
timedatectl set-timezone Asia/Jakarta || true

echo "== Node 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -v; npm -v

echo "== Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

echo "== firewall: hanya SSH, HTTP, HTTPS"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== pengguna $APP_USER"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
usermod -aG systemd-journal "$APP_USER"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
if [ -n "$DEPLOY_PUBKEY" ]; then
  touch "/home/$APP_USER/.ssh/authorized_keys"
  grep -qF "$DEPLOY_PUBKEY" "/home/$APP_USER/.ssh/authorized_keys" || echo "$DEPLOY_PUBKEY" >> "/home/$APP_USER/.ssh/authorized_keys"
  chmod 600 "/home/$APP_USER/.ssh/authorized_keys"; chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/authorized_keys"
fi
# Kunci deploy untuk membaca repo (kalau repo-nya privat).
if [ ! -f "/home/$APP_USER/.ssh/id_ed25519" ]; then
  sudo -u "$APP_USER" ssh-keygen -q -t ed25519 -N '' -C "alice-ai deploy key" -f "/home/$APP_USER/.ssh/id_ed25519"
fi
sudo -u "$APP_USER" bash -c "ssh-keyscan -H github.com >> /home/$APP_USER/.ssh/known_hosts 2>/dev/null; sort -u -o /home/$APP_USER/.ssh/known_hosts /home/$APP_USER/.ssh/known_hosts"
# Hanya boleh menyalakan ulang layanannya sendiri, tanpa kata sandi.
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart alice-ai, /usr/bin/systemctl start alice-ai, /usr/bin/systemctl stop alice-ai" > /etc/sudoers.d/alice-ai
chmod 440 /etc/sudoers.d/alice-ai

echo "== repo di $APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  if ! sudo -u "$APP_USER" git clone -q "$REPO" "$APP_DIR"; then
    echo
    echo "!! clone gagal. Kalau repo-nya privat, daftarkan kunci ini sebagai Deploy key (read-only) di GitHub, lalu jalankan skrip ini lagi:"
    cat "/home/$APP_USER/.ssh/id_ed25519.pub"
    exit 1
  fi
fi
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --no-audit --no-fund
sudo -u "$APP_USER" install -d -m 700 data auth logs backups
[ -f .env ] || sudo -u "$APP_USER" cp .env.example .env
chmod 600 .env

echo "== systemd + Caddy"
install -m 644 deploy/alice-ai.service deploy/alice-ai-backup.service deploy/alice-ai-backup.timer /etc/systemd/system/
sed "s/alice-api.lukicenturi.com/$DOMAIN/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now alice-ai-backup.timer
systemctl enable alice-ai
systemctl reload-or-restart caddy

echo
echo "== selesai"
echo "Kunci deploy (untuk GitHub > Deploy keys, kalau repo privat):"
cat "/home/$APP_USER/.ssh/id_ed25519.pub"
echo
echo "Berikutnya: isi $APP_DIR/.env, salin data/ dan auth/, lalu:"
echo "  systemctl start alice-ai && journalctl -u alice-ai -f"
