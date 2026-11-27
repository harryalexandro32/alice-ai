/**
 * Follow-up: satu pengingat kalau pelanggan diam. Ada dua pemicu:
 * - bot membalas atau bertanya, lalu pelanggan diam (`last_dir = 'out'`);
 * - admin manusia membalas, lalu pelanggan diam (`last_dir = 'human'`,
 *   `followupAfterHuman`). Jadwalnya dihitung dari pesan admin terakhir, dan
 *   sesudah pengingat itu bot tetap tidak ikut campur di chat tersebut.
 *
 * Ini SATU-SATUNYA pesan yang bot kirim tanpa dipicu pesan masuk, jadi di
 * sinilah risiko terbesar — kelihatan seperti spam, atau (di Cloud API) jatuh
 * di luar jendela layanan 24 jam dan ditolak. Karena itu aturannya sempit:
 * sekali per masa diam, ada batas seumur nomor, hanya di jam wajar, dan batal
 * begitu pelanggan bicara.
 */

import { followupBrain } from './brain';
import { llmEnabled } from './llm/provider';
import { cfg, HOUR, MINUTE } from './config';
import { localMinutes, now } from './clock';
import { contactName, humanHolds, missingFields, openForHumanFollowup, projectPaused, type Sender } from './flow';
import { biz } from './business';
import { inQuiet, quietEndAfter, quietStartBefore } from './quiet';
import { addMessage, followupCandidates, humanSeenAt, isBotOff, recentMessages, updateContact, type Contact } from './store';
import { followupEmoji, followupText, humanFollowupText, noDash } from './texts';

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
 *
 * Jadwal tidak pernah jatuh di jam tenang (quiet.ts): kalau jatuh di sana,
 * digeser ke akhir jam tenang, atau (kalau itu melewati jendela) dimajukan ke
 * sesaat sebelum jam tenang mulai.
 */
export function followupDueAt(lastInbound: number, key = ''): number {
  const due = windowDueAt(lastInbound, key);
  if (!inQuiet(due)) return due;
  const later = quietEndAfter(due);
  const limit = cfg.followupMaxHours ? lastInbound + cfg.followupMaxHours * HOUR - 10 * MINUTE : Infinity;
  if (later <= limit) return later;
  const earlier = quietStartBefore(due) - 5 * MINUTE;
  return earlier > lastInbound ? earlier : later;
}

/** Jadwal follow-up menurut jeda acak dan jam kirim (tanpa jam tenang). */
function windowDueAt(lastInbound: number, key: string): number {
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

/** Batas yang sama untuk kedua pemicu: terlambat, jendela 24 jam, batas per nomor. */
function limitSkip(c: Contact, t: number, due: number): string | null {
  return t > due + GRACE_MS
    ? 'sudah terlalu lama lewat'
    : cfg.followupMaxHours && t > c.last_inbound_at + cfg.followupMaxHours * HOUR
      ? 'di luar jendela 24 jam'
      : c.followup_total >= cfg.followupMaxTotal
        ? 'batas follow-up nomor ini tercapai'
        : null;
}

/** Kenapa follow-up setelah bot membalas dilewat; null = kirim. */
async function botSkip(c: Contact, t: number, due: number): Promise<string | null> {
  if (c.opted_out_at) return 'pelanggan minta tidak dihubungi';
  if (await humanHolds(c.address, t)) return 'sedang ditangani manusia';
  return limitSkip(c, t, due);
}

/**
 * Kenapa pengingat setelah admin membalas dilewat; null = kirim. Penahan
 * "admin membalas" (humanHolds) sengaja tidak dipakai: justru keadaan itulah
 * yang diingatkan. Tombol "Bot menjawab" yang dimatikan tetap menahannya.
 */
async function humanSkip(c: Contact, t: number, due: number, humanAt: number): Promise<string | null> {
  if (!humanAt) return 'bot sudah dinyalakan lagi di percakapan ini';
  if (c.opted_out_at) return 'pelanggan minta tidak dihubungi';
  if (!biz.followupAfterHuman) return 'follow-up setelah admin dimatikan';
  if (await isBotOff(c.address)) return 'bot dimatikan di percakapan ini';
  if (!openForHumanFollowup(c.stage)) return 'tahap prospek sudah lewat';
  return limitSkip(c, t, due);
}

/**
 * Follow-up setelah bot membalas: ditulis untuk percakapan ini kalau bisa;
 * kalau LLM mati atau jawabannya ditolak pagar, kalimat tetap yang dipakai —
 * follow-up tidak boleh batal. Tulisan LLM ditutup dengan tepat satu emoji,
 * seperti kalimat tetapnya.
 */
async function botText(c: Contact, t: number): Promise<string> {
  let text = followupText(contactName(c), missingFields(c));
  try {
    text = (await writer(c, (t - c.last_inbound_at) / HOUR)) ?? text;
    text = followupEmoji(noDash(text));
  } catch (e) {
    console.error(`[follow-up] ${c.phone}: penulis gagal, pakai kalimat tetap: ${e instanceof Error ? e.message : e}`);
  }
  return text;
}

/**
 * Kirim follow-up yang sudah waktunya, satu per satu. Di bot sungguhan (app.ts)
 * `send` memakai irama manusia: mikir singkat, "sedang mengetik…" sesuai
 * panjang pesannya, dan antre di belakang chat lain (lihat pace.ts).
 */
export async function runFollowups(send: Sender): Promise<number> {
  // Bot dijeda untuk semua chat: tidak ada follow-up sama sekali.
  if (projectPaused()) return 0;
  const t = now();
  // Jam tenang: tidak ada yang dikirim; yang sudah waktunya tetap menunggu putaran berikutnya.
  if (inQuiet(t)) return 0;
  let sent = 0;

  for (const c of await followupCandidates()) {
    // Pengingat setelah admin: dijadwalkan dari pesan admin terakhir. 0 = tanda
    // "admin membalas" sudah dilepas (bot dinyalakan lagi), jadi langsung dilewat.
    const human = c.last_dir === 'human';
    const humanAt = human ? await humanSeenAt(c.address) : 0;
    const due = human ? (humanAt ? followupDueAt(humanAt, c.phone) : 0) : followupDueAt(c.last_inbound_at, c.phone);
    if (t < due) continue;

    const skip = human ? await humanSkip(c, t, due, humanAt) : await botSkip(c, t, due);
    if (skip) {
      console.log(`[follow-up] ${c.phone}: dilewat (${skip})`);
      await updateContact(c.phone, { followup_state: 'idle' });
      continue;
    }

    // Setelah admin: kalimat tetap, tanpa LLM, karena admin yang memegang percakapannya.
    const text = human ? noDash(humanFollowupText(contactName(c))) : await botText(c, t);
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
    console.log(`[follow-up] ${c.phone}: terkirim${human ? ' (setelah admin)' : ''}`);
    sent += 1;
  }
  return sent;
}
