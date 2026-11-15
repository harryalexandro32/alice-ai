# Produksi: server Hetzner + dashboard di Vercel

## Susunan

```
pelanggan ──WhatsApp──▶ alice-bot@gfan    (satu proses per proyek)  ─┐
pelanggan ──WhatsApp──▶ alice-bot@toko-b                             ├─ PostgreSQL "alice" (semua proyek)
                         alice-admin :3100 (dashboard semua proyek) ─┘   data/<proyek>/media/ (foto, PDF)
                              ▲                                          auth/<proyek>/ (sesi WhatsApp)
            Caddy :443 ───────┘  https://alice-api.lukicenturi.com
                 ▲
pemilik ──▶ Vercel  https://alice.lukicenturi.com  (hanya meneruskan, tanpa data)
```

- **Proyek** = satu bisnis = satu nomor WhatsApp, dengan lead, profil, berkas, pengaturan, dan
  nomor sales sendiri. Semua baris di database membawa kolom `project`.
- **Satu database PostgreSQL** (`DATABASE_URL` di `.env`) untuk semua proyek. Tabelnya dibuat dan
  diperbarui oleh migrasi di `drizzle/` (otomatis saat start, dan oleh `deploy.sh`).
- **Satu bot per proyek**: `alice-bot@<proyek>.service` (`PROJECT=<proyek> npm run bot`).
  `alice-reconcile.timer` memeriksa tabel `projects` tiap menit: proyek aktif dinyalakan, yang
  dinonaktifkan atau dihapus dimatikan. Proyek baru dari dashboard punya bot dalam ±1 menit.
- **Satu dashboard** untuk semua proyek: `alice-admin.service` (`npm run admin`). Ia proses
  sendiri; keadaan bot (WhatsApp, QR, kode pairing, jatah LLM) dibaca dari tabel `project_status`
  yang ditulis tiap bot tiap 30 detik.
- **`.env`** hanya berisi yang dipakai bersama: `DATABASE_URL`, `LLM_*`, `ADMIN_PASSWORD`,
  `ADMIN_PORT`, `ADMIN_HOST`, `ADMIN_ORIGINS`, `DATA_DIR`, `BOT_TZ`, SMTP/STT, `LOG_*`.
  Jalur WhatsApp, nomor bot, nomor sales, mode uji, dan follow-up diatur per proyek di dashboard.
- **Vercel** hanya memberi alamat `alice.lukicenturi.com`: `vercel.json` meneruskan semua
  permintaan ke server. Karena itu `.env` berisi `ADMIN_ORIGINS=https://alice.lukicenturi.com`, dan
  `ADMIN_HOST` tetap `127.0.0.1` (Caddy yang membukanya ke internet, lewat HTTPS).

## Pasang server (sekali)

Server: Hetzner `rhys-2` (Ubuntu 24.04), dipakai bersama aplikasi lain. Skrip pemasangan hanya
menyentuh bagian Alice: tidak menulis `/etc/caddy/Caddyfile`, tidak mengubah firewall, dan memakai
PostgreSQL dari apt di port 5432 (127.0.0.1 saja). Sebagai root:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/alice-ai/master/deploy/setup-server.sh -o setup-server.sh
REPO=git@github.com:OWNER/alice-ai.git \
DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions" \
bash setup-server.sh
```

Yang dilakukan skrip (aman diulang):

1. Memasang Node 22 (NodeSource), PostgreSQL (apt), dan git; membuat pengguna `alice`.
2. Clone repo ke `/opt/alice-ai`. Kalau repo-nya privat, skrip mencetak **kunci deploy** untuk
   GitHub (Settings → Deploy keys, read-only); jalankan skrip itu lagi sesudahnya.
3. Membuat peran dan database PostgreSQL `alice` dengan kata sandi acak, lalu menulis
   `DATABASE_URL=postgres://alice:…@127.0.0.1:5432/alice` ke `.env` (sekali saja). Kalau
   `ADMIN_PASSWORD` belum diisi, dibuat acak dan dicetak di akhir.
4. `npm ci`, `npm run db:migrate`, `npm run db:seed` (proyek `gfan`).
5. Memasang layanan systemd: `alice-admin`, `alice-bot@.service`, `alice-reconcile.timer`,
   `alice-backup.timer`, dan menyalakannya.
6. Menulis `deploy/alice.caddy` ke `/etc/caddy/conf.d/alice.caddy` (`alice-api.lukicenturi.com` →
   dashboard `127.0.0.1:3100`; `/webhook*` dan `/health` → `127.0.0.1:3000` untuk jalur Cloud API),
   memeriksa `caddy validate --config /etc/caddy/Caddyfile.main`, lalu `systemctl reload caddy`.

Lalu:

