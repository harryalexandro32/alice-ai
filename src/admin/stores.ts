/**
 * Tempat dashboard membaca dan menyimpan. Dua wujud, satu bentuk:
 *
 *   - lokal: folder data/ dan database milik bot (dashboard satu mesin dengan bot);
 *   - blob : Vercel Blob (dashboard di-hosting terpisah). Lihat src/remote.ts.
 *
 * Berkas ini sengaja tidak mengimpor database: fungsi di Vercel tidak punya
 * (dan tidak butuh) SQLite. Penyimpanan lokal ada di store-local.ts.
 */

import { applyOverrides } from '../business';
import type { Editable } from '../business/types';
import { blob, getJson, remotePath } from '../remote';

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
  channels?: { email: boolean; telegram: boolean };
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

/** Yang dikirim bot ke penyimpanan bersama untuk ditampilkan dashboard. */
export interface Snapshot {
  at: number;
  status: Omit<BotStatus, 'reportedAt'>;
  leads: LeadRow[];
  usage?: UsageReport;
  alerts?: AlertItem[];
  errors?: ErrorItem[];
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

export function blobStore(): AdminStore {
  let current: Partial<Editable> = {};
  const snapshot = () => getJson<Snapshot>(remotePath.snapshot());

  return {
    async refresh() {
      current = (await getJson<Partial<Editable>>(remotePath.profile())) ?? {};
      applyOverrides(current);
    },
    async save(changes) {
      // Baca ulang dulu: fungsi lain mungkin baru saja menyimpan hal lain.
      current = { ...((await getJson<Partial<Editable>>(remotePath.profile())) ?? {}), ...changes };
      await blob().put(remotePath.profile(), JSON.stringify(current, null, 2), 'application/json');
      applyOverrides(current);
    },
    putPhoto: (file, data, contentType) => blob().put(remotePath.media(file), data, contentType),
    getPhoto: (file) => blob().getBytes(remotePath.media(file)),
    delPhoto: (file) => blob().del(remotePath.media(file)),
    async leads() {
      return (await snapshot())?.leads ?? [];
    },
    async status() {
      const s = await snapshot();
      return s ? { ...s.status, reportedAt: s.at } : null;
    },
    async usage() {
      return (await snapshot())?.usage ?? null;
    },
    async alerts() {
      return (await snapshot())?.alerts ?? [];
    },
    async errors() {
      return (await snapshot())?.errors ?? [];
    },
  };
}
