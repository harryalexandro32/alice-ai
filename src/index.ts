/**
 * Titik masuk bot untuk SATU proyek: `PROJECT=gfan npm run bot`.
 * Di server: alice-bot@<proyek>.service. Latihan tanpa WA: `npm run chat`.
 */

import { startApp } from './app';
import { biz, initBiz } from './business';
import { cfg } from './config';
import { openDb } from './db';
import { markStopped } from './heartbeat';
import { llmEnabled } from './llm/provider';
import { sheetConfigured } from './sinks/sheet';

async function main() {
  await openDb();
  const ctx = await initBiz();
  console.log(`[bot] proyek ${ctx.id}: ${biz.brand} — jalur: ${cfg.transport}`);
  console.log(`[bot] zona waktu ${cfg.tz}`);
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
  if (ctx.row.paused) console.log('[bot] PERHATIAN: bot dijeda untuk semua chat (dashboard > Pengaturan > Proyek)');

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

// Dihentikan dengan sengaja (systemd, Ctrl+C): dashboard diberi tahu dulu.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    setTimeout(() => process.exit(0), 3_000).unref();
    void markStopped()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

main().catch((e) => {
  console.error('[bot] gagal start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
