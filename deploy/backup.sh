#!/usr/bin/env bash
# Cadangan ke backups/<tanggal>/:
#   - database PostgreSQL (semua proyek), lewat pg_dump: db.sql.gz;
#   - data/ (foto, PDF, teks PDF per proyek) dan auth/ (sesi WhatsApp per proyek);
#   - .env.
# Disimpan BACKUP_KEEP_DAYS hari (bawaan 14). Dijalankan alice-backup.timer.
#
# Memulihkan (lihat docs/deploy.md): hentikan bot dan dashboard, lalu
#   gunzip -c backups/<tanggal>/db.sql.gz | psql "$DATABASE_URL"
#   tar -xzf backups/<tanggal>/data.tgz && tar -xzf backups/<tanggal>/auth.tgz
set -euo pipefail
cd "$(dirname "$0")/.."

val() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true; }
DATABASE_URL="$(val DATABASE_URL)"
DATA_DIR="$(val DATA_DIR)"; DATA_DIR="${DATA_DIR:-./data}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

stamp="$(date +%Y-%m-%d_%H%M)"
dest="backups/$stamp"
mkdir -p "$dest"
chmod 700 backups

case "$DATABASE_URL" in
  postgres://*|postgresql://*) pg_dump --clean --if-exists --no-owner "$DATABASE_URL" | gzip > "$dest/db.sql.gz" ;;
  *) echo "[cadangan] DATABASE_URL bukan PostgreSQL; database dilewati" >&2 ;;
esac
[ -d "$DATA_DIR" ] && tar -czf "$dest/data.tgz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
[ -d auth ] && tar -czf "$dest/auth.tgz" auth
[ -f .env ] && cp .env "$dest/env.txt"
chmod -R go-rwx "$dest"

# Buang cadangan yang lebih tua dari KEEP_DAYS hari.
find backups -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +
echo "[cadangan] $dest: $(du -sh "$dest" | cut -f1)"
