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
echo "[deploy] migrasi database + isi awal"
npm run db:migrate
npm run db:seed
echo "[deploy] nyalakan ulang dashboard dan semua bot"
sudo /usr/bin/systemctl restart alice-admin
sudo /usr/bin/systemctl restart 'alice-bot@*'
sleep 8
failed=0
if ! systemctl is-active --quiet alice-admin; then
  echo "[deploy] GAGAL: dashboard tidak aktif. Log terakhir:" >&2
  journalctl -u alice-admin -n 40 --no-pager >&2 || true
  failed=1
fi
for unit in $(systemctl list-units 'alice-bot@*' --all --no-legend --plain | awk '{print $1}'); do
  systemctl is-enabled --quiet "$unit" 2>/dev/null || continue
  if ! systemctl is-active --quiet "$unit"; then
    echo "[deploy] GAGAL: $unit tidak aktif. Log terakhir:" >&2
    journalctl -u "$unit" -n 40 --no-pager >&2 || true
    failed=1
  fi
done
[ "$failed" = 0 ] || exit 1
echo "[deploy] selesai: $(git rev-parse --short HEAD) — dashboard dan bot aktif"