1. DNS: `alice-api` → A record ke IP server (`vercel dns add lukicenturi.com alice-api A <IP>`).
   Caddy mengurus sertifikat HTTPS sendiri begitu DNS-nya mengarah.
2. Isi `LLM_API_KEY` (dan SMTP/STT kalau dipakai) di `/opt/alice-ai/.env`, lalu
   `systemctl restart alice-admin 'alice-bot@*'`.
3. Buka `https://alice.lukicenturi.com/gfan/settings/whatsapp` dan tautkan nomornya (lihat di bawah).

## Proyek baru

Di dashboard: pemilih proyek di bilah atas → **＋ Proyek baru…**. Isi:

- **Id**: 2–32 huruf kecil, angka, atau tanda minus (mis. `toko-budi`). Dipakai di alamat
  dashboard (`https://alice.lukicenturi.com/toko-budi`), nama layanan (`alice-bot@toko-budi`), dan
  folder `data/toko-budi/`, `auth/toko-budi/`. Kata yang dipakai alamat dashboard atau dialihkan
  Caddy ke bot (`api`, `login`, `logout`, `assets`, `admin`, `health`, `webhook`, `robots.txt`,
  `favicon.ico`, `conversations`, `knowledge`, `settings`, `percakapan`, `pengetahuan`,
  `pengaturan`) ditolak.
- **Nama**, **bibit profil** (`generic` = mulai kosong; `gfan` = menyalin data produk GFAN),
  **nomor WA bot**, **nomor sales** (`self` = nomor bot sendiri).

Dalam ±1 menit `alice-reconcile.timer` menyalakan `alice-bot@<id>`, dan dashboard membuka
`/<id>/settings/whatsapp` untuk menautkan nomornya. Lead proyek baru mulai kosong.

## Menautkan WhatsApp dari dashboard

Pengaturan → **WhatsApp** (`/<proyek>/settings/whatsapp`; halaman ini memeriksa keadaan bot tiap
3 detik selama belum tersambung):

- **QR**: begitu bot jalan dan belum tertaut, QR-nya tampil. Di HP: WhatsApp → Perangkat tertaut →
  Tautkan perangkat → pindai.
- **Kode pairing**: isi nomor bot, tekan **Minta kode pairing**. Kode 8 huruf muncul dalam
  beberapa detik; di HP pilih “Tautkan dengan nomor telepon saja” dan ketik kodenya.
- **Putuskan & tautkan ulang**: bot keluar dari sesi sekarang, menghapus `auth/<proyek>/`, lalu
  menampilkan QR baru. Dipakai untuk ganti nomor, atau setelah sesi dicabut dari HP.

Keadaan yang tampil: menyambung, menunggu dipindai, menunggu kode pairing, tersambung, terputus,
sesi dicabut dari HP, sesi direbut sesi lain (440), bot berhenti, atau **bot tidak melapor** (tidak
ada laporan lebih dari 2 menit: bot mati atau proyeknya nonaktif).

## Menjeda bot

- **Satu chat**: Percakapan → tombol **Bot** di barisnya, atau **Jeda bot di chat ini** / **Aktifkan
  bot lagi** di halaman percakapannya. Mati = bot diam di chat itu sampai dinyalakan lagi; nyala =
  semua penahan dilepas (termasuk jeda karena admin membalas). Berlaku seketika.
- **Admin membalas dari dashboard**: halaman percakapan → kotak balasan. Bot mundur di chat itu
  persis seperti admin yang membalas dari HP; balasannya dikirim proses bot dalam ±3 detik selama
  WhatsApp tersambung (menunggu di antrean selama belum).
- **Semua chat**: Pengaturan → Umum → Proyek → **Bot dijeda untuk semua chat**. Pesan dan kontak tetap
  dicatat, tapi bot tidak membalas dan tidak mengirim follow-up. Bot memuatnya dalam ±5 detik.
- **Admin membalas dari HP**: tetap seperti biasa — bot mundur selama `HUMAN_PAUSE_HOURS`, atau
  selamanya untuk chat itu kalau “begitu admin membalas, bot tidak ikut campur lagi” dicentang.
- **Hentikan bot proyek**: Pengaturan → Umum → Proyek → hilangkan centang **Proyek aktif**; reconcile
  mematikan layanannya dalam ±1 menit.

## Alamat dashboard

Satu alamat per menu, dengan id proyek di depan (semuanya dilayani `page.html` yang sama; router di
`src/admin/app.js` membaca alamatnya):

- `https://alice.lukicenturi.com/` → proyek yang terakhir dibuka (cookie `last_project`), atau
  `/login` kalau belum masuk.
