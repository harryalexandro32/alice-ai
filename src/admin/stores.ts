/**
 * Bentuk tempat dashboard membaca dan menyimpan, untuk proyek permintaan yang
 * sedang dilayani. Wujudnya ada di store-local.ts: database bersama dan folder
 * data/<proyek>/media/, di mesin yang sama dengan bot.
 *
 * Dashboard online (Vercel) tidak punya penyimpanan sendiri: ia hanya
 * meneruskan permintaan ke server bot (lihat vercel.json dan docs/deploy.md).
 */

import type { Editable } from '../business/types';

export interface LeadRow {
  phone: string;
  lead: Record<string, string>;
  needsSales: boolean;
  complete: boolean;
  lastAt: number;
  lastDir: string;
  /** Ringkasan percakapan sejauh ini (ditulis LLM). */
  summary?: string;
  /** Kenapa bot diam di chat ini (lihat flow.holdReason); null/kosong = bot aktif. */
  hold?: 'berhenti' | 'tombol' | 'admin' | 'tenang' | null;
  /** Tahap pipeline: baru | menunggu | dihubungi | link | payment | dikirim | selesai | batal. */
  stage: string;
  /** Catatan staf ('' = belum ada). */
  note: string;
  /** Nama profil WhatsApp-nya, apa adanya. */
  waName?: string;
}

export interface ErrorItem {
  at: number;
  level: string;
  text: string;
}

export interface AlertItem {
  at: number;
  kind: string;
  text: string;
}

export interface BotStatus {
  transport: string;
  llm: string | null;
  usage: { calls: number; limit: number };
  sales: string | null;
  onlyNumbers: number;
  /** Keadaan pengaman nomor (jalur Baileys), satu baris. */
  guard?: string;
  /** Pengaturan yang sedang berlaku di bot (.env + yang diubah di dashboard). */
  effective?: Record<string, number | boolean | string[]>;
  /** Jalur notifikasi yang kredensialnya sudah diisi di .env bot. */
  channels?: { stt?: boolean };
  /** Keadaan WhatsApp menurut laporan terakhir bot (connected, qr, …). */
  wa?: string;
  /** Kapan bot terakhir melapor (ms). Null = bot belum pernah melapor. */
  reportedAt: number | null;
}

/**
 * Cek resi per hari + keadaan akun Binderbyte. Biaya = (otomatis + manual) ×
 * tarif: batas atas, karena kuota gratis berlaku untuk seluruh akun (semua
 * proyek), jadi ditampilkan terpisah, tidak dikurangkan.
 */
export interface ResiUsage {
  /** BINDERBYTE_API_KEY diisi. */
  enabled: boolean;
  /** Rp per cek sesudah kuota gratis: dari akun, atau TRACK_PRICE_IDR kalau akun belum terbaca. */
  price: number;
  /** TRACK_DAILY_MAX: batas cek otomatis per hari. */
  dailyMax: number;
  /** 90 hari, terbaru dulu. */
  days: { day: string; auto: number; manual: number }[];
  /** Null = akun belum terbaca. `freeLeft` = sisa kuota gratis (0 = habis). */
  account: { used: number; limit: number; freeLeft: number; balance: number; at: number } | null;
  /** Pesan error pembacaan akun yang terakhir; null kalau berhasil. */
  accountError: string | null;
}

/** Pemakaian LLM per hari + tarif yang dipakai menghitung biayanya, dan pemakaian cek resi. */
export interface UsageReport {
  model: string;
  /** USD per 1 juta token. */
  price: { in: number; cached: number; out: number };
  usdIdr: number;
  /** Terbaru dulu. `promptTokens` sudah termasuk `cachedTokens`. */
  days: { day: string; calls: number; promptTokens: number; cachedTokens: number; completionTokens: number }[];
  resi: ResiUsage;
}

export interface AdminStore {
  save(changes: Partial<Editable>): Promise<void>;
  putPhoto(file: string, data: Buffer, contentType: string): Promise<void>;
  getPhoto(file: string): Promise<Buffer | null>;
  delPhoto(file: string): Promise<void>;
  leads(): Promise<LeadRow[]>;
  status(): Promise<BotStatus | null>;
  /**
   * `waitAccount`: tunggu pembacaan pertama akun Binderbyte kalau belum ada
   * (hanya /usage). Tanpa itu (/state) jaringan tidak ditunggu.
   */
  usage(opts?: { waitAccount?: boolean }): Promise<UsageReport | null>;
  alerts(): Promise<AlertItem[]>;
  /** Catatan error bot, terbaru dulu. */
  errors(): Promise<ErrorItem[]>;
}
