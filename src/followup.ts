/**
 * Follow-up: satu pengingat kalau pelanggan diam setelah bot membalas.
 *
 * Ini SATU-SATUNYA pesan yang bot kirim tanpa dipicu pesan masuk, jadi di
 * sinilah risiko terbesar — kelihatan seperti spam, atau (di Cloud API) jatuh
 * di luar jendela layanan 24 jam dan ditolak. Karena itu aturannya sempit:
 * sekali per masa diam, ada batas seumur nomor, hanya di jam wajar, dan batal
 * begitu pelanggan atau manusia bicara.
 */

import { refreshBiz } from './business';
import { cfg, HOUR, MINUTE } from './config';
import { localMinutes, now } from './clock';
import { contactName, missingFields, type Sender } from './flow';
import { humanHolds } from './flow';
import { addMessage, followupCandidates, updateContact } from './store';
import { followupText } from './texts';

/** Terlambat lebih dari ini (bot sempat mati) = dilewat, bukan dikirim basi. */
const GRACE_MS = 6 * HOUR;

/**
 * Kapan follow-up untuk pelanggan yang terakhir bicara di `lastInbound`.
 *
 * Bawaannya lastInbound + FOLLOWUP_AFTER_HOURS. Kalau itu jatuh di luar jam
 * kirim, digeser ke jam buka berikutnya — kecuali geseran itu melewati
 * FOLLOWUP_MAX_HOURS (jendela Cloud API), maka dimajukan ke sesaat sebelum jam
 * tutup. Lebih awal dari 23 jam masih sopan; lewat 24 jam tidak terkirim.
 */
export function followupDueAt(lastInbound: number): number {
  const due = lastInbound + cfg.followupAfterHours * HOUR;
  const m = localMinutes(due);
  const start = cfg.followupStartHour * 60;
  const end = cfg.followupEndHour * 60;
  if (m >= start && m < end) return due;

  const later = due + (m < start ? start - m : 24 * 60 - m + start) * MINUTE;
  const limit = cfg.followupMaxHours ? lastInbound + cfg.followupMaxHours * HOUR - 10 * MINUTE : Infinity;
  if (later <= limit) return later;

  return due - (m >= end ? m - end : m + 24 * 60 - end) * MINUTE - 5 * MINUTE;
}

export async function runFollowups(send: Sender): Promise<number> {
  refreshBiz();
  const t = now();
  let sent = 0;

  for (const c of followupCandidates()) {
    const due = followupDueAt(c.last_inbound_at);
    if (t < due) continue;

    const skip =
      humanHolds(c.address, t)
        ? 'sedang ditangani manusia'
        : t > due + GRACE_MS
          ? 'sudah terlalu lama lewat'
          : cfg.followupMaxHours && t > c.last_inbound_at + cfg.followupMaxHours * HOUR
            ? 'di luar jendela 24 jam'
            : c.followup_total >= cfg.followupMaxTotal
              ? 'batas follow-up nomor ini tercapai'
              : null;
    if (skip) {
      console.log(`[follow-up] ${c.phone}: dilewat (${skip})`);
      updateContact(c.phone, { followup_state: 'idle' });
      continue;
    }

    const text = followupText(contactName(c), missingFields(c));
    try {
      await send({ phone: c.phone, address: c.address }, text);
    } catch (e) {
      // Tetap 'pending': dicoba lagi di putaran berikutnya sampai masa tenggang habis.
      console.error(`[follow-up] ${c.phone}: gagal kirim: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    addMessage(c.phone, 'out', text, t);
    updateContact(c.phone, {
      last_dir: 'out',
      last_out_text: text,
      followup_state: 'idle',
      followup_total: c.followup_total + 1,
    });
    console.log(`[follow-up] ${c.phone}: terkirim`);
    sent += 1;
  }
  return sent;
}
