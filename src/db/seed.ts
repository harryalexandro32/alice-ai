/**
 * `npm run db:seed`: isi awal yang aman dijalankan berulang kali.
 *
 * Membuat proyek `gfan` (bibit profil GFAN di kode) beserta profil kosongnya
 * kalau belum ada. Baris yang sudah ada TIDAK pernah ditimpa. Dashboard juga
 * memanggilnya saat start, dan memakai ensureProject untuk "Proyek baru".
 */

import 'dotenv/config';

import { createProject, type NewProject } from '../store';
import { closeDb, openDb } from './index';

/** Pastikan proyek ini ada. True kalau baru dibuat. */
export function ensureProject(
  id: string,
  template: string,
  name: string,
  extra: Omit<NewProject, 'id' | 'template' | 'name'> = {}
): Promise<boolean> {
  return createProject({ id, template, name, ...extra });
}

export async function seed(): Promise<void> {
  if (await ensureProject('gfan', 'gfan', 'GFAN Indonesia')) console.log('[db] proyek gfan dibuat');
}

if (require.main === module) {
  openDb()
    .then(seed)
    .then(async () => {
      console.log('[db] seed selesai');
      await closeDb();
    })
    .catch((e) => {
      console.error(`[db] seed gagal: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}
