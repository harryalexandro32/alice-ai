/**
 * Follow-up: satu pengingat kalau pelanggan diam setelah bot membalas.
 *
 * Ini SATU-SATUNYA pesan yang bot kirim tanpa dipicu pesan masuk, jadi di
 * sinilah risiko terbesar — kelihatan seperti spam, atau (di Cloud API) jatuh
 * di luar jendela layanan 24 jam dan ditolak. Karena itu aturannya sempit:
 * sekali per masa diam, ada batas seumur nomor, hanya di jam wajar, dan batal
 * begitu pelanggan atau manusia bicara.
 */

import { followupBrain } from './brain';
import { llmEnabled } from './llm/provider';
import { cfg, HOUR, MINUTE } from './config';
import { localMinutes, now } from './clock';
import { contactName, humanHolds, missingFields, projectPaused, type Sender } from './flow';
import { addMessage, followupCandidates, recentMessages, updateContact, type Contact } from './store';
import { followupText, noDash } from './texts';

/** Menulis follow-up untuk satu pelanggan; null = pakai kalimat tetap. */
export type FollowupWriter = (c: Contact, hours: number) => Promise<string | null>;

const llmWriter: FollowupWriter = async (c, hours) => {
  if (!cfg.followupSmart || !llmEnabled()) return null;
  // Tanpa percakapan sungguhan tidak ada yang bisa disambung: kalimat tetap lebih jujur.
  const history = await recentMessages(c.phone, 12);
  if (history.filter((m) => m.dir === 'in').length < 2 && !c.summary) return null;
  return followupBrain({ known: c.lead, history, summary: c.summary, missing: missingFields(c).map((f) => f.label), hours });
};

let writer: FollowupWriter = llmWriter;
/** Tes: ganti penulis follow-up. */
export function setFollowupWriter(fn: FollowupWriter | null): void {
  writer = fn ?? llmWriter;
}

/** Terlambat lebih dari ini (bot sempat mati) = dilewat, bukan dikirim basi. */
const GRACE_MS = 6 * HOUR;

/** Pecahan 0–1 yang tetap untuk kunci yang sama (FNV-1a). */
function fraction(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 2 ** 32;
}

/**
 * Kapan follow-up untuk pelanggan yang terakhir bicara di `lastInbound`.
 *
 * Jedanya diacak di antara FOLLOWUP_AFTER_HOURS dan FOLLOWUP_AFTER_HOURS_MAX
 * (bawaan 23–25 jam), supaya pengingat tidak selalu datang tepat sekian jam
 * kemudian. Acakannya diturunkan dari `key` (nomor pelanggan) dan waktu pesan
 * terakhirnya, jadi untuk satu masa diam hasilnya selalu sama — putaran
 * berkala tidak mengocok ulang jadwal yang sudah ditetapkan.
 *
 * Kalau waktunya jatuh di luar jam kirim, digeser ke jam buka berikutnya —
 * kecuali geseran itu melewati FOLLOWUP_MAX_HOURS (jendela Cloud API), maka
 * dimajukan ke sesaat sebelum jam tutup. Lebih awal masih sopan; lewat jendela
 * 24 jam tidak terkirim.
 */
export function followupDueAt(lastInbound: number, key = ''): number {
  const spread = Math.max(0, cfg.followupAfterHoursMax - cfg.followupAfterHours);
  const wait = Math.round((cfg.followupAfterHours + fraction(`${key}:${lastInbound}`) * spread) * 60) * MINUTE;
  const cap = cfg.followupMaxHours ? lastInbound + cfg.followupMaxHours * HOUR - 10 * MINUTE : Infinity;
  // Di Cloud API, acakan pun tidak boleh membawa jadwal ke luar jendela layanan.
  const due = Math.min(lastInbound + wait, cap);
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
  // Bot dijeda untuk semua chat: tidak ada follow-up sama sekali.
  if (projectPaused()) return 0;
  const t = now();
  let sent = 0;

  for (const c of await followupCandidates()) {
    const due = followupDueAt(c.last_inbound_at, c.phone);
    if (t < due) continue;

    const skip =
      (await humanHolds(c.address, t))
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
      await updateContact(c.phone, { followup_state: 'idle' });
      continue;
    }

    // Ditulis untuk percakapan ini kalau bisa; kalau LLM mati atau jawabannya
    // ditolak pagar, kalimat tetap yang dipakai — follow-up tidak boleh batal.
    let text = followupText(contactName(c), missingFields(c));
    try {
      text = (await writer(c, (t - c.last_inbound_at) / HOUR)) ?? text;
      text = noDash(text);
    } catch (e) {
      console.error(`[follow-up] ${c.phone}: penulis gagal, pakai kalimat tetap: ${e instanceof Error ? e.message : e}`);
    }
    try {
      await send({ phone: c.phone, address: c.address }, text);
    } catch (e) {
      // Tetap 'pending': dicoba lagi di putaran berikutnya sampai masa tenggang habis.
      console.error(`[follow-up] ${c.phone}: gagal kirim: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    await addMessage(c.phone, 'out', text, t, null, 'followup');
    await updateContact(c.phone, {
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
