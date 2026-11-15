/**
 * Siapa yang dikabari, dan lewat jalur apa.
 *
 * Penerima (pemilik dan staf) serta rute tiap jenis kabar diatur pemilik di
 * dashboard (Pengaturan > Notifikasi). Tiap penerima boleh punya nomor
 * WhatsApp dan alamat email; yang diisi, itu yang dipakai.
 *
 * Yang rahasia TIDAK ada di dashboard: kata sandi SMTP tetap di .env mesin
 * bot. Dashboard hanya menyimpan ke siapa kabarnya dikirim.
 *
 * Berkas ini tidak menyentuh database, jadi pengawas (yang hidup di luar bot)
 * juga bisa memakainya untuk mengabari bahwa bot mati.
 */

import { biz } from './business';
import type { NotifyKind, Recipient, Route } from './business/types';
import { cfg } from './config';

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
 * Penerima untuk satu jenis kabar.
 *
 * Nomor sales proyek (dashboard > Pengaturan > Proyek) serta ALERT_EMAIL_TO
 * di .env tetap berlaku sebagai "pemilik bawaan": selama
 * daftar penerima di dashboard masih kosong ia menerima semuanya, seperti
 * sebelum daftar itu ada.
 */
export function recipientsFor(kind: NotifyKind): Recipient[] {
  const route = routeOf(kind);
  if (route === 'none') return [];
  const listed = biz.recipients.filter((r) => route === 'both' || r.role === route);
  const legacy: Recipient = {
    name: 'bawaan',
    role: 'owner',
    phone: biz.recipients.length ? '' : (cfg.salesNumber ?? ''),
    email: cfg.alertEmailTo,
  };
  const useLegacy = !biz.recipients.length || route !== 'staff';
  return useLegacy && (legacy.phone || legacy.email) ? [...listed, legacy] : listed;
}

/** Nomor WhatsApp (atau "self") yang menerima kabar jenis ini, tanpa ganda. */
export const waTargets = (kind: NotifyKind): string[] => [...new Set(recipientsFor(kind).map((r) => r.phone).filter(Boolean))];

/** Semua nomor penerima: pesan dari mereka bukan pesan calon pelanggan. */
export function recipientPhones(): Set<string> {
  return new Set([...biz.recipients.map((r) => r.phone), cfg.salesNumber ?? ''].filter((p) => p && p !== 'self'));
}

export const emailReady = (): boolean => Boolean(cfg.smtpHost && cfg.smtpUser && cfg.smtpPass);

let mailer: { sendMail(m: Record<string, unknown>): Promise<unknown> } | null = null;

/** Email lewat SMTP (mis. Gmail dengan sandi aplikasi). Tidak pernah melempar. */
export async function sendEmail(to: string[], subject: string, text: string): Promise<boolean> {
  if (!emailReady() || !to.length) return false;
  try {
    // Dimuat saat dipakai: yang tidak memakai email tidak perlu pustakanya.
    mailer ??= (await import('nodemailer')).createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
      connectionTimeout: 15_000,
    });
    await mailer.sendMail({ from: cfg.smtpFrom || cfg.smtpUser, to: to.join(', '), subject: subject.slice(0, 150), text });
    return true;
  } catch (e) {
    console.error(`[notifikasi] email gagal: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/** Kirim lewat email ke penerima jenis kabar ini. WhatsApp diurus pemanggil. */
export async function deliverExternal(kind: NotifyKind, title: string, text: string): Promise<void> {
  const emails = [...new Set(recipientsFor(kind).map((r) => r.email).filter(Boolean))];
  await sendEmail(emails, `[${biz.brand}] ${title}`, text);
}
