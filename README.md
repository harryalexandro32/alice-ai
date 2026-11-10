# WA Sales Bot (profil pertama: GFAN Indonesia)

Mesin asisten penjualan WhatsApp yang bisa dipakai ulang untuk bisnis apa pun:

1. **Salam** untuk chat pertama.
2. **Mengumpulkan data lead** (field-nya ditentukan profil bisnis), lalu mengirimnya ke nomor WA
   sales dan Google Sheet.
3. **Follow-up** kalau pelanggan diam (bawaan: jam ke-23, sekali, hanya jam 08–20).
4. **Tanya-jawab** lewat LLM (bawaan DeepSeek) dari pengetahuan milik bisnis itu saja.

Hal yang tidak diketahui bot (mis. harga) dioper ke manusia. Kalau pemilik membalas sendiri dari
aplikasi WhatsApp, bot diam untuk kontak itu selama `HUMAN_PAUSE_HOURS`.

## Coba tanpa WhatsApp

```bash
npm install
npm run chat
```

Di dalam mode latihan: `/maju 23j` (majukan jam + jalankan follow-up), `/manusia <teks>`, `/lead`,
`/nomor 62812…`. Tanpa `LLM_API_KEY` di `.env`, pertanyaan dioper ke manusia.

## Perintah

```bash
npm test          # katalog, penyedia LLM, jalur Cloud API, dashboard, dan 23 alur
npm run typecheck
npm run eval      # ukur jawaban ke LLM sungguhan (butuh key)
npm start         # nyambung ke WhatsApp sesuai TRANSPORT
```

## Dashboard pemilik

Isi `ADMIN_PASSWORD` di `.env` (minimal 8 karakter). Lalu:

```bash
npm start        # bot + dashboard
npm run admin    # dashboard saja, tanpa WhatsApp
```

Buka `http://localhost:3100/admin`. Dari sana pemilik mengubah identitas dan nama admin, salam,
data yang dikumpulkan, data produk, panduan rekomendasi, foto, dan jeda balasan, lalu mencobanya di
tab **Uji coba**. **Simpan & terapkan** berlaku pada pesan berikutnya tanpa menyalakan ulang bot —
tidak ada model yang dilatih; yang berubah adalah data profil di `data/<id>/profile.json`.

Hanya yang diubah yang disimpan; sisanya tetap mengikuti bawaan di `src/business/<id>/profile.ts`.
Dashboard bawaannya hanya bisa dibuka dari komputer itu sendiri (`ADMIN_HOST`).

## Jalur WhatsApp

| `TRANSPORT` | Apa | Kapan |
|---|---|---|
| `baileys` | Perangkat tertaut (tidak resmi). Scan QR / kode pairing. | Demo, nomor tes |
| `cloud` | WhatsApp Cloud API resmi + webhook, mendukung Coexistence | Produksi — [docs/cloud-api-setup.md](docs/cloud-api-setup.md) |

## Menambah bisnis baru

Mesin tidak menyebut nama klien, produk, maupun field lead. Semua itu ada di satu folder.

1. Salin `src/business/gfan/` jadi `src/business/<id>/`.
2. Isi `profile.ts` (lihat `src/business/types.ts`):
   - `brand`, `about`, `honorific`, `greeting`
   - `leadFields` — data apa yang dikumpulkan (bebas: tanggal acara, jumlah orang, …)
   - `knowledge` — satu-satunya sumber jawaban (katalog, FAQ, jam buka)
   - `handoffTopics` — yang harus dijawab manusia; `forbidPrices` kalau bot tidak boleh sebut harga
   - `checkReply` — pagar khas bisnis (opsional), `evalCases` — pertanyaan uji
3. Daftarkan di `src/business/index.ts`.
4. Jalankan sebagai proses sendiri dengan `.env` sendiri: `BUSINESS=<id>`, nomor WA sendiri,
   Sheet sendiri. Database otomatis terpisah (`data/<id>.db`).
5. `npm run eval` sampai jawabannya benar, baru sambungkan ke WhatsApp.

Judul kolom Sheet: Waktu, Jenis, Nomor, lalu satu kolom per `leadFields`, Perlu sales, Pesan terakhir.
Simpan kunci akun layanan sebagai `google-service-account.json` dan bagikan Sheet-nya (Editor) ke
email akun itu.

## Susunan

```
src/
  business/types.ts     bentuk profil bisnis
  business/gfan/        profil + katalog GFAN (ditranskripsi tangan dari catalog-pdf/)
  brain.ts              prompt dirakit dari profil + pagar balasan
  flow.ts               pesan masuk -> balasan; salam, data lead, serah-terima
  followup.ts           jadwal & pengiriman follow-up
  sinks/                antrean lead -> WA sales + Google Sheet (dicoba ulang)
  transport/            baileys.ts, cloud.ts — keduanya memenuhi types.ts
  app.ts                gabung pesan beruntun, urutan per nomor, putaran 5 menit
```
