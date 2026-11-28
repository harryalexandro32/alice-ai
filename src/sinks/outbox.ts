/**
 * Antrean keluar: notifikasi WA ke sales dan balasan staf yang diketik di
 * dashboard.
 *
 * Lead dicatat ke antrean dulu, baru dikirim. WhatsApp yang sedang putus tidak
 * boleh menghilangkan lead, dan tidak boleh menahan balasan ke pelanggan. Yang
 * gagal dicoba lagi di putaran berikutnya.
 *
 * Balasan dari dashboard (jenis `reply`) ditulis dashboard, dikirim bot: proses
 * bot memeriksanya tiap beberapa detik (app.ts). Selama WhatsApp belum
 * tersambung balasan itu menunggu; yang terus gagal dicatat sebagai warning.
 * Pesan tes notifikasi (jenis `test`, tombol "Kirim tes" di Pengaturan >
 * Notifikasi) berjalan dengan cara yang sama: satu baris per nomor penerima.
 * Warning dari proses tanpa WhatsApp (jenis `alert`, mis. dashboard dengan
 * tautan toko Tokopedia & Shop) juga: teksnya sudah jadi (lihat raiseAlert di
 * src/alerts.ts), bot mengirimnya ke satu penerima per baris.
 */

import { raiseAlert } from '../alerts';
import { biz } from '../business';
import { now } from '../clock';
import { outboxDone, outboxFailed, outboxPending, type OutboxKind } from '../store';

export interface LeadPayload {
  kind: string;
  at: number;
  phone: string;
  /** [label, nilai] berurutan sesuai profil bisnis. */
  fields: [string, string | null][];
  needsSales: boolean;
  lastMessage: string;
}

/**
 * Mengirim ringkasan lead ke sales. False = sengaja tidak dikirim (belum
 * diatur, atau jalurnya tidak bisa); melempar = gagal, coba lagi nanti.
 */
export type SalesNotifier = (text: string, kind?: 'lead' | 'butuh-staf') => Promise<boolean>;

/** Pesan tes ke satu penerima notifikasi ("self" = nomor bot sendiri). */
export interface TestPayload {
  phone: string;
  text: string;
}

/** Mengirim teks ke satu penerima notifikasi. False = sengaja tidak dikirim; melempar = gagal. */
export type TestSender = (phone: string, text: string) => Promise<boolean>;

/** Warning untuk satu penerima notifikasi, dengan teks yang sudah jadi (judul + isi). */
export interface AlertPayload {
  phone: string;
  text: string;
  /** Jenis warning-nya (NotifyKind), hanya untuk log. */
  kind?: string;
}

/** Jenis yang diperiksa bot tiap beberapa detik (balasan dari dashboard, pesan tes, dan warning dari dashboard). */
export const QUICK_KINDS: readonly OutboxKind[] = ['reply', 'test', 'alert'];

/** Balasan staf dari dashboard, dikirim bot apa adanya. */
export interface ReplyPayload {
  phone: string;
  address: string;
  text: string;
  by: 'dashboard';
  /** Id pesan 'human' yang dicatat dashboard untuk balasan ini. */
  message_id?: number | null;
}

/**
 * Mengirim satu balasan ke pelanggan; melempar = gagal, coba lagi nanti.
 * Isinya tidak diubah. Di bot sungguhan (app.ts) kirimannya lewat irama
 * manusia: mikir singkat, "sedang mengetik…" sesuai panjangnya, dan antre di
 * belakang chat lain yang sedang diketik (lihat pace.ts).
 */
export type ReplySender = (to: { phone: string; address: string }, text: string) => Promise<void>;

/** Lead yang sudah lengkap = "lead"; selebihnya pelanggan yang menunggu staf. */
export const kindOf = (p: Pick<LeadPayload, 'kind'>): 'lead' | 'butuh-staf' => (p.kind === 'Lead lengkap' ? 'lead' : 'butuh-staf');

const MAX_ATTEMPTS = 20;
/**
 * Balasan dari dashboard dicoba lebih sedikit: ia diperiksa tiap 3 detik, dan
 * staf yang menunggu di halaman percakapan lebih butuh tahu cepat bahwa
 * balasannya gagal daripada menunggu percobaan ke-20.
 */
export const MAX_REPLY_ATTEMPTS = 5;

let notify: SalesNotifier | null = null;
let replySender: ReplySender | null = null;
let replyReady: () => boolean = () => true;

export function setSalesNotifier(fn: SalesNotifier): void {
  notify = fn;
}

let testSender: TestSender | null = null;
/** Dipasang app.ts: cara mengirim pesan tes dan warning antrean ke satu penerima notifikasi. */
export function setTestSender(fn: TestSender | null): void {
  testSender = fn;
}

/**
 * Dipasang app.ts: cara mengirim balasan dari dashboard, dan apakah WhatsApp
 * sedang tersambung. Selama `ready()` false, balasan menunggu tanpa dihitung gagal.
 */
