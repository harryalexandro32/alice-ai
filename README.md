# WA Sales Bot (profil pertama: GFAN Indonesia)

Mesin asisten penjualan WhatsApp yang bisa dipakai ulang untuk bisnis apa pun:

1. **Salam** untuk chat pertama.
2. **Mengumpulkan data lead** (field-nya ditentukan profil bisnis), lalu mengirimnya ke nomor WA
   sales. Semua lead juga tampil di dashboard (Percakapan) dan bisa diunduh sebagai CSV.
3. **Follow-up** kalau pelanggan diam (bawaan: jam ke-23, sekali, hanya jam 08–20).
4. **Tanya-jawab** lewat LLM (bawaan DeepSeek) dari pengetahuan milik bisnis itu saja.

Hal yang tidak diketahui bot (mis. harga) dioper ke manusia. Kalau pemilik membalas sendiri dari
aplikasi WhatsApp, bot diam untuk kontak itu selama `HUMAN_PAUSE_HOURS`.

**Proyek.** Satu proyek = satu bisnis = satu nomor WhatsApp, dengan lead, profil, berkas,
pengaturan, dan penerima notifikasi sendiri. Semua proyek ada di satu database PostgreSQL (`DATABASE_URL`);
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
`http://localhost:3100/`. Dashboard berjalan sebagai proses sendiri; saat start ia membuat
proyek `gfan` kalau belum ada.

Tiap menu punya alamatnya sendiri, dengan id proyek di depan, jadi alamatnya bisa disimpan,
dibagikan, atau dibuka di tab baru:

| Alamat | Isi |
|---|---|
| `/` | ke proyek yang terakhir dibuka (cookie `last_project`), atau ke halaman masuk |
| `/login` | halaman masuk (`?next=/gfan/conversations` = tujuan setelah masuk) |
| `/gfan` | **Beranda**: 4 angka 7 hari terakhir, *Perlu perhatian*, pertanyaan yang belum terjawab |
| `/gfan/conversations` | daftar pelanggan dengan saringan tahap, cari, unduh CSV, impor pelanggan lama |
| `/gfan/conversations/+62812…` | satu percakapan: riwayat lengkap, balas dari web, tahap, catatan |
| `/gfan/knowledge/behavior` | **Cara bot bicara**: siapa yang menjawab, logo, pembukaan, pertanyaan dan rekomendasi, gaya & aturan balasan, yang harus dijawab manusia. Juga `products` (daftar produk, pertanyaan yang belum terjawab, pengetahuan lain) dan `brochures`. Panel **Coba chat** ada di tiap halaman |
| `/gfan/settings` | proyek, saat admin ikut membalas, follow-up |
| `/gfan/settings/whatsapp` | juga `notifications`, `advanced` (mode uji, batas, biaya LLM, riwayat warning, error) |

Alamat lama `/admin` dialihkan ke `/`. Alamat lama berbahasa Indonesia (`/gfan/percakapan…`,
`/gfan/pengaturan/…`) dialihkan (301) ke alamat barunya. Halaman Pengetahuan lama
(`knowledge/identity`, `knowledge/recommendations`, `knowledge/other`, `/gfan/pengetahuan/…`) tidak
dialihkan dan menjadi 404; `/gfan/knowledge` dialihkan ke `knowledge/behavior`. Daftar alamat
ada di `src/admin/routes.ts`. Data lewat `/api/<proyek>/…`; id proyek tidak boleh memakai kata
yang dipakai alamat (`api`, `login`, `logout`, `assets`, `admin`, `health`, `webhook`,
`conversations`, `knowledge`, `settings`, …).

- **Pemilih proyek** di bilah atas: pindah proyek (tetap di menu yang sama), atau
  **＋ Proyek baru…** (id, nama, bibit profil `gfan`/`generic`). Nomor bot diatur di Pengaturan >
  WhatsApp saat menautkan; penerima kabar di Pengaturan > Notifikasi.
