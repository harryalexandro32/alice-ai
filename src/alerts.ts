/**
 * Warning untuk pemilik dan staf: hal-hal yang butuh orang, bukan sekadar
 * catatan log.
 *
 *   - bot tidak bisa menjawab pelanggan dan butuh staf (kurang pengetahuan,
 *     pelanggan minta orang, pelanggan mengirim sesuatu yang tidak terbaca);
 *   - WhatsApp terputus permanen, kiriman dijeda pengaman, balasan dari
 *     dashboard yang gagal terkirim, LLM bermasalah.
 *
 * Tiap warning dicatat (tampil di dashboard: Beranda dan Pengaturan > Lanjutan)
 * dan dikirim ke penerima yang diatur di dashboard (lihat notify.ts): lewat
 * WhatsApp selama WhatsApp-nya masih jalan, plus Telegram dan email — dua
 * jalur yang tetap sampai saat WhatsApp-nya sendiri yang bermasalah.
 */

import { biz } from './business';
import type { NotifyKind } from './business/types';
import { now } from './clock';
import { HOUR, MINUTE } from './config';
import { deliverExternal, waTargets } from './notify';
import { addAlert, lastAlertAt } from './store';

export type AlertKind = Exclude<NotifyKind, 'lead'>;

export const ALERT_TITLES: Record<NotifyKind, string> = {
  lead: 'Lead baru',
  'butuh-staf': 'Pelanggan butuh dibantu staf',
  'wa-putus': 'WhatsApp terputus',
  'kiriman-dijeda': 'Kiriman bot dijeda',
  'kiriman-gagal': 'Balasan dari dashboard gagal terkirim',
  llm: 'LLM bermasalah',
  'bot-mati': 'Bot berhenti',
};

/** Warning sejenis tidak diulang lebih sering dari ini. */
const QUIET: Record<AlertKind, number> = {
  'butuh-staf': 30 * MINUTE,
  'wa-putus': 6 * HOUR,
  'kiriman-dijeda': HOUR,
  'kiriman-gagal': 10 * MINUTE,
  llm: 6 * HOUR,
  'bot-mati': 10 * MINUTE,
};

let signal: (() => void) | null = null;
/** Dipasang app.ts: minta laporan ke dashboard online dikirim segera, bukan menunggu jadwal. */
export function setDashboardSignal(fn: (() => void) | null): void {
  signal = fn;
}
/** Ada yang perlu segera terlihat di dashboard (warning, lead baru). */
export function signalDashboard(): void {
  signal?.();
}

let viaWhatsApp: ((phone: string, text: string) => Promise<unknown>) | null = null;
/** Dipasang app.ts: kirim teks ke satu nomor ("self" = nomor bot sendiri) lewat WhatsApp. */
export function setAlertWhatsApp(fn: ((phone: string, text: string) => Promise<unknown>) | null): void {
  viaWhatsApp = fn;
}

/**
 * Catat dan kirim warning. `key` membedakan warning sejenis (mis. nomor
 * pelanggan). `whatsapp: false` untuk hal yang sudah punya notifikasi WA
 * sendiri, atau saat WhatsApp-nya yang bermasalah. True kalau benar-benar
 * dicatat (bukan ulangan dalam masa tenang).
 */
export async function raiseAlert(kind: AlertKind, text: string, opts: { key?: string; whatsapp?: boolean } = {}): Promise<boolean> {
  const key = opts.key ?? '';
  const at = now();
  try {
    if (at - (await lastAlertAt(kind, key)) < QUIET[kind]) return false;
    await addAlert({ at, kind, key, text });
  } catch (e) {
    // Database belum terbuka (mis. gagal sangat awal): tetap tampil di log.
    console.error(`[warning] tidak tercatat: ${e instanceof Error ? e.message : e}`);
  }
  signalDashboard();
  const title = `⚠️ ${ALERT_TITLES[kind]} | ${biz.brand}`;
  console.error(`[warning] ${ALERT_TITLES[kind]}: ${text.replace(/\n/g, ' | ')}`);
  void deliverExternal(kind, title, text);
  if (opts.whatsapp !== false && viaWhatsApp) {
    for (const phone of waTargets(kind)) {
      void viaWhatsApp(phone, `${title}\n${text}`).catch((e) => console.error(`[warning] WA ke ${phone} gagal: ${e instanceof Error ? e.message : e}`));
    }
  }
  return true;
}
