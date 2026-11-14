/**
 * Bentuk tempat dashboard membaca dan menyimpan. Wujudnya ada di
 * store-local.ts: folder data/ dan database milik bot, di mesin yang sama.
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
  /** Kenapa bot diam di chat ini; null/kosong = bot aktif. */
  hold?: 'tombol' | 'admin' | null;
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
  sheet: boolean;
  onlyNumbers: number;
  /** Keadaan pengaman nomor (jalur Baileys), satu baris. */
  guard?: string;
  /** Pengaturan yang sedang berlaku di bot (.env + yang diubah di dashboard). */
  effective?: Record<string, number | boolean | string[]>;
  /** Jalur notifikasi yang kredensialnya sudah diisi di .env bot. */
  channels?: { email: boolean; telegram: boolean; stt?: boolean };
  /** Kapan bot terakhir melapor (ms). Null = dashboard satu proses dengan bot. */
  reportedAt: number | null;
}

/** Pemakaian LLM per hari + tarif yang dipakai menghitung biayanya. */
export interface UsageReport {
  model: string;
  /** USD per 1 juta token. */
  price: { in: number; cached: number; out: number };
  usdIdr: number;
  /** Terbaru dulu. `promptTokens` sudah termasuk `cachedTokens`. */
  days: { day: string; calls: number; promptTokens: number; cachedTokens: number; completionTokens: number }[];
}

export interface AdminStore {
  /** Muat profil terbaru ke `biz` sebelum melayani permintaan. */
  refresh(): Promise<void>;
  save(changes: Partial<Editable>): Promise<void>;
  putPhoto(file: string, data: Buffer, contentType: string): Promise<void>;
  getPhoto(file: string): Promise<Buffer | null>;
  delPhoto(file: string): Promise<void>;
  leads(): Promise<LeadRow[]>;
  status(): Promise<BotStatus | null>;
  /** Null = bot belum pernah melapor. */
  usage(): Promise<UsageReport | null>;
  alerts(): Promise<AlertItem[]>;
  /** Catatan galat bot, terbaru dulu. */
  errors(): Promise<ErrorItem[]>;
}
