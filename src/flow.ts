/**
 * Alur percakapan: pesan masuk -> balasan keluar.
 *
 * Tidak tahu apa-apa soal WhatsApp maupun soal bisnisnya. Yang mengirim adalah
 * fungsi `send` yang dipasang dari luar (Baileys, Cloud API, CLI latihan, atau
 * tes); salam, data yang dikumpulkan, dan pengetahuannya datang dari profil
 * bisnis.
 */

import { checkReply, llmBrain, type Brain, type BrainResult } from './brain';
import { join } from 'node:path';

import { ALERT_TITLES, raiseAlert } from './alerts';
import { biz, fileById, mediaDir, productOfFile, refreshBiz } from './business';
import type { LeadField } from './business/types';
import { cfg, HOUR, MINUTE } from './config';
import { now } from './clock';
import { llmEnabled } from './llm/provider';
import { deliverExternal, recipientPhones } from './notify';
import { deliverOutbox, salesText, type LeadPayload } from './sinks/outbox';
import {
  addMessage, contactByAddress, countInboundSince, createContact, getContact, humanSeenAt, isBotOff, markHuman,
  markSwitchApplied, outboxAdd, pausedUntil, recentMessages, releaseToBot, setBotOff, setPause, switchAppliedAt,
  updateContact, type Contact,
} from './store';
import { askMissing, handoffText, mediaAck, NON_TEXT } from './texts';
import type { MediaKind } from './transport/types';

/** `image` = path file foto atau PDF; kalau ada, `text` menjadi keterangannya. */
export type Sender = (to: { phone: string; address: string }, text: string, image?: string, fileName?: string) => Promise<void>;

let send: Sender = async () => {};
let brain: Brain = llmBrain;
/** Dijalankan sebelum tiap giliran — dipakai untuk menarik profil terbaru. */
let beforeTurn: () => Promise<void> = async () => {};

export function setSender(fn: Sender): void {
  send = fn;
}
export function setBrain(fn: Brain): void {
  brain = fn;
}
export function setBeforeTurn(fn: () => Promise<void>): void {
  beforeTurn = fn;
}

/** Berkas yang sama paling banyak sekian kali per pelanggan dalam riwayat terakhirnya. */
const MAX_SAME_FILE = 3;
const ATTACH_FAILED = 'Mohon maaf, berkasnya belum berhasil terkirim dari sini 🙏 Tim kami yang akan mengirimkannya ya.';

export interface Inbound {
  phone: string;
  address: string;
  /** Null = pesan bukan teks (gambar, stiker, suara). */
  text: string | null;
  waId?: string | null;
  /** Pesannya membawa foto, suara, dsb. */
  media?: MediaKind;
  /** Untuk foto: unduh isinya supaya bisa diamati LLM. */
  fetchMedia?: () => Promise<{ data: Buffer; mime: string } | null>;
}

export function missingFields(c: Pick<Contact, 'lead'>): LeadField[] {
  return biz.leadFields.filter((f) => !c.lead[f.key]);
}

/** Nama orangnya, kalau profil punya field nama dan sudah terisi. */
export function contactName(c: Pick<Contact, 'lead'>): string | null {
  const f = biz.leadFields.find((x) => x.isName);
  return (f && c.lead[f.key]) || null;
}

/** Sapaan kosong: cukup dibalas salam, tidak perlu memanggil LLM. */
function bareGreeting(text: string): boolean {
  return (
    text.length <= 30 &&
    /^(p+|halo+|hallo+|hai+|hi+|hello+|helo+|pagi|siang|sore|malam|selamat (pagi|siang|sore|malam)|permisi|misi|ass?alam\S*( ?wr\.? ?wb\.?| ?alaikum\S*)?|info|min|admin|kak|gan|bos|tes|test)[\s!.,?🙏]*$/i.test(
      text.trim()
    )
  );
}

async function reply(c: Contact, text: string): Promise<Contact> {
  await send({ phone: c.phone, address: c.address }, text);
  addMessage(c.phone, 'out', text, now());
  return updateContact(c.phone, { last_dir: 'out', last_out_text: text });
}

function leadPayload(c: Contact, kind: string, lastMessage: string): LeadPayload {
  return {
    kind,
    at: now(),
    phone: c.phone,
    fields: biz.leadFields.map((f) => [f.label, c.lead[f.key] ?? null]),
    needsSales: Boolean(c.needs_sales),
    lastMessage: lastMessage.slice(0, 300),
  };
}

/**
 * Perlu di-follow-up kalau pelanggan diam? Hanya kalau memang ada yang
 * ditunggu darinya: datanya belum lengkap, atau bot baru saja bertanya.
 * Percakapan yang sudah ditutup ("sama-sama 🙏") tidak dikejar.
 */
