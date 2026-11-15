#!/usr/bin/env bash
# Dijalankan GitHub Actions lewat SSH setiap push ke master (lihat
# .github/workflows/deploy.yml). Bisa juga dijalankan manual sebagai `alice`.
set -euo pipefail
cd /opt/alice-ai
BRANCH="${1:-master}"

echo "[deploy] tarik $BRANCH"
OLD=$(git rev-parse HEAD)
git fetch --prune origin
git reset --hard "origin/$BRANCH"
CHANGED=$(git diff --name-only "$OLD" HEAD)
echo "[deploy] pasang dependensi"
npm ci --no-audit --no-fund
echo "[deploy] migrasi database + isi awal"
npm run db:migrate
npm run db:seed

# Bot hanya dinyalakan ulang kalau kode yang dipakai proses bot berubah. Tiap
# restart berarti WhatsApp tersambung ulang, dan sambungan ulang yang sering
# adalah salah satu pola yang membuat nomor dicurigai. Berkas dashboard, dokumen,
# dan berkas Vercel tidak dipakai bot; package.json, src/db/, drizzle/, dan
# deploy/*.service tetap dihitung perubahan bot.
bot_paths=()
while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in
    src/admin/*|docs/*|.github/*|public/*|README.md|vercel.json|deploy/alice.caddy|.vercelignore|*.md) ;;
    *) bot_paths+=("$path") ;;
  esac
done <<< "$CHANGED"

if [ "$OLD" = "$(git rev-parse HEAD)" ]; then
  restart_bot=0
  why="tidak ada commit baru"
elif [ "${#bot_paths[@]}" -gt 0 ]; then
  restart_bot=1
  why="kode bot berubah: $(printf '%s ' "${bot_paths[@]:0:5}")"
else
  restart_bot=0
  why="hanya dashboard/dokumen yang berubah: $(printf '%s\n' "$CHANGED" | sed -n '1,5p' | tr '\n' ' ')"
fi

echo "[deploy] nyalakan ulang dashboard"
sudo /usr/bin/systemctl restart alice-admin
if [ "$restart_bot" = 1 ]; then
  echo "[deploy] nyalakan ulang semua bot ($why)"
  sudo /usr/bin/systemctl restart 'alice-bot@*'
else
  echo "[deploy] bot TIDAK dinyalakan ulang ($why)"
fi
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
echo "[deploy] selesai: $(git rev-parse --short HEAD), dashboard dan bot aktif (bot dinyalakan ulang: $([ "$restart_bot" = 1 ] && echo ya || echo tidak))"
