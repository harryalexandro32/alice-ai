/**
 * Dashboard sebagai fungsi Vercel. Semua alamat diarahkan ke sini (vercel.json).
 * Botnya TIDAK jalan di sini: ia jalan di tempat lain dan mengikuti profil
 * yang disimpan dashboard ini ke Vercel Blob.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { createAdminHandler } from '../src/admin/server';
import { blobStore } from '../src/admin/stores';

const handler = createAdminHandler(blobStore());

export default function (req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handler(req, res);
}
