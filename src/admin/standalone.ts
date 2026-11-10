/**
 * Dashboard saja, tanpa menyambung ke WhatsApp: `npm run admin`.
 *
 * Bot yang sedang jalan di proses lain tetap ikut berubah — ia membaca ulang
 * profil begitu berkasnya berganti.
 */

import { initBiz } from '../business';
import { cfg } from '../config';
import { setUsageRecorder } from '../llm/provider';
import { addUsage, openDb } from '../store';
import { remoteEnabled } from '../remote';
import { startAdmin } from './server';
import { localStore } from './store-local';
import { blobStore } from './stores';

openDb(cfg.dbPath);
initBiz();
setUsageRecorder(addUsage);
// Dengan penyimpanan bersama diatur, dashboard lokal ini mengedit data yang sama
// dengan dashboard online.
startAdmin(remoteEnabled() ? blobStore() : localStore()).catch((e) => {
  console.error(`[dashboard] gagal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
