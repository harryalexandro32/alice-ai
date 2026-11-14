/**
 * Proyek yang sedang dilayani. Satu proyek = satu bisnis = satu nomor WhatsApp.
 *
 * Proses bot melayani SATU proyek (env PROJECT): ia memasang proyeknya sebagai
 * bawaan dengan setDefaultProject. Dashboard melayani SEMUA proyek: tiap
 * permintaan dijalankan di dalam withProject, jadi `biz`, `cfg`, dan
 * penyimpanan otomatis memakai proyek permintaan itu tanpa perlu diberi tahu.
 *
 * Bawaan juga menjadi cadangan untuk callback yang kehilangan konteks async
 * (event Baileys, setInterval) di proses bot.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { Business } from './business/types';
import type { Project } from './db/schema';

export interface ProjectCtx {
  id: string;
  row: Project;
  /** Profil yang berlaku: bibit + perubahan pemilik. */
  biz: Business;
  /** Bibit profil di kode (template proyek ini). */
  seed: Business;
  /** Nilai `cfg` khas proyek ini (lihat PROJECT_KEYS di config.ts). */
  cfg: Record<string, unknown>;
  /** Kapan profil atau baris proyek terakhir berubah (ms); untuk memuat ulang. */
  stamp: number;
  /** Isi PDF yang boleh dibaca bot, per id berkas. */
  pdfTexts: Map<string, string>;
  pdfVersion: number;
  /** Teks pengetahuan yang sudah dirakit (lihat knowledgeText). */
  rendered: { products: unknown; catalog: unknown; notes: string; files: unknown; pdf: number; text: string } | null;
}

const als = new AsyncLocalStorage<ProjectCtx>();
let fallback: ProjectCtx | null = null;

/** Proses bot: proyek yang dilayani proses ini. */
export function setDefaultProject(ctx: ProjectCtx | null): void {
  fallback = ctx;
}

/** Proyek bawaan proses ini (proses bot), atau null. */
export function defaultProject(): ProjectCtx | null {
  return fallback;
}

/** Dashboard: jalankan `fn` untuk satu proyek. */
export function withProject<T>(ctx: ProjectCtx, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Proyek yang sedang dilayani, atau undefined kalau tidak ada. */
export function maybeProject(): ProjectCtx | undefined {
  return als.getStore() ?? fallback ?? undefined;
}

export function currentProject(): ProjectCtx {
  const ctx = maybeProject();
  if (!ctx) {
    throw new Error('belum ada proyek yang dipilih (PROJECT belum dimuat, atau dipanggil di luar withProject)');
  }
  return ctx;
}
