# Langkah demi langkah ke WhatsApp Cloud API resmi

Kodenya sudah siap (jalur `cloud` di dashboard > Pengaturan > Proyek, `src/transport/cloud.ts`). Yang di bawah ini pekerjaan di
sisi Meta dan server. Sumber: dokumentasi Meta (halaman *Get started* Cloud API dan *Onboarding
WhatsApp Business app users*), dibaca 10 Nov 2026. Dasbor Meta sering berganti nama menu — kalau
letaknya beda, cari nama yang ditebalkan.

## Dua jalur, dan mana yang berlaku

| | **A. Cloud API langsung** | **B. Coexistence** |
|---|---|---|
| Nomor masih bisa dipakai di aplikasi WA Business? | **Tidak** — nomor khusus API | **Ya** |
| Siapa yang bisa mendaftarkan | Siapa saja, lewat app Meta sendiri | **Hanya Solution Partner / Tech Provider** (Embedded Signup) |
| Bisa dikerjakan hari ini | Ya | Butuh partner, atau jadi Tech Provider dulu |

Klien minta Coexistence, jadi tujuan akhirnya **B**. Tapi **A dengan nomor tes Meta** tetap layak
dikerjakan dulu: gratis, selesai dalam sejam, dan membuktikan bot + webhook + server jalan di jalur
resmi sebelum nomor klien disentuh.

---

## Jalur A — Cloud API langsung (mulai dari sini, dengan nomor tes)

### 1. Akun & app Meta
1. Punya **Meta Business portfolio** di business.facebook.com (gratis).
2. developers.facebook.com → **Create app** → use case **"Connect with customers through WhatsApp"**
   → pilih portfolio tadi.
3. Di app itu buka **WhatsApp → API Setup**. Meta memberi satu **nomor tes** dan satu akun WhatsApp
   Business (WABA). Catat **Phone number ID** dan **WhatsApp Business Account ID**.
4. Di kolom **To**, tambahkan nomor HP Anda sebagai penerima tes (maksimal 5 nomor), verifikasi
   kodenya, lalu klik kirim pesan contoh. Pesan `hello_world` harus sampai di HP.

### 2. Server dengan HTTPS publik
Meta memanggil webhook lewat internet, jadi bot harus punya alamat `https://…`.
- **Produksi:** VPS kecil + domain + reverse proxy ber-TLS (Caddy paling ringkas) ke `localhost:3000`.
- **Uji cepat dari laptop:** terowongan, mis. `cloudflared tunnel --url http://localhost:3000`.
  Alamatnya berganti tiap dijalankan — cukup untuk mencoba, bukan untuk produksi.

### 3. Isi `.env` dan jalankan
Pilih jalur **Cloud API** untuk proyeknya di dashboard (Pengaturan > Proyek), lalu isi `.env`:

```
WA_PHONE_NUMBER_ID=<Phone number ID dari langkah 1.3>
WA_TOKEN=<token sementara dari tombol "Generate access token" — diganti di langkah 6>
WA_APP_SECRET=<App settings → Basic → App secret>
WA_VERIFY_TOKEN=<karang sendiri, mis. string acak 32 karakter>
PORT=3000
```
```bash
PROJECT=<proyek> npm run bot     # di server: systemctl restart alice-bot@<proyek>
```
Log yang benar: `[cloud] nomor: … ` lalu `[cloud] webhook mendengarkan di port 3000 (/webhook) — SIAP`.
Kalau baris nomor diganti WARNING, token atau Phone number ID-nya salah.

### 4. Daftarkan webhook
**WhatsApp → Configuration → Webhook → Edit**:
- **Callback URL:** `https://<domain>/webhook`
- **Verify token:** sama persis dengan `WA_VERIFY_TOKEN`

Klik **Verify and save** (bot harus sedang jalan). Lalu di **Webhook fields**, **Subscribe** ke
`messages`.

