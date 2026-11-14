# Menjalankan bot tanpa dijaga

Bot melayani satu proyek per proses. Di PC lokal, isi `PROJECT=gfan` (id proyeknya) dan
`DATABASE_URL` di `.env`; dashboard dijalankan terpisah dengan `npm run admin`.

`npm start` menjalankan bot lewat **pengawas** (`src/supervise.ts`):

- bot dinyalakan lagi kalau mati (5 detik, lalu makin lama, paling lama 5 menit);
- semua keluarannya disimpan ke `logs/bot-TANGGAL.log` (14 hari terakhir);
- pemilik dikabari lewat Telegram/email kalau bot mati (lihat `docs/notifikasi.md`).

Yang tidak dilakukan pengawas: menyalakan dirinya sendiri setelah komputer menyala ulang. Itu
bagian di bawah ini.

**Satu nomor = satu bot.** Jangan pernah menjalankan dua bot untuk proyek yang sama: keduanya akan
saling merebut sesi WhatsApp (kode 440) dan bot berhenti.

## Windows: menyala otomatis saat masuk

```
powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1
```

Skrip itu membuat satu tugas "Alice AI Bot" di Task Scheduler milik akun Anda (tanpa hak
administrator) yang menjalankan `npm start` setiap kali Anda masuk ke Windows.

- Lepas: tambahkan `-Remove` di ujung perintah yang sama.
- Periksa: `Get-ScheduledTask -TaskName "Alice AI Bot"`.
- Supaya bot jalan terus: matikan mode tidur (Settings → System → Power → Sleep: Never), dan
  kalau perlu atur Windows supaya masuk otomatis setelah menyala ulang.
- Selama tugas ini terpasang, jangan menjalankan `npm start` kedua secara manual.

## Linux (server): systemd

Untuk server produksi, pakai skrip dan berkas siap pakai di `deploy/` — lihat
[deploy.md](deploy.md). Intinya:

- `alice-bot@.service` adalah templat: `alice-bot@gfan` menjalankan `PROJECT=gfan npm run bot`.
  systemd sendiri yang menjadi pengawasnya (nyala lagi kalau mati, log di journald), jadi yang
  dijalankan `npm run bot`, bukan `npm start`.
- `alice-admin.service` menjalankan dashboard untuk semua proyek (`npm run admin`).
- `alice-reconcile.timer` menyalakan dan mematikan `alice-bot@<proyek>` menurut tabel `projects`.

```
sudo systemctl enable --now alice-admin alice-reconcile.timer
journalctl -u alice-bot@gfan -f
```

## Melihat apa yang terjadi

- Dashboard → **Peringatan & log**: peringatan dan catatan galat, tanpa perlu akses ke mesin bot.
- `logs/bot-TANGGAL.log` (lewat `npm start`) atau `journalctl -u alice-bot@<proyek>` (server):
  semuanya, baris demi baris, dengan jam.
- Dashboard → Pengaturan → **WhatsApp** dan **Keadaan bot**: laporan terakhir bot (dikirim tiap 30
  detik), termasuk keadaan WhatsApp dan pemakaian jatah LLM hari itu.

Memulihkan dari cadangan: lihat [deploy.md](deploy.md#cadangan-dan-memulihkan).
