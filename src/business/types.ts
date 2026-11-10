/**
 * Profil bisnis: SEMUA yang khas satu klien ada di sini, dan hanya di sini.
 *
 * Mesinnya (alur, follow-up, antrean lead, transport) tidak menyebut nama
 * klien, produk, maupun data apa yang dikumpulkan. Klien baru = satu folder
 * baru di src/business/ + satu baris di index.ts. Kalau untuk klien baru harus
 * mengubah file di luar folder ini, itu tanda ada yang bocor ke mesin.
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
  /** Satu-dua kalimat: bisnis ini apa dan menjual apa. */
  about: string;
  /** Sapaan ke pelanggan: "Bapak/Ibu", "Kak", … */
  honorific: string;
  /** Pesan pertama. Harus sudah meminta semua leadFields. */
  greeting: string;
  /** Data yang dikumpulkan dari tiap calon pelanggan, berurutan. */
  leadFields: LeadField[];
  /** Satu-satunya sumber jawaban: katalog, FAQ, jam buka, dst. */
  knowledge: string;
  /** Hal yang TIDAK diketahui bot dan harus dioper ke manusia. */
  handoffTopics: string;
  /** Sebutan singkatnya di notifikasi lead, mis. "harga/stok". */
  handoffLabel: string;
  /** True = balasan yang menyebut nominal rupiah dibuang. */
  forbidPrices: boolean;
  /** Aturan tambahan khas bisnis ini untuk prompt. */
  extraRules?: string[];
  /**
   * Pagar khas bisnis atas balasan LLM. `asked` = teks yang diketik pelanggan
   * belakangan ini. Kembalikan alasan penolakan, atau null kalau boleh.
   */
  checkReply?(reply: string, asked: string): string | null;
  /** Ujung kalimat follow-up waktu data sudah lengkap. */
  followupClosing: string;
  /** Pertanyaan untuk `npm run eval`. */
  evalCases: EvalCase[];
}