### 5. Coba
Dari HP yang terdaftar di langkah 1.4, kirim "halo" ke nomor tes. Bot membalas salam. Di log:
`[cloud] diproses: dari=628…`. Kalau tidak ada apa-apa di log, webhook-nya belum sampai: cek
langkah 4, dan pastikan app sudah di-subscribe ke WABA (langkah 7.4).

### 6. Token permanen
Token dari tombol *Generate* mati dalam ±24 jam. Buat yang permanen:
1. **Business settings → Users → System users → Add** (peran Admin).
2. **Assign assets**: app-nya (*Manage app*) dan akun WhatsApp-nya (*Manage WhatsApp Business accounts*).
3. **Generate token** → pilih app → centang `business_management`, `whatsapp_business_messaging`,
   `whatsapp_business_management` → masa berlaku *Never*.
4. Taruh di `WA_TOKEN`, jalankan ulang bot.

### 7. Pindah dari nomor tes ke nomor asli (hanya kalau TIDAK pakai Coexistence)
1. **WhatsApp Manager → Phone numbers → Add phone number**. Nomornya **tidak boleh sedang terdaftar
   di aplikasi WhatsApp/WA Business** — akun di aplikasi harus dihapus dulu, dan setelah ini nomor
   itu tidak bisa dipakai di aplikasi lagi. *Inilah bedanya dengan Coexistence.*
2. Verifikasi lewat SMS/telepon. Nama tampilan ditinjau Meta.
3. Ganti `WA_PHONE_NUMBER_ID` dengan ID nomor baru.
4. Pastikan app berlangganan ke WABA: `POST /<WABA_ID>/subscribed_apps` dengan token di atas
   (lewat dasbor biasanya sudah otomatis).
5. Tambahkan **metode pembayaran** di WhatsApp Manager, selesaikan **verifikasi bisnis** (menaikkan
   batas kirim), dan ubah app ke mode **Live** (butuh URL kebijakan privasi).

---

## Jalur B — Coexistence (nomor tetap dipakai di aplikasi WA Business)

### Syarat nomor klien
- Terdaftar di **WhatsApp Business App**, versi **2.24.17** atau lebih baru.
- Sudah dipakai aktif (panduan pihak ketiga yang dikirim klien menyebut minimal 7 hari; dokumen
  Meta tidak menyebut angkanya).
- Punya Meta Business portfolio.

### 1. Tentukan siapa partnernya
Meta hanya mengizinkan pendaftaran Coexistence lewat **Solution Partner** atau **Tech Provider**.
Dua pilihan:

- **Pakai BSP yang sudah ada.** Yang harus ditanyakan sebelum memilih:
  1. Mendukung *Coexistence / Connect a WhatsApp Business App number*?
  2. Memberi **akses API + webhook mentah berformat Cloud API**, termasuk field
     `smb_message_echoes`? (Tanpa ini bot tidak tahu kapan sales membalas dari aplikasi.)
  3. Biaya per bulan / per pesan di atas tarif Meta.

  Kalau bentuk API partnernya berbeda dari Meta (URL atau header lain), `cloud.ts` perlu
  penyesuaian kecil di fungsi `graph()` dan pemeriksaan tanda tangan — alurnya tidak berubah.
- **Menjadi Tech Provider sendiri.** Butuh verifikasi bisnis, App Review, dan Embedded Signup
  (versi 4 ke atas; v2/v3 sudah dihentikan 15 Okt 2026). Makan waktu berminggu-minggu, tapi
  sekali jadi bisa dipakai untuk **semua klien berikutnya** tanpa biaya BSP — layak kalau bot ini
  memang akan direplikasi ke banyak bisnis.

### 2. Onboarding
1. Dari dasbor partner, buka alur **Embedded Signup**.
2. Pilih **"Connect a WhatsApp Business App number"**, masukkan nomor klien.
3. Di HP klien: buka WA Business → pindai QR yang muncul → setujui berbagi riwayat chat.
4. Partner punya **24 jam** untuk menyinkronkan riwayat; kalau tidak, nomornya harus di-offboard.