- `/gfan` (Beranda), `/gfan/conversations`, `/gfan/conversations/+62812…`,
  `/gfan/knowledge/{identity,products,recommendations,brochures,other}`,
  `/gfan/settings`, `/gfan/settings/{whatsapp,notifications,advanced}`.
- `/assets/app.js`, `/assets/app.css`, `/assets/qrcode.js`; data lewat `/api/login`,
  `/api/projects`, `/api/<proyek>/…`.
- Alamat lama `/admin` dan `/admin/*` dialihkan (301) ke `/`. Alamat lama berbahasa Indonesia
  (`/gfan/percakapan…`, `/gfan/pengetahuan/…`, `/gfan/pengaturan/…`) dialihkan (301) ke alamat
  barunya, dengan query yang sama.

Cookie sesi `admin_session` berlaku untuk `Path=/`. Caddy tetap meneruskan `/webhook*` dan
`/health` ke port 3000 (jalur Cloud API) dan sisanya ke dashboard; karena itu `health` dan
`webhook` tidak pernah sah sebagai id proyek.

## Dashboard di Vercel

Proyek Vercel dari repo ini hanya memakai `public/` dan `vercel.json` (`.vercelignore` membuang
sisanya). Tidak ada env yang perlu diisi di Vercel.

```bash
vercel link            # proyek baru: alice-ai
vercel git connect     # deploy otomatis tiap push
vercel domains add alice.lukicenturi.com
```

## Deploy otomatis

Tiap push ke `master`, `.github/workflows/deploy.yml`:

1. `npm ci`, `npm run typecheck`, `npm test` di GitHub;
2. kalau lulus, SSH ke server sebagai `alice` dan menjalankan `deploy/deploy.sh`:
   `git reset --hard origin/master` → `npm ci` → `npm run db:migrate` → `npm run db:seed` →
   `systemctl restart alice-admin` → `'alice-bot@*'` hanya kalau kode bot berubah → cek semuanya aktif.

Bot hanya dinyalakan ulang kalau commit baru mengubah berkas di luar daftar ini: `src/admin/`,
`docs/`, `README.md`, `.github/`, `public/`, `vercel.json`, `deploy/alice.caddy`, `.vercelignore`,
dan berkas `*.md`. Setiap restart berarti WhatsApp tersambung ulang, dan sambungan ulang yang
sering membuat nomor lebih dicurigai. `package.json`, `src/db/`, `drizzle/`, dan `deploy/*.service`
dihitung perubahan bot. Log deploy menyebut keputusannya dan 5 berkas pertama yang berubah.

Rahasia di repo (Settings → Secrets and variables → Actions): `DEPLOY_HOST` (IP server) dan
`DEPLOY_SSH_KEY` (kunci privat pasangan `DEPLOY_PUBKEY`). Vercel mendeploy sendiri dari GitHub.

## Migrasi database

Skema ada di `src/db/schema.ts`. Setelah mengubahnya:

```bash
npm run db:generate   # membuat berkas SQL baru di drizzle/ — ikut di-commit
```

Migrasi dijalankan otomatis saat bot/dashboard start dan oleh `deploy.sh` (`npm run db:migrate`);
yang sudah pernah dijalankan dilewati. `npm run db:seed` hanya membuat proyek `gfan` kalau belum ada
dan tidak pernah menimpa baris yang sudah ada.

## Cadangan dan memulihkan

`alice-backup.timer` tiap malam pukul 03.30 WIB menjalankan `deploy/backup.sh`:
`backups/<tanggal>/db.sql.gz` (`pg_dump` semua proyek), `data.tgz`, `auth.tgz`, dan `env.txt`.
Disimpan 14 hari (`BACKUP_KEEP_DAYS`).

Memulihkan:

```bash
systemctl stop alice-reconcile.timer alice-admin 'alice-bot@*'
cd /opt/alice-ai
sudo -u alice bash -c 'gunzip -c backups/<tanggal>/db.sql.gz | psql "$(grep ^DATABASE_URL= .env | cut -d= -f2-)"'
sudo -u alice tar -xzf backups/<tanggal>/data.tgz
sudo -u alice tar -xzf backups/<tanggal>/auth.tgz
systemctl start alice-admin alice-reconcile.timer   # bot dinyalakan reconcile dalam ±1 menit
```

## Sehari-hari

```bash
journalctl -u alice-admin -f                      # log dashboard
journalctl -u alice-bot@gfan -f                   # log bot proyek gfan
systemctl list-units 'alice-bot@*'                # bot mana yang jalan
sudo -u alice /opt/alice-ai/deploy/deploy.sh      # pasang manual
ls /opt/alice-ai/backups/                         # cadangan
sudo -u alice psql "$(grep ^DATABASE_URL= /opt/alice-ai/.env | cut -d= -f2-)" -c 'select id, enabled, paused from projects'
```