function awaitsCustomer(c: Contact): boolean {
  if (c.followup_total >= cfg.followupMaxTotal) return false;
  return missingFields(c).length > 0 || Boolean(c.last_out_text?.includes('?'));
}

/**
 * Apakah chat ini sedang dipegang admin manusia? Dengan `stopAfterHuman`,
 * sekali admin membalas, bot tidak ikut campur lagi; tanpa itu, bot hanya diam
 * selama HUMAN_PAUSE_HOURS.
 */
export function humanHolds(address: string, at: number): boolean {
  return isBotOff(address) || pausedUntil(address) > at || (biz.stopAfterHuman && humanSeenAt(address) > 0);
}

/** Kenapa bot diam di chat ini, untuk ditampilkan di dashboard; null = bot aktif. */
export function holdReason(address: string, at: number): 'tombol' | 'admin' | null {
  return isBotOff(address) ? 'tombol' : humanHolds(address, at) ? 'admin' : null;
}

/**
 * Jalankan perintah tombol "bot aktif / diam" dari dashboard (halaman Lead).
 * Tiap perintah dijalankan sekali: menyalakan = melepas semua penahan saat itu
 * (kalau admin membalas lagi nanti, bot mundur lagi); mematikan = diam sampai
 * dinyalakan lagi.
 */
export function applyBotSwitches(): void {
  for (const [phone, sw] of Object.entries(biz.botSwitch)) {
    if (sw.at <= switchAppliedAt(phone)) continue;
    const c = getContact(phone);
    if (!c) continue;
    if (sw.mode === 'off') setBotOff(c.address, sw.at);
    else releaseToBot(c.address);
    markSwitchApplied(phone, sw.at);
    console.log(`[alur] ${phone}: bot ${sw.mode === 'off' ? 'DIMATIKAN' : 'DINYALAKAN lagi'} untuk chat ini lewat dashboard`);
  }
}

/** Foto di atas ukuran ini tidak dikirim ke LLM. */
const MAX_IMAGE_BYTES = 6_000_000;
/** Ada otak yang bisa dipanggil: LLM sungguhan, atau tiruan yang dipasang tes. */
const hasBrain = (): boolean => brain !== llmBrain || llmEnabled();

/** Jarak minimum antar kabar "butuh staf" untuk pelanggan yang sama. */
const STAFF_NOTIFY_GAP = 30 * MINUTE;

/**
 * Kabari staf bahwa pelanggan ini menunggu manusia: notifikasi WA + baris Sheet
 * (lewat antrean) dan peringatan di dashboard. Tidak diulang tiap pesan.
 */
function notifyStaff(c: Contact, kind: string, lastMessage: string, at: number): Contact {
  if (c.handoff_sent_at && at - c.handoff_sent_at < STAFF_NOTIFY_GAP) return c;
  const p = leadPayload(c, kind, lastMessage);
  outboxAdd('sales', p, at);
  outboxAdd('sheet', p, at);
  // WhatsApp-nya sudah lewat antrean di atas; di sini hanya dashboard + Telegram.
  raiseAlert('butuh-staf', `${kind}: ${contactName(c) ?? c.phone} (${c.phone}) — "${lastMessage.slice(0, 200)}"`, { key: c.phone, whatsapp: false });
  return updateContact(c.phone, { handoff_sent_at: at });
}

