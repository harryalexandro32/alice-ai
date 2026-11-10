# GFAN WA Bot

Asisten penjualan WhatsApp untuk GFAN Indonesia:

1. **Salam** untuk chat pertama.
2. **Menanyakan nama, kota/alamat, kebutuhan** — lalu mengirim lead ke nomor WA sales dan Google Sheet.
3. **Follow-up** kalau pelanggan diam (bawaan: jam ke-23, sekali, hanya jam 08–20).
4. **Tanya-jawab katalog** lewat LLM (bawaan DeepSeek), dari 6 lembar katalog di `catalog-pdf/`.

Bot tidak tahu harga. Pertanyaan harga/stok/garansi dioper ke sales.
Kalau pemilik membalas sendiri dari HP, bot diam untuk kontak itu selama `HUMAN_PAUSE_HOURS`.

## Coba tanpa WhatsApp

```bash
npm install
npm run chat
```

Tanpa `LLM_API_KEY`, salam / data lead / follow-up tetap jalan; tanya-jawab katalog dioper ke sales.
Isi `LLM_API_KEY` di `.env` untuk mencoba tanya-jawab. Di dalam mode latihan:
`/maju 23j` (majukan jam + jalankan follow-up), `/manusia <teks>`, `/lead`, `/nomor 62812…`.

## Perintah

```bash
npm test          # katalog + penyedia LLM (server tiruan) + 19 alur
npm run typecheck
npm run eval      # ukur jawaban katalog ke LLM sungguhan (butuh key)
npm start         # nyambung ke WhatsApp (Baileys) — scan QR / kode pairing
```

## Susunan

```
src/
  catalog/gfan.ts       katalog, ditranskripsi tangan dari PDF
  brain.ts              prompt + pagar balasan (tanpa Rp, tanpa model karangan)
  flow.ts               pesan masuk -> balasan; salam, data lead, serah-terima
  followup.ts           jadwal & pengiriman follow-up
  sinks/                antrean lead -> WA sales + Google Sheet (dicoba ulang)
  transport/baileys.ts  tahap 1
  app.ts                gabung pesan beruntun, urutan per nomor, putaran 5 menit
  texts.ts              semua kalimat tetap bot
```

## Google Sheet

Buat tab `Leads` dengan judul kolom: Waktu, Jenis, Nomor, Nama, Kota/alamat, Kebutuhan, Tanya harga, Pesan terakhir.
Simpan kunci akun layanan sebagai `google-service-account.json` dan bagikan Sheet-nya (Editor) ke email akun itu.

## Tahap 2: Cloud API + Coexistence

Tambah `src/transport/cloud.ts` yang memenuhi `transport/types.ts` (webhook + Graph API, echo
`smb_message_echoes` -> `onHumanReply`). Set `FOLLOWUP_MAX_HOURS=24`. Notifikasi ke nomor sales di
luar jendela 24 jam butuh template utility yang disetujui Meta.