- **Cari** (QuickSwitch) di bilah atas, atau Ctrl+K / ⌘K / `/`: satu kotak cari untuk halaman dan
  bagiannya, percakapan (nama, nomor 08… atau +62…, isian lead), produk, proyek lain, dan aksi
  (tema, bahasa, Coba chat). ↑↓ memilih, Enter membuka, Esc menutup.
- **Bilah keadaan** di atas tiap halaman: WhatsApp tersambung atau belum, **Bot dijeda**,
  **MODE UJI**, dan perkiraan biaya LLM bulan ini. Tiap tanda adalah tautan ke pengaturannya.
- **Percakapan**: tiap pelanggan punya **tahap** (baru, menunggu tim, dihubungi, link terkirim,
  pembayaran, barang terkirim, pesanan selesai, batal) dan **catatan**. Arti tiap tahap tampil saat
  saringannya disorot. Yang berubah sendiri:
  - "baru" -> "menunggu tim" saat bot menyerahkan chat ke tim (tidak bisa menjawab, pelanggan minta
    orang, atau kiriman yang hanya bisa dicek staf);
  - "baru" atau "menunggu tim" -> "dihubungi" saat admin membalas (dari HP atau dari web) atau
    menandai **Sudah ditangani**;
  - "baru", "menunggu tim", atau "dihubungi" -> "link terkirim" saat bot mengirim tautan beli (lihat
    **Tautan marketplace**).

  Tanda **Perlu staf** (bukan tahap) muncul saat bot meminta bantuan staf, di tahap apa pun, dan
  hilang saat staf membalas (dari HP atau dari web) atau menandai **Sudah ditangani**.

  Tahap tidak pernah turun sendiri. Pembayaran, barang terkirim, pesanan selesai, dan batal hanya diubah
  staf dari dashboard; bot tidak pernah memasang atau mengubahnya.
- **Tautan marketplace**: tiap produk punya kolom Tokopedia dan Shopee (https, di situs
  marketplace itu). Kalau pelanggan ingin membeli produk yang punya tautan, LLM hanya memilih
  produknya (`buy`); kode mengirim tautannya sebagai pesan sendiri dan mencatatnya di riwayat
  sebagai `[link:<produk>]`. Tautannya tidak masuk prompt.
- **Pesan yang dikutip**: kalau pelanggan membalas pesan tertentu (fitur "balas" WhatsApp), kutipannya
  ikut ke LLM sebagai catatan ("pesan terbaru mengutip pesan kita: …"), tersimpan bersama pesannya
  (kolom `messages.quote`), dan tampil di atas pesannya di halaman chat. Untuk foto atau PDF dari bot,
  kutipannya adalah keterangannya (nama produk atau berkas). Hanya jalur `baileys`; jalur `cloud`
  belum membaca kutipan.
- **Balas dari web**: balasan masuk antrean (`outbox`, jenis `reply`) dan dikirim proses bot dalam
  ±3 detik selama WhatsApp tersambung. Bot langsung mundur di chat itu, sama seperti admin yang
  membalas dari HP. Balasan yang terus gagal tampil "gagal terkirim" dan jadi warning
  `kiriman-gagal`.
- **Pertanyaan yang belum terjawab**: tiap pertanyaan yang dioper bot ke staf dicatat (tabel
  `handoffs`) dan dikelompokkan, dengan pesan bot sebelumnya dan balasan bot sesudahnya. Di
  Pengetahuan bot > Produk ada tiga pilihan:
  - **Tambahkan ke pengetahuan**: tulis jawabannya sekali; tanya-jawabnya masuk ke "Pengetahuan
    lain".
  - **Ajari bot**: kalau bot salah paham maksud pesannya, tulis artinya dan yang harus dilakukan
    bot. **Bantu jelaskan** meminta LLM menjelaskan kenapa pesannya dioper dan mengusulkan
    pelajarannya; **Coba lagi** menjalankan ulang giliran itu dengan pelajaran yang belum disimpan.
    Pelajaran yang disimpan masuk ke "Pelajaran dari percakapan" di Cara bot bicara.
  - **Abaikan**.

  Bot memakai jawaban dan pelajaran baru mulai pesan berikutnya.
