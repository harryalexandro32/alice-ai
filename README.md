# WA Sales Bot (profil pertama: GFAN Indonesia)

Mesin asisten penjualan WhatsApp yang bisa dipakai ulang untuk bisnis apa pun:

1. **Salam** untuk chat pertama.
2. **Mengumpulkan data lead** (field-nya ditentukan profil bisnis), lalu mengirimnya ke nomor WA
   sales dan Google Sheet.
3. **Follow-up** kalau pelanggan diam (bawaan: jam ke-23, sekali, hanya jam 08–20).
4. **Tanya-jawab** lewat LLM (bawaan DeepSeek) dari pengetahuan milik bisnis itu saja.

Hal yang tidak diketahui bot (mis. harga) dioper ke manusia. Kalau pemilik membalas sendiri dari
aplikasi WhatsApp, bot diam untuk kontak itu selama `HUMAN_PAUSE_HOURS`.

**Proyek.** Satu proyek = satu bisnis = satu nomor WhatsApp, dengan lead, profil, berkas,
pengaturan, dan nomor sales sendiri. Semua proyek ada di satu database PostgreSQL (`DATABASE_URL`);
tiap bot melayani satu proyek (`PROJECT=gfan npm run bot`), dan satu dashboard melayani semuanya.

## Coba tanpa WhatsApp

```bash
npm install
cp .env.example .env      # DATABASE_URL bawaan: pglite://./data/pg (tanpa server database)
PROJECT=gfan npm run chat
```

Mode latihan membaca profil proyeknya dari `DATABASE_URL`, tapi percakapannya hanya disimpan di
memori. `DATABASE_URL=memory://` = bibit dari kode saja.

Di dalam mode latihan: `/maju 23j` (majukan jam + jalankan follow-up), `/manusia <teks>`, `/lead`,
`/nomor 62812…`. Tanpa `LLM_API_KEY` di `.env`, pertanyaan dioper ke manusia.

## Perintah

```bash
npm test             # katalog, penyedia LLM, jalur Cloud API, dashboard, dan alur (PGlite di memori)
npm run typecheck
npm run eval         # ukur jawaban ke LLM sungguhan (butuh key)
npm run admin        # dashboard untuk semua proyek (proses sendiri)
PROJECT=gfan npm run bot   # bot satu proyek
npm start            # bot lewat pengawas (PROJECT di .env): nyala lagi kalau mati, log di logs/
npm run db:migrate   # jalankan migrasi (otomatis juga saat bot/dashboard start)
npm run db:seed      # buat proyek gfan kalau belum ada (aman diulang)
npm run db:generate  # buat berkas migrasi baru setelah mengubah src/db/schema.ts
```

## Dashboard pemilik

Isi `ADMIN_PASSWORD` di `.env` (minimal 8 karakter), lalu `npm run admin` dan buka
`http://localhost:3100/admin`. Dashboard berjalan sebagai proses sendiri; saat start ia membuat
proyek `gfan` kalau belum ada.

- **Pemilih proyek** di bilah atas: pindah proyek, atau **＋ Proyek baru…** (id, nama, bibit profil
  `gfan`/`generic`, nomor WA bot, nomor sales).
- **Pengaturan > WhatsApp**: tautkan nomor proyek itu dari dashboard — pindai QR yang tampil, atau
  minta **kode pairing** 8 huruf. **Putuskan & tautkan ulang** untuk ganti nomor.
- **Pengaturan > Proyek**: nama, nomor bot, nomor sales, jalur (`baileys`/`cloud`), aktif, dan
  **Bot dijeda untuk semua chat** (pesan tetap dicatat, tapi tidak dibalas dan tanpa follow-up).
- **Lead**: tombol **Bot** per chat (mati = staf yang menangani; nyala = kembali ke bot, semua
  penahan dilepas) dan **Sudah ditangani**. Berlaku seketika.
- Identitas, salam, data yang dikumpulkan, produk, PDF, panduan rekomendasi, notifikasi, dan
  **Uji coba**. **Simpan & terapkan** berlaku pada pesan berikutnya tanpa menyalakan ulang bot: bot
  memeriksa perubahan profilnya sebelum tiap giliran (dan tiap 30 detik).

Hanya yang diubah yang disimpan (tabel `profiles`); sisanya mengikuti bibit di
`src/business/<template>/profile.ts`. Dashboard bawaannya hanya bisa dibuka dari komputer itu sendiri
(`ADMIN_HOST`).

