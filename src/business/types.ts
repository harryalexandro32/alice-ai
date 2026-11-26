/**
 * Profil bisnis: SEMUA yang khas satu klien ada di sini, dan hanya di sini.
 *
 * Mesinnya (alur, follow-up, antrean lead, transport) tidak menyebut nama
 * klien, produk, maupun data apa yang dikumpulkan.
 *
 * Profil punya dua lapis:
 *   - bibit di kode (src/business/<id>/profile.ts) — nilai awal;
 *   - perubahan pemilik lewat dashboard, disimpan di database (tabel
 *     profiles, satu baris per proyek), yang menimpa bibit untuk kunci-kunci
 *     di EDITABLE.
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

/** Berkas yang diunggah lewat dashboard: foto (id "f…") atau PDF (id "d…"). */
export interface MediaFile {
  id: string;
  /** Nama file di data/<id>/media/, mis. "f1a2b3c4d.jpg" atau "d1a2b3c4d.pdf". */
  file: string;
  /** Nama asli berkasnya, untuk ditampilkan. */
  name: string;
  /** Hanya PDF: true = isi PDF ini ikut dibaca bot sebagai pengetahuan. */
  read?: boolean;
}

/** Jenis kabar yang bisa dikirim ke pemilik/staf. */
export type NotifyKind = 'lead' | 'butuh-staf' | 'wa-putus' | 'kiriman-dijeda' | 'kiriman-gagal' | 'llm' | 'bot-mati' | 'resi';
/** Ke siapa sebuah jenis kabar dikirim. */
export type Route = 'owner' | 'staff' | 'both' | 'none';

/** Orang yang dikabari bot lewat WhatsApp. */
export interface Recipient {
  name: string;
  role: 'owner' | 'staff';
  /** Nomor WhatsApp "+62…" atau "self" (nomor bot sendiri). */
  phone: string;
}

/** Marketplace tempat produk bisa dibeli; urutannya = urutan kolom dan tautan yang dikirim. */
export const MARKETS = ['tokopedia', 'shopee'] as const;
export type Market = (typeof MARKETS)[number];
export const MARKET_LABELS: Record<Market, string> = { tokopedia: 'Tokopedia', shopee: 'Shopee' };

/** Satu baris daftar produk. Yang rinci cukup ada di PDF-nya. */
export interface Product {
  name: string;
  description: string;
  /** Teks bebas, mis. "Rp 450.000". Kosong = bot tidak tahu, diserahkan ke tim. */
  price: string;
  /** Teks bebas, mis. "ada", "12 unit", "habis". Kosong = bot tidak tahu. */
  stock: string;
  /** Id foto (MediaFile) produk ini. */
  photos: string[];
  /** Id PDF (brosur/spesifikasi) yang bisa dikirim ke pelanggan, atau ''. */
  pdf: string;
  /**
   * Tautan halaman produk ini di tiap marketplace ('' = tidak ada). Bot
   * mengirimnya saat pelanggan ingin membeli, lalu tahap lead jadi "link".
   */
  links: Record<Market, string>;
}

/**
 * Pelajaran dari percakapan nyata, ditulis pemilik lewat "Ajari bot" di
 * Pertanyaan yang belum terjawab: arti pesan seperti ini dan yang harus
 * dilakukan bot. Bot membacanya di tiap balasan.
 */
export interface Lesson {
  /** Kata-kata pemilik, mis. "Kalau pelanggan menyebut jumlah orang, itu jawaban atas pertanyaan kita soal pemakaian ruangan." */
  rule: string;
  /** Contoh nyata asalnya: pesan bot sebelumnya dan pesan pelanggan, atau ''. */
  example: string;
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
  /** Percakapan sebelumnya, terlama dulu (bawaan: pesan pertama). */
  history?: { dir: 'in' | 'out' | 'human'; text: string }[];
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
  /**
   * Pesan pertama kalau nama profil WhatsApp pelanggan tampak seperti nama
   * orang: {nama} diganti nama itu, dan cukup memastikannya — tidak menanyakan
   * nama dari awal. Kosong = selalu pakai `greeting`.
   */
  greetingKnown: string;
  /** Data yang dikumpulkan dari tiap calon pelanggan, berurutan. */
  leadFields: LeadField[];
  /**
   * Daftar produk: nama, keterangan, harga, stok, foto, PDF. Bersama
   * `catalog` dan `notes`, ini satu-satunya sumber jawaban; teks yang
   * dilihat LLM dirakit oleh knowledgeText().
   */
  products: Product[];
  /** Data teknis rinci berbentuk tabel (opsional). */
  catalog: CatalogSection[];
  /** Pengetahuan lain yang tidak berbentuk tabel: FAQ, jam buka, dst. */
  notes: string;
  /** Cara menganalisis kebutuhan pelanggan dan menyarankan produk. */
  advice: string;
  /** Hal yang TIDAK diketahui bot dan harus dioper ke manusia. */
  handoffTopics: string;
  /** Sebutan singkatnya di notifikasi lead, mis. "harga/stok". */
  handoffLabel: string;
  /** True = balasan yang menyebut harga di luar daftar produk dibuang. */
  forbidPrices: boolean;
  /** True = kode produk yang tidak ada di `knowledge` dianggap karangan. */
  guardCodes: boolean;
  /** Ujung kalimat follow-up waktu data sudah lengkap. */
  followupClosing: string;
  /** Berkas unggahan (foto dan PDF) yang dirujuk daftar produk dan logo. */
  files: MediaFile[];
  /** Id foto yang dipakai sebagai logo di dashboard, atau ''. */
  logo: string;
  /** Pertanyaan untuk memahami kebutuhan pelanggan sebelum menyarankan produk. */
  questions: string[];
  /**
   * Aturan gaya dan cara membalas yang ditulis pemilik, satu aturan per baris
   * ("pakai kalimat positif", "jangan basa-basi", contoh kalimat yang disukai).
   */
  styleRules: string[];
  /** Pelajaran dari percakapan nyata (lihat Lesson). */
  lessons: Lesson[];
  /**
   * True = begitu admin manusia membalas atau mengirimi seorang pelanggan dari
   * HP, bot tidak ikut campur lagi di chat itu (tanpa batas waktu). False =
   * bot hanya diam selama HUMAN_PAUSE_HOURS, lalu aktif lagi.
   */
  stopAfterHuman: boolean;
  /** Pemilik dan staf yang dikabari bot. */
  recipients: Recipient[];
  /** Jenis kabar -> penerimanya. Yang tidak diisi memakai rute bawaan. */
  notifyRoutes: Partial<Record<NotifyKind, Route>>;
  /** Pengaturan operasional yang menimpa bawaan .env (lihat config.TUNABLE). */
  settings: import('../config').Settings;
  /** Kapan daftar pelanggan lama terakhir diimpor (ms; 0 = belum pernah) dan jumlah pelanggan lamanya. */
  knownAt: number;
  knownCount: number;
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
  'brand', 'persona', 'alias', 'about', 'honorific', 'greeting', 'greetingKnown', 'leadFields', 'products', 'catalog', 'notes', 'questions', 'styleRules',
  'lessons', 'advice', 'handoffTopics', 'handoffLabel', 'forbidPrices', 'guardCodes', 'followupClosing',
  'files', 'logo', 'stopAfterHuman', 'knownAt', 'knownCount', 'recipients', 'notifyRoutes', 'settings', 'replyDelayMin', 'replyDelayMax',
] as const satisfies readonly (keyof Business)[];

export type Editable = Pick<Business, (typeof EDITABLE)[number]>;
