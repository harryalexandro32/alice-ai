/** Titik masuk: nyambung ke WhatsApp beneran. Latihan tanpa WA: `npm run chat`. */

import { startApp } from './app';
import { cfg } from './config';
import { llmEnabled } from './llm/provider';
import { sheetConfigured } from './sinks/sheet';
import { baileysTransport } from './transport/baileys';

async function main() {
  console.log(`[bot] zona waktu ${cfg.tz}, database ${cfg.dbPath}`);
  console.log(
    `[bot] LLM: ${llmEnabled() ? `${cfg.llmModel} @ ${cfg.llmBaseUrl}` : 'MATI (LLM_API_KEY kosong) — tanya-jawab katalog dioper ke sales'}`
  );
  console.log(`[bot] notifikasi sales: ${cfg.salesNumbers.length ? cfg.salesNumbers.join(', ') : 'BELUM DIATUR'}`);
  console.log(`[bot] Google Sheet: ${sheetConfigured() ? 'siap' : 'BELUM DIATUR'}`);
  console.log(
    `[bot] follow-up setelah ${cfg.followupAfterHours} jam diam, jam ${cfg.followupStartHour}–${cfg.followupEndHour}`
  );
  await startApp(baileysTransport);
}

// Mati tak terduga harus keluar dengan kode gagal supaya pengawas proses bisa
// memulai ulang; proses zombie tidak bisa dibedakan dari bot yang sedang sepi.
process.on('unhandledRejection', (reason) => {
  console.error('[bot] unhandled rejection:', reason);
  process.exit(1);
});

main().catch((e) => {
  console.error('[bot] gagal start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
