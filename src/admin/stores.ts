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
}

export interface BotStatus {
  transport: string;
  llm: string | null;
  usage: { calls: number; limit: number };
  sales: string | null;
  sheet: boolean;
  onlyNumbers: number;
  /** Kapan bot terakhir melapor (ms). Null = dashboard satu proses dengan bot. */
  reportedAt: number | null;
}

/** Yang dikirim bot ke penyimpanan bersama untuk ditampilkan dashboard. */
export interface Snapshot {
  at: number;
  status: Omit<BotStatus, 'reportedAt'>;
  leads: LeadRow[];
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
  };
}