export async function handleInbound(m: Inbound): Promise<void> {
  // Pemilik mungkin baru menyimpan perubahan lewat dashboard.
  await beforeTurn();
  refreshBiz();
  applyBotSwitches();
  // Pemilik dan staf itu penerima notifikasi, bukan calon pelanggan.
  if (recipientPhones().has(m.phone)) return;
  // Mode uji: selain nomor yang didaftarkan, tidak ada yang dibalas maupun
  // dicatat — pelanggan sungguhan di nomor itu tidak boleh ikut jadi bahan uji.
  if (cfg.onlyNumbers.length && !cfg.onlyNumbers.includes(m.phone)) {
    console.log(`[alur] ${m.phone}: di luar ONLY_NUMBERS, dilewat`);
    return;
  }

  const at = now();
  const existing = getContact(m.phone);
  const caption = m.text?.trim() || '';
  const stored = m.media ? `[${m.media}]${caption ? ` ${caption}` : ''}` : caption || '[bukan teks]';

  let c = existing ?? createContact(m.phone, m.address, at);
  if (!addMessage(m.phone, 'in', stored, at, m.waId)) {
    console.log(`[alur] ${m.phone}: pesan ganda, dilewat`);
    return;
  }
  // Pelanggan membalas: siklus follow-up yang sedang menunggu selesai.
  c = updateContact(m.phone, {
    address: m.address,
    last_inbound_at: at,
    last_dir: 'in',
    followup_state: 'idle',
  });

  if (humanHolds(m.address, at)) {
    console.log(`[alur] ${m.phone}: sedang ditangani manusia, bot diam`);
    return;
  }
  if (countInboundSince(m.phone, at - 24 * HOUR) > cfg.maxInboundPerNumber) {
    console.log(`[alur] ${m.phone}: lewat jatah harian, bot diam`);
    return;
  }

  const isNew = !existing;
  if (isNew) c = await reply(c, biz.greeting);

  const text = m.text?.trim();
  // Foto, suara, dokumen, lokasi, kontak: bot tidak bisa melihat atau
  // mendengarnya, tapi staf bisa — jadi staf dikabari, dan pelanggan diberi tahu
  // bahwa kirimannya diterima. Stiker hanya basa-basi: tidak dibalas.
  const media = m.media && m.media !== 'stiker' ? m.media : null;
  // Foto diamati LLM (kalau dinyalakan dan fotonya berhasil diunduh); dengan
  // begitu bot bisa langsung menjawab dan staf tidak perlu dikabari.
  let image: { data: Buffer; mime: string } | null = null;
  if (media === 'foto' && m.fetchMedia && cfg.llmVision && hasBrain()) {
    try {
      const got = await m.fetchMedia();
      if (got && got.data.length <= MAX_IMAGE_BYTES) image = got;
      else if (got) console.log(`[alur] ${m.phone}: foto terlalu besar untuk dianalisis (${Math.round(got.data.length / 1e6)} MB)`);
    } catch (e) {
      console.error(`[alur] ${m.phone}: foto gagal diunduh: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (media && !image) {
    c = updateContact(c.phone, { needs_sales: 1 });
    c = notifyStaff(c, `Kirim ${media}`, stored, at);
  }
  if (!text && !image) {
    if (media) {
      const ack = mediaAck(media);
      if (c.last_out_text !== ack) c = await reply(c, ack);
    } else if (m.media !== 'stiker' && c.last_out_text !== NON_TEXT && !isNew) {
      // Jangan mengulang pemberitahuan yang sama untuk tiap pesan beruntun.
      c = await reply(c, NON_TEXT);
    }
    updateContact(c.phone, { followup_state: awaitsCustomer(c) ? 'pending' : 'idle' });
    void deliverOutbox().catch((e) => console.error('[outbox]', e));
    return;
  }

  // Foto tanpa keterangan: tetap ada yang harus dijawab, yaitu fotonya.
  const said = text || 'Pelanggan mengirim foto tanpa keterangan.';
  if (!(isNew && text && bareGreeting(text))) {
    // Untuk kontak lama, entri terakhir adalah pesan yang baru saja dicatat.
    const history = isNew ? [] : recentMessages(c.phone, 12).slice(0, -1);
    let result: BrainResult | null = null;
    try {
      result = await brain({
        text: said, known: c.lead, history, justGreeted: isNew, summary: c.summary,
        ...(image
          ? { image, note: 'Pelanggan melampirkan foto, ikut di pesan ini. Amati fotonya (lihat FOTO DARI PELANGGAN) lalu jawab.' }
          : media
            ? { note: `Pelanggan melampirkan ${media} yang TIDAK bisa kamu lihat. Jangan mengomentari isinya; sampaikan bahwa tim kami yang akan mengeceknya, lalu jawab teksnya.` }
            : {}),
      });
    } catch (e) {
      console.error(`[alur] otak gagal: ${e instanceof Error ? e.message : e}`);
    }

    // Data lead: nilai baru menggantikan, kosong tidak pernah menghapus.
    if (result) {
      c = updateContact(c.phone, {
        lead: { ...c.lead, ...result.fields },
        needs_sales: c.needs_sales || result.intent === 'handoff' ? 1 : 0,
        ...(result.summary ? { summary: result.summary } : {}),
      });
    }

    let out = result?.reply ?? null;
    let handoff = result?.intent === 'handoff' || result?.intent === 'human';

    // Yang dihitung "ditanyakan pelanggan": pesan ini dan pesan-pesannya yang baru lalu.
    const asked = [said, ...history.filter((t) => t.dir === 'in').map((t) => t.text)].join('\n');
    const rejected = out ? checkReply(out, asked) : null;
    if (rejected) {
      console.error(`[alur] ${c.phone}: balasan dibuang (${rejected})`);
      out = null;
    }
    if (!out) {
      // Tanpa jawaban dari LLM: minta data yang kurang, atau serahkan ke manusia.
      const missing = missingFields(c);
      if (missing.length && !isNew) {
        out = askMissing(missing);
      } else if (missing.length) {
        out = null; // salam yang baru dikirim sudah memintanya
      } else {
        out = handoffText();
      }
      handoff = true;
    }
    if (out) c = await reply(c, out);

    // Lampiran (foto, PDF) hanya menyertai balasan LLM yang lolos pagar.
    //
    // Kapan sebuah berkas dikirim ulang diputuskan LLM (ia melihat catatan
    // "[pdf:…]" di riwayat dan diminta tidak mengulang kecuali diminta). Kode
    // di sini hanya rem darurat: dulu ia menahan SEMUA kiriman ulang, sehingga
    // bot bilang "saya lampirkan" padahal tidak ada yang terkirim.
    if (result && !rejected) {
      const outs = recentMessages(c.phone, 40).filter((t) => t.dir === 'out').map((t) => t.text);
      let failed = false;
      for (const [kind, id] of [...result.photos.map((x) => ['foto', x] as const), ...result.docs.map((x) => ['pdf', x] as const)]) {
        const f = fileById(id);
        if (!f) continue;
        // Satu PDF bisa dipakai banyak produk, jadi ia dikirim dengan namanya
        // sendiri — bukan nama produk pertama yang kebetulan memakainya.
        const label = kind === 'pdf' ? f.name.replace(/\.pdf$/i, '') : (productOfFile(id) ?? f.name);
        const mark = `[${kind}:${id}] ${label}`;
        if (outs.filter((t) => t.startsWith(`[${kind}:${id}]`)).length >= MAX_SAME_FILE) {
          console.log(`[alur] ${c.phone}: ${kind} ${id} sudah ${MAX_SAME_FILE} kali terkirim, tidak diulang`);
          continue;
        }
        try {
          const fileName = kind === 'pdf' ? `${label.replace(/[^\w .()+-]+/g, ' ').trim() || 'brosur'}.pdf` : undefined;
          await send({ phone: c.phone, address: c.address }, label, join(mediaDir(), f.file), fileName);
          addMessage(c.phone, 'out', mark, now());
          console.log(`[alur] ${c.phone}: ${kind} terkirim — ${label}`);
        } catch (e) {
          failed = true;
          console.error(`[alur] ${c.phone}: ${kind} ${id} gagal terkirim: ${e instanceof Error ? e.message : e}`);
        }
      }
      // Balasannya sudah berjanji melampirkan: kalau gagal, katakan terus terang.
      if (failed) {
        c = await reply(c, ATTACH_FAILED).catch(() => c);
        handoff = true;
      }
    }

    // Lead lengkap -> kabari sekali. Butuh manusia sebelum lengkap -> kabari
    // juga sekali, dengan data seadanya, supaya tidak ada yang menunggu.
    const complete = missingFields(c).length === 0;
    if (complete && !c.lead_sent_at) {
      const p = leadPayload(c, 'Lead lengkap', said);
      outboxAdd('sales', p, at);
      outboxAdd('sheet', p, at);
      // WhatsApp lewat antrean di atas; email dan Telegram langsung.
      void deliverExternal('lead', `🔔 ${ALERT_TITLES.lead} — ${biz.brand}`, salesText(p));
      c = updateContact(c.phone, { lead_sent_at: at });
    } else if (handoff) {
      // Bot tidak bisa menjawab sendiri (di luar pengetahuannya, pelanggan minta
      // orang, atau balasannya ditolak pagar): staf dikabari, dengan pertanyaannya.
      c = notifyStaff(c, result?.intent === 'human' ? 'Minta dihubungi' : 'Bot tidak bisa menjawab — perlu dibantu', said, at);
    }
  }

  updateContact(c.phone, { followup_state: awaitsCustomer(c) ? 'pending' : 'idle' });
  void deliverOutbox().catch((e) => console.error('[outbox]', e));
}

/**
 * Pemilik membalas sendiri dari HP. Bot mundur untuk kontak ini, dan follow-up
 * yang sedang menunggu batal — manusia yang sekarang memegang percakapannya.
 */
export function handleHumanReply(m: { address: string; text: string }): void {
  const at = now();
  setPause(m.address, at + cfg.humanPauseHours * HOUR);
  markHuman(m.address, at);
  const c = contactByAddress(m.address);
  if (c) {
    addMessage(c.phone, 'human', m.text || '[bukan teks]', at);
    updateContact(c.phone, { last_dir: 'human', followup_state: 'idle' });
  }
  console.log(`[alur] ${c?.phone ?? m.address}: dibalas manusia, bot ${biz.stopAfterHuman ? 'tidak ikut campur lagi di chat ini' : `diam ${cfg.humanPauseHours} jam`}`);
}