export function setReplySender(fn: ReplySender | null, ready: () => boolean = () => true): void {
  replySender = fn;
  replyReady = ready;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const waLink = (phone: string): string =>
  phone.startsWith('+') ? `wa.me/${phone.slice(1)}` : '(nomor tidak diberikan WhatsApp)';

export function salesText(p: LeadPayload): string {
  return (
    `🔔 *${p.kind}* | ${biz.brand}\n` +
    p.fields.map(([label, v]) => `${cap(label)}: ${v ?? '-'}\n`).join('') +
    (p.needsSales ? `Catatan: menanyakan ${biz.handoffLabel}\n` : '') +
    `Pesan terakhir: "${p.lastMessage}"\n` +
    `Chat: ${waLink(p.phone)}`
  );
}

/** Kirim satu baris ke satu penerima notifikasi: pesan tes, atau warning dari dashboard. */
async function deliverTest(id: number, p: TestPayload, label = 'pesan tes'): Promise<void> {
  try {
    if (!testSender) throw new Error('pengirim pesan tes belum terpasang');
    const sent = await testSender(p.phone, p.text);
    await outboxDone(id, now());
    console.log(`[outbox] ${label} #${id} ${sent ? 'terkirim ke' : 'dilewat untuk'} ${p.phone}`);
  } catch (e) {
    await outboxFailed(id).catch(() => {});
    console.error(`[outbox] ${label} #${id} ke ${p.phone} gagal: ${e instanceof Error ? e.message : e}`);
  }
}

async function deliverReply(id: number, attempts: number, p: ReplyPayload): Promise<void> {
  try {
    if (!replySender) throw new Error('pengirim balasan belum terpasang');
    await replySender({ phone: p.phone, address: p.address }, p.text);
    await outboxDone(id, now());
    console.log(`[outbox] balasan dashboard #${id} terkirim ke ${p.phone}`);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    await outboxFailed(id).catch(() => {});
    console.error(`[outbox] balasan dashboard #${id} ke ${p.phone} gagal: ${why}`);
    if (attempts + 1 >= MAX_REPLY_ATTEMPTS) {
      await raiseAlert('kiriman-gagal', `${p.phone}: "${p.text.slice(0, 200)}" (${why})`, { key: p.phone, whatsapp: false });
    }
  }
}

async function deliverOnce(only?: readonly OutboxKind[]): Promise<void> {
  for (const row of await outboxPending(MAX_ATTEMPTS, only)) {
    if (row.kind === 'reply') {
      // Belum tersambung: menunggu, tidak dihitung gagal.
      if (row.attempts < MAX_REPLY_ATTEMPTS && replyReady()) await deliverReply(row.id, row.attempts, row.payload as ReplyPayload);
      continue;
    }
    if ((row.kind === 'test' || row.kind === 'alert') && row.attempts >= MAX_REPLY_ATTEMPTS) {
      // Pesan tes dan warning yang sudah gagal sekian kali tidak dicoba lagi: ditutup, supaya keluar dari antrean.
      await outboxDone(row.id, now());
      console.log(`[outbox] ${row.kind} #${row.id} dibuang setelah ${row.attempts} percobaan`);
      continue;
    }
    if (row.kind === 'test') {
      // Seperti balasan: menunggu selama belum tersambung, berhenti dicoba setelah beberapa kali gagal.
      if (row.attempts < MAX_REPLY_ATTEMPTS && replyReady()) await deliverTest(row.id, row.payload as TestPayload);
      continue;
    }
    if (row.kind === 'alert') {
      // Seperti pesan tes. Proses tanpa pengirim (mis. cli.ts) tidak menghabiskan percobaannya: menunggu bot.
      const p = row.payload as AlertPayload;
      if (testSender && row.attempts < MAX_REPLY_ATTEMPTS && replyReady()) await deliverTest(row.id, p, `warning ${p.kind ?? ''}`.trim());
      continue;
    }
    if (row.kind !== 'sales') {
      // Jenis yang tidak dikenal lagi (mis. baris lama dari versi sebelumnya): tutup, jangan dicoba terus.
      await outboxDone(row.id, now());
      console.log(`[outbox] ${row.kind} #${row.id} dilewat: jenis ini tidak dipakai lagi`);
      continue;
    }
    const p = row.payload as LeadPayload;
    try {
      if (!notify) throw new Error('pengirim notifikasi belum terpasang');
      await notify(salesText(p), kindOf(p));
      await outboxDone(row.id, now());
    } catch (e) {
      await outboxFailed(row.id).catch(() => {});
      console.error(`[outbox] ${row.kind} #${row.id} gagal: ${e instanceof Error ? e.message : e}`);
    }
  }
}

let current: { run: Promise<void>; full: boolean } | null = null;
/** Putaran penuh yang menunggu putaran "hanya balasan" selesai. */
let queuedFull: Promise<void> | null = null;

/**
 * Satu putaran saja pada satu waktu — putaran kedua yang tumpang tindih akan
 * mengirim baris yang sama dua kali. Pemanggil kedua mendapat putaran yang
 * sedang berjalan. `only` = hanya satu jenis baris (pemeriksaan cepat balasan
 * dari dashboard); putaran penuh yang diminta selagi putaran itu berjalan
 * menunggu di belakangnya, supaya lead tidak tertunda sampai putaran berikutnya.
 */
export function deliverOutbox(only?: readonly OutboxKind[]): Promise<void> {
  const full = !only;
  if (current && (current.full || !full)) return current.run;
  if (current) {
    queuedFull ??= current.run
      .catch(() => {})
      .then(() => {
        queuedFull = null;
        return deliverOutbox();
      });
    return queuedFull;
  }
  const run = deliverOnce(only).finally(() => {
    if (current?.run === run) current = null;
  });
  current = { run, full };
  return run;
}