### 3. Sambungkan bot
1. Dari partner, ambil: Phone number ID, token, App Secret (atau padanannya), base URL API.
2. Isi `.env` seperti Jalur A langkah 3 (`WA_API_BASE` kalau base URL-nya bukan graph.facebook.com).
3. Daftarkan webhook `https://<domain>/webhook`, dan berlangganan ke field:
   **`messages`** dan **`smb_message_echoes`**. (`history` dan `smb_app_state_sync` tidak dipakai bot.)

### 4. Uji tiga hal
1. HP lain chat ke nomor klien → bot membalas.
2. Sales membalas dari aplikasi WA Business → log `[cloud] manusia membalas dari aplikasi`, dan
   bot diam untuk kontak itu selama `HUMAN_PAUSE_HOURS`.
3. Balasan bot terlihat di aplikasi WA Business klien.

### Yang berubah bagi klien setelah Coexistence
- **Perangkat tertaut (WhatsApp Web/Desktop) dilepas saat onboarding**; WhatsApp untuk Windows dan
  WearOS tidak didukung.
- Aplikasi harus tetap dipakai: perangkat utama yang tidak aktif ±14 hari memutus sambungan.
- Mati/tidak didukung: pesan menghilang, sekali-lihat, lokasi langsung. Daftar siaran jadi hanya-baca.
  Grup tidak tersinkron ke API.
- Menurut dokumen Meta, alat bisnis di aplikasi (katalog, balasan cepat, label, pesan di luar jam
  kerja) tidak didukung lewat jalur ini — pastikan ke klien apakah mereka mengandalkannya.
- Pesan dari aplikasi tetap gratis; pesan lewat API mengikuti tarif Cloud API. Throughput 20 pesan/detik.
- Pelanggan yang chat **sebelum** onboarding hanya bisa dibalas API dengan template.

---

## Aturan Cloud API yang memengaruhi bot ini

- **Jendela 24 jam.** Teks bebas hanya boleh dalam 24 jam sejak pesan terakhir pelanggan. Karena
  itu follow-up bawaannya jam ke-23, dan di jalur `cloud` yang jatuh malam hari **dimajukan** ke
  sore, bukan ditunda. Follow-up setelah 24 jam butuh **template marketing** berbayar.
- **Nomor sales = nomor bot** (nomor sales `self` di dashboard). Cloud API tidak bisa mengirimi dirinya sendiri,
  jadi tidak ada notifikasi WA. Dengan Coexistence itu wajar: percakapannya sudah tampil di aplikasi
  sales, dan tiap lead tercatat di dashboard.
- **Nomor sales berbeda.** Notifikasi teks biasa hanya sampai kalau sales mengirim pesan ke nomor
  bot dalam 24 jam terakhir. Supaya selalu sampai: buat template **utility** dengan satu variabel,
  mis. nama `lead_baru`, isi `Lead baru: {{1}}`, lalu isi `WA_LEAD_TEMPLATE=lead_baru`.
- **Versi Graph API.** Bawaan `v23.0`; contoh di dokumen Coexistence sudah memakai versi lebih baru.
  Ganti lewat `WA_API_BASE` kalau Meta menghentikan versi lama.

## Kalau macet

| Gejala | Biasanya |
|---|---|
| *Verify and save* gagal | Bot belum jalan, URL tidak sampai ke port bot, atau verify token beda |
| Log `webhook DITOLAK: tanda tangan tidak cocok` | `WA_APP_SECRET` bukan milik app yang mengirim webhook |
| Chat masuk tapi log kosong | Field `messages` belum di-subscribe, atau app belum subscribe ke WABA |
| `Cloud API 400 (131047)` | Di luar jendela 24 jam — butuh template |
| `Cloud API 401 (190)` | Token kedaluwarsa — pakai token System User |
| Nomor tes tidak membalas ke HP tertentu | HP itu belum ditambahkan sebagai penerima tes |
