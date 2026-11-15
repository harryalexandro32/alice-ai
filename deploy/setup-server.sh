#!/usr/bin/env bash
# Pasang Alice AI di server bersama (Hetzner rhys-2, Ubuntu 24.04), sebagai root:
#
#   REPO=git@github.com:OWNER/alice-ai.git \
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA... deploy" \
#   bash setup-server.sh
#
# Yang dipasang: Node 22, PostgreSQL (apt), git; pengguna `alice`; repo di
# /opt/alice-ai; database `alice`; layanan systemd alice-admin (dashboard),
# alice-bot@<proyek> (satu bot per proyek, dinyalakan alice-reconcile.timer),
# dan cadangan harian; situs Caddy di /etc/caddy/conf.d/alice.caddy.
#
# Server ini dipakai aplikasi lain juga: skrip ini TIDAK menyentuh
# /etc/caddy/Caddyfile, firewall, maupun layanan lain. Aman dijalankan ulang.
set -euo pipefail

REPO="${REPO:?isi REPO=git@github.com:OWNER/alice-ai.git}"
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-}"
DOMAIN="${DOMAIN:-alice-api.lukicenturi.com}"
APP_DIR=/opt/alice-ai
APP_USER=alice
export DEBIAN_FRONTEND=noninteractive

echo "== paket dasar"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git openssl
timedatectl set-timezone Asia/Jakarta || true

echo "== Node 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -v; npm -v

echo "== PostgreSQL"
apt-get install -y -q postgresql
systemctl enable --now postgresql

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
cat > /etc/sudoers.d/alice-ai <<SUDO
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart alice-admin, /usr/bin/systemctl start alice-admin, /usr/bin/systemctl stop alice-admin, /usr/bin/systemctl restart alice-bot@*, /usr/bin/systemctl start alice-bot@*, /usr/bin/systemctl stop alice-bot@*
SUDO
chmod 440 /etc/sudoers.d/alice-ai
visudo -cf /etc/sudoers.d/alice-ai

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
sudo -u "$APP_USER" install -d -m 700 data auth logs backups
[ -f .env ] || sudo -u "$APP_USER" cp .env.example .env
chown "$APP_USER:$APP_USER" .env
chmod 600 .env

echo "== database"
# Peran dan database `alice`; DATABASE_URL ditulis ke .env sekali saja.
if ! grep -qE '^DATABASE_URL=postgres' .env; then
  PW="$(openssl rand -hex 24)"
  if sudo -u postgres psql -tAc "select 1 from pg_roles where rolname = 'alice'" | grep -q 1; then
    sudo -u postgres psql -qc "alter role alice with login password '$PW'"
  else
    sudo -u postgres psql -qc "create role alice with login password '$PW'"
  fi
  sed -i '/^DATABASE_URL=/d' .env
  echo "DATABASE_URL=postgres://alice:$PW@127.0.0.1:5432/alice" >> .env
fi
sudo -u postgres psql -tAc "select 1 from pg_database where datname = 'alice'" | grep -q 1 || sudo -u postgres createdb -O alice alice
# Dashboard butuh kata sandi; dibuat acak kalau belum diisi (dicetak di akhir).
NEW_ADMIN_PW=""
if ! grep -qE '^ADMIN_PASSWORD=.{8,}' .env; then
  NEW_ADMIN_PW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  sed -i '/^ADMIN_PASSWORD=/d' .env
  echo "ADMIN_PASSWORD=$NEW_ADMIN_PW" >> .env
fi

echo "== dependensi, migrasi, isi awal"
sudo -u "$APP_USER" npm ci --no-audit --no-fund
sudo -u "$APP_USER" npm run db:migrate
sudo -u "$APP_USER" npm run db:seed

echo "== systemd"
# Layanan lama (satu proses bot + dashboard) dari versi sebelumnya, kalau ada.
for old in alice-ai alice-ai-backup.timer alice-ai-backup; do
  if [ -f "/etc/systemd/system/$old.service" ] || [ -f "/etc/systemd/system/$old" ]; then
    systemctl disable --now "$old" 2>/dev/null || true
    rm -f "/etc/systemd/system/$old.service" "/etc/systemd/system/$old"
  fi
done
install -m 644 deploy/alice-admin.service deploy/alice-bot@.service deploy/alice-backup.service deploy/alice-backup.timer \
  deploy/alice-reconcile.service deploy/alice-reconcile.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now alice-admin alice-reconcile.timer alice-backup.timer

echo "== Caddy (hanya situs Alice)"
if command -v caddy >/dev/null && [ -f /etc/caddy/Caddyfile.main ]; then
  install -d /etc/caddy/conf.d
  sed "s/alice-api.lukicenturi.com/$DOMAIN/" deploy/alice.caddy > /etc/caddy/conf.d/alice.caddy
  caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile.main
  systemctl reload caddy
else
  echo "!! Caddy dengan /etc/caddy/Caddyfile.main tidak ditemukan; pasang deploy/alice.caddy sendiri."
fi

echo
echo "== selesai"
echo "Kunci deploy (untuk GitHub > Deploy keys, kalau repo privat):"
cat "/home/$APP_USER/.ssh/id_ed25519.pub"
if [ -n "$NEW_ADMIN_PW" ]; then
  echo
  echo "Kata sandi dashboard (ADMIN_PASSWORD di $APP_DIR/.env): $NEW_ADMIN_PW"
fi
echo
echo "Berikutnya: isi LLM_API_KEY (dan SMTP kalau perlu) di $APP_DIR/.env, lalu:"
echo "  systemctl restart alice-admin 'alice-bot@*'"
echo "  journalctl -u alice-admin -u 'alice-bot@*' -f"
echo "Buka https://$DOMAIN/gfan/settings/whatsapp (atau https://alice.lukicenturi.com/gfan/settings/whatsapp) untuk menautkan nomor."
