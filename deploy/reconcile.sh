#!/usr/bin/env bash
# Samakan layanan bot dengan tabel projects (dijalankan root oleh
# alice-reconcile.timer tiap menit):
#   - proyek enabled  -> systemctl enable --now alice-bot@<id>
#   - proyek disabled -> systemctl disable --now alice-bot@<id>
#   - layanan bot yang proyeknya sudah tidak ada -> dimatikan.
# Jadi proyek baru dari dashboard punya bot sendiri dalam ±1 menit.
set -euo pipefail
cd "$(dirname "$0")/.."

DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '\r')"
[ -n "$DATABASE_URL" ] || { echo "[reconcile] DATABASE_URL kosong di .env" >&2; exit 1; }

rows="$(psql "$DATABASE_URL" -Atc 'select id, enabled from projects')"
wanted=" "
while IFS='|' read -r id enabled; do
  [ -n "$id" ] || continue
  [[ "$id" =~ ^[a-z0-9-]{2,32}$ ]] || { echo "[reconcile] id proyek aneh dilewati: $id" >&2; continue; }
  unit="alice-bot@$id.service"
  if [ "$enabled" = "t" ]; then
    wanted="$wanted$id "
    if ! systemctl is-enabled --quiet "$unit" 2>/dev/null || ! systemctl is-active --quiet "$unit"; then
      echo "[reconcile] nyalakan $unit"
      systemctl enable --now "$unit"
    fi
  elif systemctl is-enabled --quiet "$unit" 2>/dev/null; then
    echo "[reconcile] matikan $unit (proyek dinonaktifkan)"
    systemctl disable --now "$unit"
  fi
done <<< "$rows"

# Bot yang masih terpasang padahal proyeknya sudah tidak ada di database.
for link in /etc/systemd/system/multi-user.target.wants/alice-bot@*.service; do
  [ -e "$link" ] || continue
  id="$(basename "$link" .service)"; id="${id#alice-bot@}"
  case "$wanted" in *" $id "*) ;; *)
    echo "[reconcile] matikan alice-bot@$id (proyek tidak ada)"
    systemctl disable --now "alice-bot@$id.service" ;;
  esac
done