- **Pengaturan > WhatsApp**: tautkan nomor proyek itu dari dashboard — pindai QR yang tampil, atau
  minta **kode pairing** 8 huruf. Setelah tersambung yang tampil hanya "Tersambung sebagai
  <nomor>". **Putuskan & tautkan ulang** untuk ganti nomor. Di bawahnya **Keadaan bot**, termasuk
  pengaman nomor dan antiban (risiko, hari pemanasan, kiriman yang ditahan).
- Tombol **Bot** per chat (mati = staf yang menangani; nyala = kembali ke bot, semua penahan
  dilepas) dan **Sudah ditangani** berlaku seketika.
- **Simpan & terapkan** berlaku pada pesan berikutnya tanpa menyalakan ulang bot: bot memeriksa
  perubahan profilnya sebelum tiap giliran (dan tiap 30 detik).

Hanya yang diubah yang disimpan (tabel `profiles`); sisanya mengikuti bibit di
`src/business/<template>/profile.ts`. Dashboard bawaannya hanya bisa dibuka dari komputer itu sendiri
(`ADMIN_HOST`).

## Jalur WhatsApp

Dipilih per proyek di dashboard (Pengaturan > Umum > Proyek):

| Jalur | Apa | Kapan |
|---|---|---|
| `baileys` | Perangkat tertaut (tidak resmi). QR / kode pairing dari dashboard. | Demo, nomor tes |
| `cloud` | WhatsApp Cloud API resmi + webhook, mendukung Coexistence | Produksi — [docs/cloud-api-setup.md](docs/cloud-api-setup.md) |

Di jalur `baileys`, tiap kiriman lewat dua pengaman: `src/transport/sendguard.ts` (batas per
menit/jam/hari dari Pengaturan > Lanjutan, jeda setelah tanda bahaya) dan kelas `AntiBan` dari
pustaka `baileys-antiban` (pemanasan nomor baru 7 hari mulai 20 kiriman/hari, bisa dimatikan per
proyek untuk nomor lama; pesan yang persis sama paling banyak 40 kali sejam; jeda otomatis saat
risikonya tinggi). Batasnya sama dengan angka di dashboard, dan jedanya tidak
dijumlahkan: bot menunggu sekali, selama jeda yang terbesar. Keadaannya disimpan di
`auth/<proyek>/antiban-state.json`.

Irama kiriman (`src/pace.ts`, berlaku untuk semua jalur): bot "mikir" dulu selama jeda di kartu **Balasan**
di Pengaturan (diacak di antara dua angkanya; follow-up dan balasan dari dashboard 1–3 detik), lalu
"sedang mengetik…" selama panjang pesannya (3,5–5,5 huruf per detik, 1,5–15 detik). Bot melayani
satu lawan bicara pada satu waktu: selama mengetik ke satu chat, kiriman ke chat lain (termasuk
notifikasi ke sales) menunggu giliran. Jalur `cloud` tidak punya "sedang mengetik…"; jedanya sama.

### Mengurangi risiko blokir

Jalur `baileys` tidak resmi, jadi selalu ada risiko nomor dibatasi atau diblokir WhatsApp. Yang
dilakukan bot untuk menekannya:

- **Variasi salam**: pembuka salam mengikuti jam ("Selamat pagi/siang/sore/malam"), dalam dua bentuk
  acak, dan kadang menyebut nama profil pelanggan. Isi salam dari dashboard tetap utuh.
- **Satu chat sekaligus**: bot "mikir", lalu "sedang mengetik…" selama panjang pesannya, dan melayani
  satu lawan bicara pada satu waktu (lihat irama kiriman di atas).
- **Jam tenang** (bawaan 00.00 sampai 07.00, Pengaturan > Lanjutan > Balasan): pesan malam tetap
  dicatat, lalu dijawab sekaligus begitu jam tenang berakhir. Follow-up tidak pernah dikirim di jam itu.
- **Kata berhenti**: pesan pendek seperti "stop", "berhenti", atau "jangan hubungi saya" dijawab
  sekali, lalu bot diam dan tidak mengirim follow-up lagi ke nomor itu. Hanya pemilik yang bisa
  mengaktifkan bot lagi di percakapannya.
