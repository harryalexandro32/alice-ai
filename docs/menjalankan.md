# Menjalankan bot tanpa dijaga

`npm start` menjalankan bot lewat **pengawas** (`src/supervise.ts`):

- bot dinyalakan lagi kalau mati (5 detik, lalu makin lama, paling lama 5 menit);
- semua keluarannya disimpan ke `logs/bot-TANGGAL.log` (14 hari terakhir);
- pemilik dikabari lewat Telegram/email kalau bot mati (lihat `docs/notifikasi.md`).

Yang tidak dilakukan pengawas: menyalakan dirinya sendiri setelah komputer menyala ulang. Itu
bagian di bawah ini.

**Satu nomor = satu bot.** Jangan pernah menjalankan dua `npm start` untuk nomor yang sama: keduanya
akan saling merebut sesi WhatsApp (kode 440) dan bot berhenti.

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
[deploy.md](deploy.md). Intinya sama dengan di bawah ini.

Simpan sebagai `/etc/systemd/system/alice-ai.service`, sesuaikan pengguna dan foldernya:

```ini
[Unit]
Description=Alice AI - bot WhatsApp
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=alice
WorkingDirectory=/opt/alice-ai
ExecStart=/usr/bin/npm run bot
Restart=always
RestartSec=5
# Log ada di journald: journalctl -u alice-ai -f

[Install]
WantedBy=multi-user.target
```

Di sini systemd sendiri yang menjadi pengawasnya, jadi yang dijalankan `npm run bot` (bot tanpa
pengawas bawaan). Lalu:

```
sudo systemctl daemon-reload
sudo systemctl enable --now alice-ai
```

## Melihat apa yang terjadi

- Dashboard → **Peringatan & log**: peringatan dan catatan galat, tanpa perlu akses ke mesin bot.
- `logs/bot-TANGGAL.log` di mesin bot: semuanya, baris demi baris, dengan jam.
- Dashboard → Pengaturan → **Keadaan bot**: laporan terakhir bot, termasuk pemakaian jatah
  penyimpanan dashboard hari itu.
