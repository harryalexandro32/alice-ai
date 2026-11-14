/**
 * Dashboard untuk semua proyek: `npm run admin` (di server: alice-admin.service).
 *
 * Berjalan sebagai proses sendiri, terpisah dari bot. Keduanya memakai
 * database yang sama: yang disimpan di sini dibaca bot pada giliran
 * berikutnya, dan keadaan bot (WhatsApp, QR) dibaca dari laporan berkalanya.
 */

import { openDb } from '../db';
import { seed } from '../db/seed';
import { setUsageRecorder } from '../llm/provider';
import { addUsage } from '../store';
import { startAdmin } from './server';
import { localStore } from './store-local';

(async () => {
  await openDb();
  // Proyek gfan selalu ada (aman diulang; yang sudah ada tidak ditimpa).
  await seed();
  // "Coba bicara" di dashboard juga memakai LLM: dicatat ke proyek yang sedang dibuka.
  setUsageRecorder(addUsage);
  await startAdmin(localStore());
})().catch((e) => {
  console.error(`[dashboard] gagal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
