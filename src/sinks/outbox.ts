/**
 * Antrean keluar untuk lead: notifikasi WA ke sales dan baris Google Sheet.
 *
 * Lead dicatat ke antrean dulu, baru dikirim. Sheet yang sedang error atau
 * WhatsApp yang sedang putus tidak boleh menghilangkan lead, dan tidak boleh
 * menahan balasan ke pelanggan. Yang gagal dicoba lagi di putaran berikutnya.
 */

import { cfg } from '../config';
import { localStamp, now } from '../clock';
import type { Sender } from '../flow';
import { outboxDone, outboxFailed, outboxPending } from '../store';
import { appendSheetRow, sheetConfigured } from './sheet';

export interface LeadPayload {
  kind: string;
  at: number;
  phone: string;
  name: string | null;
  city: string | null;
  need: string | null;
  wantsPrice: boolean;
  lastMessage: string;
}

const MAX_ATTEMPTS = 20;

let send: Sender | null = null;
let appendRow: (row: string[]) => Promise<void> = appendSheetRow;
let sheetOn: () => boolean = sheetConfigured;
let current: Promise<void> | null = null;

export function setOutboxSender(fn: Sender): void {
  send = fn;
}
/** Tes: ganti penulis Sheet. */
export function setSheetWriter(fn: (row: string[]) => Promise<void>): void {
  appendRow = fn;
  sheetOn = () => true;
}

const waLink = (phone: string): string =>
  phone.startsWith('+') ? `wa.me/${phone.slice(1)}` : '(nomor tidak diberikan WhatsApp)';

export function salesText(p: LeadPayload): string {
  return (
    `🔔 *${p.kind}* — GFAN\n` +
    `Nama: ${p.name ?? '-'}\n` +
    `Kota/alamat: ${p.city ?? '-'}\n` +
    `Kebutuhan: ${p.need ?? '-'}\n` +
    (p.wantsPrice ? 'Catatan: menanyakan harga/stok\n' : '') +
    `Pesan terakhir: "${p.lastMessage}"\n` +
    `Chat: ${waLink(p.phone)}`
  );
}

export function sheetRow(p: LeadPayload): string[] {
  return [
    localStamp(p.at),
    p.kind,
    p.phone,
    p.name ?? '',
    p.city ?? '',
    p.need ?? '',
    p.wantsPrice ? 'ya' : '',
    p.lastMessage,
  ];
}

async function deliverOnce(): Promise<void> {
    for (const row of outboxPending(MAX_ATTEMPTS)) {
      const p = JSON.parse(row.payload) as LeadPayload;
      try {
        if (row.kind === 'sales') {
          if (!cfg.salesNumbers.length) {
            console.log('[outbox] SALES_NUMBERS kosong, notifikasi sales dilewat');
          } else if (send) {
            for (const phone of cfg.salesNumbers) await send({ phone, address: '' }, salesText(p));
          } else {
            throw new Error('pengirim belum terpasang');
          }
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
