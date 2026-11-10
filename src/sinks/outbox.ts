/**
 * Antrean keluar untuk lead: notifikasi WA ke sales dan baris Google Sheet.
 *
 * Lead dicatat ke antrean dulu, baru dikirim. Sheet yang sedang error atau
 * WhatsApp yang sedang putus tidak boleh menghilangkan lead, dan tidak boleh
 * menahan balasan ke pelanggan. Yang gagal dicoba lagi di putaran berikutnya.
 */

import { biz } from '../business';
import { localStamp, now } from '../clock';
import { outboxDone, outboxFailed, outboxPending } from '../store';
import { appendSheetRow, sheetConfigured } from './sheet';

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
export type SalesNotifier = (text: string) => Promise<boolean>;

const MAX_ATTEMPTS = 20;

let notify: SalesNotifier | null = null;
let appendRow: (row: string[]) => Promise<void> = appendSheetRow;
let sheetOn: () => boolean = sheetConfigured;
let current: Promise<void> | null = null;

export function setSalesNotifier(fn: SalesNotifier): void {
  notify = fn;
}
/** Tes & mode latihan: ganti penulis Sheet. */
export function setSheetWriter(fn: (row: string[]) => Promise<void>): void {
  appendRow = fn;
  sheetOn = () => true;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const waLink = (phone: string): string =>
  phone.startsWith('+') ? `wa.me/${phone.slice(1)}` : '(nomor tidak diberikan WhatsApp)';

export function salesText(p: LeadPayload): string {
  return (
    `🔔 *${p.kind}* — ${biz.brand}\n` +
    p.fields.map(([label, v]) => `${cap(label)}: ${v ?? '-'}\n`).join('') +
    (p.needsSales ? `Catatan: menanyakan ${biz.handoffLabel}\n` : '') +
    `Pesan terakhir: "${p.lastMessage}"\n` +
    `Chat: ${waLink(p.phone)}`
  );
}

/** Kolom: Waktu, Jenis, Nomor, <field profil…>, Perlu sales, Pesan terakhir. */
export function sheetRow(p: LeadPayload): string[] {
  return [
    localStamp(p.at),
    p.kind,
    p.phone,
    ...p.fields.map(([, v]) => v ?? ''),
    p.needsSales ? 'ya' : '',
    p.lastMessage,
  ];
}

async function deliverOnce(): Promise<void> {
  for (const row of outboxPending(MAX_ATTEMPTS)) {
    const p = JSON.parse(row.payload) as LeadPayload;
    try {
      if (row.kind === 'sales') {
        if (!notify) throw new Error('pengirim notifikasi belum terpasang');
        await notify(salesText(p));
      } else if (!sheetOn()) {
        console.log('[outbox] Sheet belum diatur, baris dilewat');
      } else {
        await appendRow(sheetRow(p));
      }
      outboxDone(row.id, now());
    } catch (e) {
      outboxFailed(row.id);
      console.error(`[outbox] ${row.kind} #${row.id} gagal: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/**
 * Satu putaran saja pada satu waktu — putaran kedua yang tumpang tindih akan
 * mengirim lead yang sama dua kali. Pemanggil kedua mendapat putaran yang
 * sedang berjalan.
 */
export function deliverOutbox(): Promise<void> {
  current ??= deliverOnce().finally(() => {
    current = null;
  });
  return current;
}
