/**
 * Penyimpanan bersama (Vercel Blob) untuk dashboard yang di-hosting terpisah
 * dari bot.
 *
 * Dashboard di Vercel menulis profil dan foto ke sini; bot di tempat lain
 * menariknya. Blob-nya privat: dibaca dengan token, bukan lewat URL publik,
 * dan selalu dari sumbernya (bukan cache), jadi yang baru disimpan langsung
 * terbaca.
 *
 * Aktif hanya kalau BLOB_READ_WRITE_TOKEN diisi. Tanpa itu, semuanya tetap di
 * folder lokal seperti biasa.
 */

import { cfg } from './config';

export interface BlobApi {
  getBytes(path: string): Promise<Buffer | null>;
  put(path: string, data: Buffer | string, contentType: string): Promise<void>;
  del(path: string): Promise<void>;
}

let injected: BlobApi | null = null;
/** Tes: ganti penyimpanan dengan tiruan di memori. */
export function setBlobApi(api: BlobApi | null): void {
  injected = api;
}

export const remoteEnabled = (): boolean => Boolean(injected) || Boolean(cfg.blobToken);

function real(): BlobApi {
  // Dimuat saat dipakai: bot tanpa penyimpanan bersama tidak perlu SDK-nya.
  const sdk = require('@vercel/blob') as typeof import('@vercel/blob');
  const base = { token: cfg.blobToken, access: cfg.blobAccess } as const;
  return {
    async getBytes(path) {
      try {
        const r = await sdk.get(path, { ...base, useCache: false });
        if (!r || r.statusCode !== 200) return null;
        return Buffer.from(await new Response(r.stream).arrayBuffer());
      } catch (e) {
        if (e instanceof sdk.BlobNotFoundError) return null;
        throw e;
      }
    },
    async put(path, data, contentType) {
      await sdk.put(path, data, { ...base, contentType, addRandomSuffix: false, allowOverwrite: true });
    },
    async del(path) {
      await sdk.del(path, { token: cfg.blobToken });
    },
  };
}

export const blob = (): BlobApi => injected ?? real();

export const remotePath = {
  profile: (): string => `${cfg.business}/profile.json`,
  media: (file: string): string => `${cfg.business}/media/${file}`,
  /** Salinan lead + status bot, dikirim bot untuk ditampilkan dashboard. */
  snapshot: (): string => `${cfg.business}/snapshot.json`,
};

export async function getJson<T>(path: string): Promise<T | null> {
  const bytes = await blob().getBytes(path);
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString('utf8')) as T;
  } catch {
    return null;
  }
}
