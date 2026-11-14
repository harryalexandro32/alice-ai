#!/usr/bin/env bash
# Cadangan data bot ke backups/<tanggal>/:
#   - database SQLite, disalin lewat `.backup` (aman meski bot sedang menulis);
#   - data/<bisnis>/ (profile.json, foto, PDF) dan auth/ (sesi WhatsApp).
# Disimpan BACKUP_KEEP_DAYS hari (bawaan 14). Dijalankan alice-ai-backup.timer.
set -euo pipefail
cd "$(dirname "$0")/.."

# Baca BUSINESS / DB_PATH / DATA_DIR / WA_AUTH_DIR dari .env tanpa menjalankannya.
val() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' | xargs || true; }
BUSINESS="$(val BUSINESS)"; BUSINESS="${BUSINESS:-gfan}"
DB_PATH="$(val DB_PATH)"; DB_PATH="${DB_PATH:-./data/$BUSINESS.db}"
DATA_DIR="$(val DATA_DIR)"; DATA_DIR="${DATA_DIR:-./data}"
AUTH_DIR="$(val WA_AUTH_DIR)"; AUTH_DIR="${AUTH_DIR:-./auth}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

stamp="$(date +%Y-%m-%d_%H%M)"
dest="backups/$stamp"
mkdir -p "$dest"
chmod 700 backups

if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" ".backup '$dest/$BUSINESS.db'"
fi
[ -d "$DATA_DIR/$BUSINESS" ] && tar -czf "$dest/data-$BUSINESS.tgz" -C "$DATA_DIR" "$BUSINESS"
[ -d "$AUTH_DIR" ] && tar -czf "$dest/auth.tgz" -C "$(dirname "$AUTH_DIR")" "$(basename "$AUTH_DIR")"
[ -f .env ] && cp .env "$dest/env.txt"
chmod -R go-rwx "$dest"

# Buang cadangan yang lebih tua dari KEEP_DAYS hari.
find backups -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +
echo "[cadangan] $dest: $(du -sh "$dest" | cut -f1)"