- **Batas kiriman** yang rendah (bawaan 60 per jam, 300 per 24 jam) dan pemanasan 7 hari untuk
  nomor baru (matikan di Pengaturan > Lanjutan untuk nomor yang sudah lama dipakai normal).
- **Tanpa tautan dari LLM**: balasan LLM yang memuat tautan atau alamat situs tidak dikirim. Satu-satunya
  tautan dari bot adalah tautan marketplace di daftar produk, yang dikirim kode saat pelanggan ingin membeli.
- **Restart jarang**: deploy hanya menyalakan ulang bot kalau kode bot berubah.

Yang perlu dilakukan pemilik:

- Lengkapi profil WhatsApp Business (nama, foto, alamat, jam buka, keterangan).
- Biarkan HP nomor itu tetap menyala dan tersambung internet.
- Pakai nomor itu juga untuk chat manusia biasa, bukan hanya untuk bot.
- Jangan sering memutus dan menautkan ulang perangkat.

Jalan tanpa risiko blokir adalah WhatsApp Cloud API resmi (jalur `cloud`, lihat
[docs/cloud-api-setup.md](docs/cloud-api-setup.md)).

## Menambah bisnis baru

Paling cepat: **＋ Proyek baru…** di dashboard dengan bibit `generic`, lalu isi profilnya di
dashboard. Bibit sendiri di kode hanya perlu kalau bisnisnya butuh data atau pagar khusus.

Mesin tidak menyebut nama klien, produk, maupun field lead. Semua itu ada di satu folder.

1. Salin `src/business/gfan/` jadi `src/business/<id>/`.
2. Isi `profile.ts` (lihat `src/business/types.ts`):
   - `brand`, `about`, `honorific`, `greeting`
   - `leadFields` — data apa yang dikumpulkan (bebas: tanggal acara, jumlah orang, …)
   - `products` (daftar produk: nama, keterangan, harga, stok, foto, PDF, tautan Tokopedia/Shopee), `catalog` (tabel teknis rinci,
     opsional) dan `notes` (FAQ, jam buka) — satu-satunya sumber jawaban
   - `questions` — pertanyaan untuk memahami kebutuhan pelanggan
   - `handoffTopics` — yang harus dijawab manusia; `forbidPrices` kalau bot tidak boleh sebut harga
   - `checkReply` — pagar khas bisnis (opsional), `evalCases` — pertanyaan uji
3. Daftarkan di `REGISTRY` di `src/business/index.ts`; bibitnya lalu bisa dipilih saat membuat
   proyek di dashboard.
4. `PROJECT=<bibit> npm run eval` sampai jawabannya benar, baru tautkan WhatsApp-nya.

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
  sinks/                antrean lead -> WA sales, balasan dari dashboard (dicoba ulang)
  transport/            baileys.ts, cloud.ts — keduanya memenuhi types.ts
  app.ts                gabung pesan beruntun, urutan per nomor, putaran 5 menit
```

## Produksi: server + dashboard online

Di satu server (Hetzner): PostgreSQL untuk semua proyek, satu dashboard (`alice-admin`), dan satu
bot per proyek (`alice-bot@<proyek>`, dinyalakan otomatis begitu proyeknya ada dan aktif).

- `alice-api.lukicenturi.com` — Caddy (HTTPS otomatis) di depan dashboard.
- `alice.lukicenturi.com` — proyek Vercel yang hanya **meneruskan** permintaan ke alamat di atas
  (`vercel.json`). Alamat ini didaftarkan di `ADMIN_ORIGINS` pada `.env` server. Contoh:
  `https://alice.lukicenturi.com/gfan` (Beranda proyek gfan).
- Push ke `master` → GitHub Actions menguji, lalu memasang ke server lewat SSH (`deploy/`):
  migrasi database, lalu dashboard dinyalakan ulang; bot hanya kalau kode bot ikut berubah.
- Cadangan harian database (`pg_dump`), berkas unggahan, dan sesi WhatsApp ke `backups/`.

Panduan lengkap: [docs/deploy.md](docs/deploy.md).
