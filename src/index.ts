/** Titik masuk: nyambung ke WhatsApp beneran. Latihan tanpa WA: `npm run chat`. */

import { startApp } from './app';
import { biz } from './business';
import { cfg } from './config';
import { llmEnabled } from './llm/provider';
import { sheetConfigured } from './sinks/sheet';

async function main() {
  console.log(`[bot] bisnis: ${biz.brand} (${biz.id}) — jalur: ${cfg.transport}`);
  console.log(`[bot] zona waktu ${cfg.tz}, database ${cfg.dbPath}`);
  console.log(
    `[bot] LLM: ${llmEnabled() ? `${cfg.llmModel} @ ${cfg.llmBaseUrl}` : 'MATI (LLM_API_KEY kosong) — pertanyaan dioper ke manusia'}`
  );
  console.log(
    `[bot] notifikasi sales: ${cfg.salesNumber === 'self' ? 'nomor bot sendiri' : (cfg.salesNumber ?? 'BELUM DIATUR')}`
  );
  console.log(`[bot] Google Sheet: ${sheetConfigured() ? 'siap' : 'BELUM DIATUR'}`);
  console.log(
    `[bot] follow-up setelah ${cfg.followupAfterHours}–${Math.max(cfg.followupAfterHours, cfg.followupAfterHoursMax)} jam diam (diacak), jam ${cfg.followupStartHour}–${cfg.followupEndHour}` +
      (cfg.followupMaxHours ? `, paling lambat jam ke-${cfg.followupMaxHours}` : '')
  );

  // Dimuat sesuai pilihan: yang memakai Cloud API tidak perlu memuat Baileys.
  const transport =
    cfg.transport === 'cloud'
      ? (await import('./transport/cloud')).cloudTransport
      : (await import('./transport/baileys')).baileysTransport;
  await startApp(transport);
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