## Jalur WhatsApp

Dipilih per proyek di dashboard (Pengaturan > Proyek):

| Jalur | Apa | Kapan |
|---|---|---|
| `baileys` | Perangkat tertaut (tidak resmi). QR / kode pairing dari dashboard. | Demo, nomor tes |
| `cloud` | WhatsApp Cloud API resmi + webhook, mendukung Coexistence | Produksi — [docs/cloud-api-setup.md](docs/cloud-api-setup.md) |

## Menambah bisnis baru

Paling cepat: **＋ Proyek baru…** di dashboard dengan bibit `generic`, lalu isi profilnya di
dashboard. Bibit sendiri di kode hanya perlu kalau bisnisnya butuh data atau pagar khusus.

Mesin tidak menyebut nama klien, produk, maupun field lead. Semua itu ada di satu folder.

1. Salin `src/business/gfan/` jadi `src/business/<id>/`.
2. Isi `profile.ts` (lihat `src/business/types.ts`):
   - `brand`, `about`, `honorific`, `greeting`
   - `leadFields` — data apa yang dikumpulkan (bebas: tanggal acara, jumlah orang, …)
   - `products` (daftar produk: nama, keterangan, harga, stok, foto, PDF), `catalog` (tabel teknis rinci,
     opsional) dan `notes` (FAQ, jam buka) — satu-satunya sumber jawaban
   - `questions` — pertanyaan untuk memahami kebutuhan pelanggan
   - `handoffTopics` — yang harus dijawab manusia; `forbidPrices` kalau bot tidak boleh sebut harga
   - `checkReply` — pagar khas bisnis (opsional), `evalCases` — pertanyaan uji
3. Daftarkan di `REGISTRY` di `src/business/index.ts`; bibitnya lalu bisa dipilih saat membuat
   proyek di dashboard.
4. `PROJECT=<bibit> npm run eval` sampai jawabannya benar, baru tautkan WhatsApp-nya.

Judul kolom Sheet: Waktu, Jenis, Nomor, lalu satu kolom per `leadFields`, Perlu sales, Pesan terakhir.
Simpan kunci akun layanan sebagai `google-service-account.json` dan bagikan Sheet-nya (Editor) ke
email akun itu.

## Susunan

```
src/
  db/                   skema PostgreSQL (Drizzle), sambungan + migrasi otomatis, seed
  store.ts              semua akses data, per proyek
  project.ts            proyek yang sedang dilayani (bawaan proses bot / per permintaan dashboard)
  heartbeat.ts          laporan bot ke dashboard (WhatsApp, QR, kode pairing) + permintaan dashboard
  business/types.ts     bentuk profil bisnis
  business/gfan/        profil + katalog GFAN (ditranskripsi tangan dari catalog-pdf/)
  business/generic/     bibit netral untuk proyek baru
  brain.ts              prompt dirakit dari profil + pagar balasan
  flow.ts               pesan masuk -> balasan; salam, data lead, serah-terima
  followup.ts           jadwal & pengiriman follow-up
  sinks/                antrean lead -> WA sales + Google Sheet (dicoba ulang)
  transport/            baileys.ts, cloud.ts — keduanya memenuhi types.ts
  app.ts                gabung pesan beruntun, urutan per nomor, putaran 5 menit
```

## Produksi: server + dashboard online

Di satu server (Hetzner): PostgreSQL untuk semua proyek, satu dashboard (`alice-admin`), dan satu
bot per proyek (`alice-bot@<proyek>`, dinyalakan otomatis begitu proyeknya ada dan aktif).

- `alice-api.lukicenturi.com` — Caddy (HTTPS otomatis) di depan dashboard.
- `alice.lukicenturi.com` — proyek Vercel yang hanya **meneruskan** permintaan ke alamat di atas
  (`vercel.json`). Alamat ini didaftarkan di `ADMIN_ORIGINS` pada `.env` server.
- Push ke `master` → GitHub Actions menguji, lalu memasang ke server lewat SSH (`deploy/`):
  migrasi database, lalu dashboard dan semua bot dinyalakan ulang.
- Cadangan harian database (`pg_dump`), berkas unggahan, dan sesi WhatsApp ke `backups/`.

Panduan lengkap: [docs/deploy.md](docs/deploy.md).
