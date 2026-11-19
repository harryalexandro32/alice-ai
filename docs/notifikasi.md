# Notifikasi untuk pemilik dan staf

Bot mengabari orang lewat WhatsApp saat ada yang butuh manusia. Semuanya diatur di dashboard →
**Pengaturan → Notifikasi**: siapa yang dikabari (nama, peran pemilik atau staf, nomor WhatsApp)
dan jenis kabar mana ke siapa. Perubahan berlaku tanpa menyalakan ulang bot.

## Jenis kabar dan rute bawaannya

| Jenis | Kapan | Bawaan |
|---|---|---|
| Lead baru | data pelanggan lengkap | staf |
| Pelanggan butuh staf | bot tidak bisa menjawab, pelanggan minta orang, kirim suara/dokumen, foto yang gagal dianalisis | staf |
| LLM bermasalah | tiga panggilan beruntun gagal, atau jatah harian habis | pemilik |

Tiap jenis bisa diarahkan ke **pemilik**, **staf**, **keduanya**, atau **tidak dikirim**. Kalau
tidak ada penerima dengan peran itu, semua penerima mendapatkannya, supaya kabarnya tidak hilang
(mis. satu-satunya penerima adalah staf).

Kabar yang **tidak bisa** lewat WhatsApp hanya tampil di dashboard (Beranda dan Pengaturan →
Lanjutan → Riwayat warning):

| Jenis | Kapan |
|---|---|
| WhatsApp terputus | sesi dicabut dari HP / direbut sesi lain |
| Kiriman dijeda | pengaman nomor atau antiban menahan kiriman |
| Balasan dari dashboard gagal terkirim | balasan yang diketik di halaman percakapan gagal terkirim 5 kali |
| Bot berhenti | proses bot mati (dicatat pengawas) |

## Nomor penerima

Isi nomornya di tabel penerima (`0812…`). Tulis `self` untuk nomor bot sendiri (kabarnya muncul di
chat "pesan ke diri sendiri"; hanya di jalur Baileys, karena Cloud API tidak bisa mengirimi dirinya
sendiri).

Pesan yang dikirim nomor penerima ke bot tidak dianggap pesan pelanggan. Jangan daftarkan nomor
yang dipakai untuk mencoba bot sebagai pelanggan.

Proyek lama yang masih punya **nomor sales** (kartu Proyek, sudah dihapus dari dashboard): selama
daftar penerima kosong, nomor itu tampil di tabel penerima sebagai staf "Sales", dan tersimpan
begitu daftarnya disimpan.

## Memeriksa

- **Kirim tes** (di bawah tabel penerima): bot mengirim pesan tes dari nomornya ke tiap penerima
  yang sudah disimpan. Isinya menyebut kabar apa saja yang akan diterima nomor itu. Di sebelah
  tombolnya tampil "Terkirim ke N dari M nomor"; selama WhatsApp bot belum tersambung, pesannya
  menunggu.
- Saat bot start, log-nya menulis `[bot] kabar lead lewat WA ke: …`.
- Dashboard → Pengaturan → **Lanjutan** → **Catatan error**: kiriman yang gagal muncul dengan
  alasannya.
- Cara termudah mengetes: tanyakan ke bot sesuatu yang tidak ada di datanya dari nomor pelanggan
  uji. Kabar "pelanggan butuh staf" seharusnya sampai ke semua nomor staf.
