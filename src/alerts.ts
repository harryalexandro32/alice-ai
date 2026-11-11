/**
 * Peringatan untuk pemilik: hal-hal yang butuh orang, bukan sekadar catatan log.
 *
 *   - bot tidak bisa menjawab pelanggan dan butuh staf (kurang pengetahuan,
 *     pelanggan minta orang, pelanggan mengirim foto/suara);
 *   - WhatsApp terputus permanen, kiriman dijeda pengaman, LLM bermasalah.
 *
 * Tiap peringatan dicatat (tampil di dashboard, halaman Peringatan) dan dikirim
 * ke pemilik: lewat WhatsApp ke nomor sales selama WhatsApp-nya masih jalan,
 * dan lewat Telegram kalau diatur — satu-satunya jalur yang tetap sampai saat
 * WhatsApp-nya sendiri yang bermasalah.
 */

import { biz } from './business';
import { now } from './clock';
import { cfg, HOUR, MINUTE } from './config';
import { addAlert, lastAlertAt } from './store';

export type AlertKind =
  | 'butuh-staf' // pelanggan menunggu jawaban manusia
  | 'wa-putus' // sesi WhatsApp dicabut / direbut
  | 'kiriman-dijeda' // pengaman nomor menahan kiriman
  | 'llm' // LLM gagal berulang atau jatah harian habis
  | 'bot-mati'; // proses bot berhenti (dicatat pengawas)

const TITLES: Record<AlertKind, string> = {
  'butuh-staf': 'Pelanggan butuh dibantu staf',
  'wa-putus': 'WhatsApp terputus',
  'kiriman-dijeda': 'Kiriman bot dijeda',
  llm: 'LLM bermasalah',
  'bot-mati': 'Bot berhenti',
};

/** Peringatan sejenis tidak diulang lebih sering dari ini. */
const QUIET: Record<AlertKind, number> = {
  'butuh-staf': 30 * MINUTE,
  'wa-putus': 6 * HOUR,
  'kiriman-dijeda': HOUR,
  llm: 6 * HOUR,
  'bot-mati': 10 * MINUTE,
};

let viaWhatsApp: ((text: string) => Promise<unknown>) | null = null;
/** Dipasang app.ts: kirim teks ke nomor sales/pemilik lewat WhatsApp. */
export function setAlertWhatsApp(fn: ((text: string) => Promise<unknown>) | null): void {
  viaWhatsApp = fn;
}

/** Telegram, kalau TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID diisi. Tidak pernah melempar. */
export async function sendTelegram(text: string): Promise<boolean> {
  if (!cfg.telegramToken || !cfg.telegramChat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegramChat, text: text.slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[peringatan] Telegram menolak (${res.status})`);
    return res.ok;
  } catch (e) {
    console.error(`[peringatan] Telegram gagal: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/**
 * Catat dan kirim peringatan. `key` membedakan peringatan sejenis (mis. nomor
 * pelanggan). `whatsapp: false` untuk hal yang sudah punya notifikasi WA
 * sendiri, atau saat WhatsApp-nya yang bermasalah. True kalau benar-benar
 * dicatat (bukan ulangan dalam masa tenang).
 */
export function raiseAlert(kind: AlertKind, text: string, opts: { key?: string; whatsapp?: boolean } = {}): boolean {
  const key = opts.key ?? '';
  const at = now();
  try {
    if (at - lastAlertAt(kind, key) < QUIET[kind]) return false;
    addAlert({ at, kind, key, text });
  } catch (e) {
    // Database belum terbuka (mis. gagal sangat awal): tetap tampil di log.
    console.error(`[peringatan] tidak tercatat: ${e instanceof Error ? e.message : e}`);
  }
  const message = `⚠️ ${TITLES[kind]} — ${biz.brand}\n${text}`;
  console.error(`[peringatan] ${TITLES[kind]}: ${text.replace(/\n/g, ' | ')}`);
  void sendTelegram(message);
  if (opts.whatsapp !== false && viaWhatsApp) {
    void viaWhatsApp(message).catch((e) => console.error(`[peringatan] WA gagal: ${e instanceof Error ? e.message : e}`));
  }
  return true;
}
