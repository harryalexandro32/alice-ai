#!/usr/bin/env bash
# Dijalankan GitHub Actions lewat SSH setiap push ke master (lihat
# .github/workflows/deploy.yml). Bisa juga dijalankan manual sebagai `alice`.
set -euo pipefail
cd /opt/alice-ai
BRANCH="${1:-master}"

echo "[deploy] tarik $BRANCH"
git fetch --prune origin
git reset --hard "origin/$BRANCH"
echo "[deploy] pasang dependensi"
npm ci --no-audit --no-fund
echo "[deploy] nyalakan ulang bot"
sudo /usr/bin/systemctl restart alice-ai
sleep 8
if systemctl is-active --quiet alice-ai; then
  echo "[deploy] selesai: $(git rev-parse --short HEAD) — bot aktif"
else
  echo "[deploy] GAGAL: bot tidak aktif. Log terakhir:" >&2
  journalctl -u alice-ai -n 40 --no-pager >&2 || true
  exit 1
fi
