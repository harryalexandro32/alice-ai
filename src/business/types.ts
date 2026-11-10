/**
 * Profil bisnis: SEMUA yang khas satu klien ada di sini, dan hanya di sini.
 *
 * Mesinnya (alur, follow-up, antrean lead, transport) tidak menyebut nama
 * klien, produk, maupun data apa yang dikumpulkan.
 *
 * Profil punya dua lapis:
 *   - bibit di kode (src/business/<id>/profile.ts) — nilai awal;
 *   - perubahan pemilik lewat dashboard, disimpan di data/<id>/profile.json,
 *     yang menimpa bibit untuk kunci-kunci di EDITABLE.
 */

export interface LeadField {
  /** Kunci di database dan di keluaran LLM, mis. "name". */
  key: string;
  /** Sebutan ke pelanggan dan judul di notifikasi, mis. "kota/alamat". */
  label: string;
  /** Petunjuk buat LLM: apa yang dihitung sebagai nilai field ini. */
  hint: string;
  /** Field ini nama orangnya — dipakai untuk menyapa di follow-up. */
  isName?: boolean;
}

export interface Photo {
  id: string;
  /** Nama file di data/<id>/media/. */
  file: string;
  /** Apa isi fotonya; ini yang dibaca LLM untuk memilih. */
  label: string;
  /** Kata kunci / kode produk terkait. */
  tags: string;
}

/** Satu tabel produk: baris = produk, kolom pertama = kode/modelnya. */
export interface CatalogTable {
  title: string;
  columns: string[];
  rows: string[][];
}

/** Satu kelompok produk (seri): keterangan umum + satu atau lebih tabel. */
export interface CatalogSection {
  name: string;
  /** Keterangan umum seri ini, satu kalimat per baris. */
  facts: string[];
  tables: CatalogTable[];
}

export type Intent = 'info' | 'handoff' | 'human' | 'other';

export interface EvalCase {
  q: string;
  /** Semua pola ini harus muncul di balasan. */
  has?: RegExp[];
  intent?: Intent;
  fields?: Record<string, RegExp>;
}

export interface Business {
  id: string;
  brand: string;
  /** Peran yang dibawakan saat membalas, mis. "admin penjualan GFAN Indonesia". */
  persona: string;
  /** Nama panggilan admin, mis. "Rina". Kosong = tanpa nama. */
  alias: string;
  /** Satu-dua kalimat: bisnis ini apa dan menjual apa. */
  about: string;
  /** Sapaan ke pelanggan: "Bapak/Ibu", "Kak", … */
  honorific: string;
  /** Pesan pertama. Harus sudah meminta semua leadFields. */
  greeting: string;
  /** Data yang dikumpulkan dari tiap calon pelanggan, berurutan. */
  leadFields: LeadField[];
  /**
   * Data produk dalam bentuk tabel. Bersama `notes`, ini satu-satunya sumber
   * jawaban; teks yang dilihat LLM dirakit oleh knowledgeText().
   */
  catalog: CatalogSection[];
  /** Pengetahuan lain yang tidak berbentuk tabel: FAQ, jam buka, dst. */
  notes: string;
  /** Cara menganalisis kebutuhan pelanggan dan menyarankan produk. */
  advice: string;
  /** Hal yang TIDAK diketahui bot dan harus dioper ke manusia. */
  handoffTopics: string;
  /** Sebutan singkatnya di notifikasi lead, mis. "harga/stok". */
  handoffLabel: string;
  /** True = balasan yang menyebut nominal rupiah dibuang. */
  forbidPrices: boolean;
  /** True = kode produk yang tidak ada di `knowledge` dianggap karangan. */
  guardCodes: boolean;
  /** Ujung kalimat follow-up waktu data sudah lengkap. */
  followupClosing: string;
  /** Foto yang boleh dikirim bot. */
  photos: Photo[];
  /** Jeda sebelum membalas, detik. Diacak di antara keduanya tiap balasan. */
  replyDelayMin: number;
  replyDelayMax: number;

  // --- hanya di kode ---
  /** Aturan tambahan khas bisnis ini untuk prompt. */
  extraRules?: string[];
  /** Pagar tambahan atas balasan LLM; alasan penolakan atau null. */
  checkReply?(reply: string, asked: string): string | null;
  /** Pertanyaan untuk `npm run eval`. */
  evalCases: EvalCase[];
}

/** Kunci yang boleh diubah pemilik lewat dashboard. */
export const EDITABLE = [
  'brand', 'persona', 'alias', 'about', 'honorific', 'greeting', 'leadFields', 'catalog', 'notes',
  'advice', 'handoffTopics', 'handoffLabel', 'forbidPrices', 'guardCodes', 'followupClosing',
  'photos', 'replyDelayMin', 'replyDelayMax',
] as const satisfies readonly (keyof Business)[];

export type Editable = Pick<Business, (typeof EDITABLE)[number]>;
