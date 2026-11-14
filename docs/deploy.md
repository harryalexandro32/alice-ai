# Produksi: server Hetzner + dashboard di Vercel

## Susunan

```
pelanggan ──WhatsApp──▶ bot (proses Node, systemd)  ── SQLite data/gfan.db
                          │  dashboard :3100            data/gfan/ (profil, foto, PDF)
                          │                             auth/ (sesi WhatsApp)
            Caddy :443 ◀──┘  https://alice-api.lukicenturi.com
                 ▲
pemilik ──▶ Vercel  https://alice.lukicenturi.com  (hanya meneruskan, tanpa data)
```

- **Satu tempat data**: database SQLite dan folder `data/` di server. Dashboard membaca dan
  menulis langsung ke sana, jadi perubahan berlaku pada pesan berikutnya tanpa sinkron.
- **Vercel** hanya memberi alamat `alice.lukicenturi.com`: `vercel.json` meneruskan semua
  permintaan ke server. Karena itu `.env` bot harus berisi
  `ADMIN_ORIGINS=https://alice.lukicenturi.com`, dan `ADMIN_HOST` tetap `127.0.0.1`
  (Caddy yang membukanya ke internet, lewat HTTPS).
- **Cadangan**: `deploy/backup.sh` tiap malam pukul 03.30 WIB menyalin database (`.backup`),
  `data/<bisnis>/`, `auth/`, dan `.env` ke `backups/<tanggal>/`, disimpan 14 hari.

## Pasang server (sekali)

Server Ubuntu 24.04 di Hetzner (CX22 cukup). Sebagai root:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/alice-ai/master/deploy/setup-server.sh -o setup-server.sh
REPO=git@github.com:OWNER/alice-ai.git \
DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions" \
bash setup-server.sh
```

`DEPLOY_PUBKEY` adalah kunci publik yang dipakai GitHub Actions untuk masuk sebagai `alice`.
Kalau repo-nya privat, skrip mencetak **kunci deploy** yang harus didaftarkan di GitHub
(Settings → Deploy keys, read-only), lalu jalankan skrip itu lagi.

Lalu:

1. DNS: `alice-api` → A record ke IP server (di Vercel DNS: `vercel dns add lukicenturi.com alice-api A <IP>`).
   Caddy mengurus sertifikat HTTPS sendiri begitu DNS-nya mengarah.
2. Isi `/opt/alice-ai/.env` (lihat `.env.example`). Wajib: `ADMIN_PASSWORD`, `LLM_API_KEY`,
   `ADMIN_ORIGINS`. Salin juga `data/` dan `auth/` dari mesin lama kalau ada, supaya profil,
   lead, dan sesi WhatsApp tidak hilang: `chown -R alice:alice /opt/alice-ai/{data,auth}`.
3. `systemctl start alice-ai && journalctl -u alice-ai -f`. Tanpa `auth/` lama, bot minta
   tautkan perangkat: isi `WA_PAIRING_NUMBER` di `.env` supaya kode 8 digitnya muncul di log
   (tanpa perlu memindai QR dari terminal).

## Dashboard di Vercel

Proyek Vercel dari repo ini hanya memakai `public/` dan `vercel.json` (`.vercelignore`
membuang sisanya). Tidak ada env yang perlu diisi di Vercel.

```bash
vercel link            # proyek baru: alice-ai
vercel git connect     # deploy otomatis tiap push
vercel domains add alice.lukicenturi.com
```

## Deploy otomatis

Tiap push ke `master`, `.github/workflows/deploy.yml`:

1. `npm ci`, `npm run typecheck`, `npm test` di GitHub;
2. kalau lulus, SSH ke server sebagai `alice` dan menjalankan `deploy/deploy.sh`:
   `git reset --hard origin/master` → `npm ci` → `systemctl restart alice-ai` → cek aktif.

Rahasia di repo (Settings → Secrets and variables → Actions): `DEPLOY_HOST` (IP server) dan
`DEPLOY_SSH_KEY` (kunci privat pasangan `DEPLOY_PUBKEY`). Vercel mendeploy sendiri dari GitHub.

## Sehari-hari

```bash
journalctl -u alice-ai -f                 # log bot
systemctl status alice-ai                 # jalan?
sudo -u alice /opt/alice-ai/deploy/deploy.sh   # pasang manual
ls /opt/alice-ai/backups/                 # cadangan
sqlite3 /opt/alice-ai/data/gfan.db '.tables'   # lihat database
```

Memulihkan dari cadangan: hentikan bot, salin `backups/<tanggal>/gfan.db` ke `data/gfan.db`,
buka `data-gfan.tgz` ke `data/`, `auth.tgz` ke `auth/`, lalu nyalakan lagi.

Satu nomor = satu bot: jangan jalankan bot yang sama di dua mesin (keduanya saling merebut sesi
WhatsApp, kode 440). Matikan yang di mesin lama sebelum menyalakan yang di server.
