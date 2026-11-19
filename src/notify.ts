/**
 * Siapa yang dikabari.
 *
 * Penerima (pemilik dan staf, masing-masing dengan nomor WhatsApp) serta rute
 * tiap jenis kabar diatur pemilik di dashboard (Pengaturan > Notifikasi).
 * Kabar keluar hanya lewat WhatsApp; kabar yang tidak bisa lewat WhatsApp
 * (WhatsApp-nya sendiri bermasalah, bot berhenti) hanya tampil di dashboard.
 */

import { biz } from './business';
import type { NotifyKind, Recipient, Route } from './business/types';

export const NOTIFY_KINDS: readonly NotifyKind[] = ['lead', 'butuh-staf', 'wa-putus', 'kiriman-dijeda', 'kiriman-gagal', 'llm', 'bot-mati'];

/** Rute bawaan: urusan pelanggan ke staf, urusan sistem ke pemilik. */
export const DEFAULT_ROUTES: Record<NotifyKind, Route> = {
  lead: 'staff',
  'butuh-staf': 'staff',
  'wa-putus': 'owner',
  'kiriman-dijeda': 'owner',
  'kiriman-gagal': 'owner',
  llm: 'owner',
  'bot-mati': 'owner',
};

export const routeOf = (kind: NotifyKind): Route => biz.notifyRoutes[kind] ?? DEFAULT_ROUTES[kind];

/**
 * Penerima untuk satu jenis kabar: yang perannya cocok dengan rutenya. Kalau
 * tidak ada yang berperan itu, semua penerima mendapatkannya, supaya kabarnya
 * tidak hilang (mis. satu-satunya penerima adalah staf).
 */
export function recipientsFor(kind: NotifyKind): Recipient[] {
  const route = routeOf(kind);
  if (route === 'none') return [];
  const listed = biz.recipients.filter((r) => route === 'both' || r.role === route);
  return listed.length ? listed : biz.recipients;
}

/** Nomor WhatsApp (atau "self") yang menerima kabar jenis ini, tanpa ganda. */
export const waTargets = (kind: NotifyKind): string[] => [...new Set(recipientsFor(kind).map((r) => r.phone).filter(Boolean))];

/** Semua nomor penerima: pesan dari mereka bukan pesan calon pelanggan. */
export function recipientPhones(): Set<string> {
  return new Set(biz.recipients.map((r) => r.phone).filter((p) => p && p !== 'self'));
}
