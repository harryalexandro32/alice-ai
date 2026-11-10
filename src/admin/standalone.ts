/**
 * Dashboard saja, tanpa menyambung ke WhatsApp: `npm run admin`.
 *
 * Bot yang sedang jalan di proses lain tetap ikut berubah — ia membaca ulang
 * profil begitu berkasnya berganti.
 */

import { initBiz } from '../business';
import { cfg } from '../config';
import { openDb } from '../store';
import { startAdmin } from './server';

openDb(cfg.dbPath);
initBiz();
startAdmin().catch((e) => {
  console.error(`[dashboard] gagal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
