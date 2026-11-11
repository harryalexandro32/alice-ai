# Notifikasi untuk pemilik dan staf

Bot mengabari orang saat ada yang butuh manusia. Ada dua hal yang diatur, di dua tempat:

| Apa | Di mana | Kenapa di situ |
|---|---|---|
| **Siapa** yang dikabari, lewat jalur apa, dan jenis kabar mana ke siapa | Dashboard → **Pengaturan → Notifikasi** | Sering berubah, tidak rahasia, tidak perlu nyalakan ulang bot |
| **Rahasia** jalurnya: token bot Telegram, sandi SMTP email | Berkas `.env` di mesin bot | Tidak boleh tersimpan di dashboard online; perlu nyalakan ulang bot |

## Jenis kabar dan rute bawaannya

| Jenis | Kapan | Bawaan |
|---|---|---|
| Lead baru | data pelanggan lengkap | staf |
| Pelanggan butuh staf | bot tidak bisa menjawab, pelanggan minta orang, kirim suara/dokumen, foto yang gagal dianalisis | staf |
| WhatsApp terputus | sesi dicabut dari HP / direbut sesi lain | pemilik |
| Kiriman dijeda | pengaman nomor menahan kiriman | pemilik |
| LLM bermasalah | tiga panggilan beruntun gagal, atau jatah harian habis | pemilik |
| Bot berhenti | proses bot mati (dikabarkan pengawas) | pemilik |

Tiap jenis bisa diarahkan ke **pemilik**, **staf**, **keduanya**, atau **tidak dikirim**.

Selama daftar penerima di dashboard masih kosong, bot memakai yang ada di `.env`
(`SALES_NUMBER`, `TELEGRAM_CHAT_ID`, `ALERT_EMAIL_TO`) untuk semua jenis kabar.

## WhatsApp

Tidak ada yang perlu disiapkan. Isi nomornya di tabel penerima (`0812…`). Tulis `self` untuk
nomor bot sendiri (kabarnya muncul di chat "pesan ke diri sendiri"; hanya di jalur Baileys).

Dua batasan:

- Kabar soal WhatsApp-nya sendiri (terputus, dijeda) dan "bot berhenti" **tidak bisa** lewat
  WhatsApp. Pemilik sebaiknya juga punya Telegram atau email.
- Pesan yang dikirim nomor penerima ke bot tidak dianggap pesan pelanggan. Jangan daftarkan
  nomor yang dipakai untuk mencoba bot sebagai pelanggan.

## Telegram

1. Di Telegram buka **@BotFather**, kirim `/newbot`, ikuti langkahnya. Hasilnya **token**
   seperti `123456:ABC-DEF…`.
2. Di `.env` mesin bot: `TELEGRAM_BOT_TOKEN=<token itu>`. Nyalakan ulang bot.
3. Tiap penerima membuka bot baru itu di Telegram dan menekan **Start**. Bot Telegram tidak
   bisa mengirimi orang yang belum pernah memulainya.
4. **Id chat** tiap penerima: buka **@userinfobot**, tekan Start, catat angka "Id". Isi di
   kolom Telegram pada tabel penerima. Untuk grup: tambahkan bot ke grup; id grup berupa
   angka negatif (mis. `-1001234567890`).

## Email

Dikirim lewat SMTP. Contoh dengan Gmail:

1. Pilih satu akun Gmail sebagai pengirim. Nyalakan **Verifikasi 2 Langkah**
   (myaccount.google.com → Keamanan).
2. Buka **myaccount.google.com/apppasswords**, buat "sandi aplikasi". Hasilnya 16 huruf.
   Ini bukan sandi Gmail biasa, dan bisa dicabut kapan saja tanpa mengganti sandi akun.
3. Di `.env` mesin bot:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=alamat-pengirim@gmail.com
   SMTP_PASS=abcdabcdabcdabcd
   ```

   Nyalakan ulang bot.
4. Isi alamat email tiap penerima di tabel penerima.

Penyedia lain sama saja: ganti host, port (465 = SSL; 587 = STARTTLS), pengguna, dan sandinya.

## Memeriksa

- Dashboard → Pengaturan → Notifikasi: baris di bawah tabel menulis jalur mana yang **siap**
  menurut bot (kredensialnya terisi). Itu belum berarti kirimannya sampai.
- Dashboard → **Peringatan & log**: kiriman yang gagal muncul sebagai `[notifikasi] … gagal`
  di catatan galat, lengkap dengan alasannya (mis. sandi salah, id chat tidak dikenal).
- Cara termudah mengetes: tanyakan ke bot sesuatu yang tidak ada di datanya dari nomor
  pelanggan uji — kabar "pelanggan butuh staf" seharusnya sampai ke semua jalur staf.
