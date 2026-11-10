/**
 * Alur percakapan: pesan masuk -> balasan keluar.
 *
 * Tidak tahu apa-apa soal WhatsApp. Yang mengirim adalah fungsi `send` yang
 * dipasang dari luar (Baileys, Cloud API, CLI latihan, atau tes), jadi pindah
 * jalur WhatsApp tidak menyentuh file ini.
 */

import { checkReply, llmBrain, type Brain, type BrainResult } from './brain';
import { cfg, HOUR } from './config';
import { now } from './clock';
import { deliverOutbox } from './sinks/outbox';
import {
  addMessage, contactByAddress, countInboundSince, createContact, getContact, outboxAdd,
  pausedUntil, recentMessages, setPause, updateContact, type Contact,
} from './store';
import { askMissing, GREETING, HANDOFF, NON_TEXT, type LeadField } from './texts';

export type Sender = (to: { phone: string; address: string }, text: string) => Promise<void>;

let send: Sender = async () => {};
let brain: Brain = llmBrain;

export function setSender(fn: Sender): void {
  send = fn;
}
export function setBrain(fn: Brain): void {
  brain = fn;
}

export interface Inbound {
  phone: string;
  address: string;
  /** Null = pesan bukan teks (gambar, stiker, suara). */
  text: string | null;
  waId?: string | null;
}

export function missingFields(c: Pick<Contact, 'name' | 'city' | 'need'>): LeadField[] {
  return (['name', 'city', 'need'] as const).filter((f) => !c[f]);
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

function leadPayload(c: Contact, kind: string, lastMessage: string) {
  return {
    lastMessage: lastMessage.slice(0, 300),
    kind,
    at: now(),
    phone: c.phone,
    name: c.name,
    city: c.city,
    need: c.need,
    wantsPrice: Boolean(c.wants_price),
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

export async function handleInbound(m: Inbound): Promise<void> {
  // Nomor sales itu penerima notifikasi, bukan calon pembeli.
  if (cfg.salesNumbers.includes(m.phone)) return;

  const at = now();
  const existing = getContact(m.phone);
  const stored = m.text?.trim() || '[bukan teks]';

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

  if (pausedUntil(m.address) > at) {
    console.log(`[alur] ${m.phone}: sedang ditangani manusia, bot diam`);
    return;
  }
  if (countInboundSince(m.phone, at - 24 * HOUR) > cfg.maxInboundPerNumber) {
    console.log(`[alur] ${m.phone}: lewat jatah harian, bot diam`);
    return;
  }

  const isNew = !existing;
  if (isNew) c = await reply(c, GREETING);

  const text = m.text?.trim();
  if (!text) {
    // Jangan mengulang pemberitahuan yang sama untuk tiap stiker beruntun.
    if (c.last_out_text !== NON_TEXT && !isNew) c = await reply(c, NON_TEXT);
    updateContact(c.phone, { followup_state: awaitsCustomer(c) ? 'pending' : 'idle' });
    return;
  }

  if (!(isNew && bareGreeting(text))) {
    // Untuk kontak lama, entri terakhir adalah pesan yang baru saja dicatat.
    const history = isNew ? [] : recentMessages(c.phone, 12).slice(0, -1);
    let result: BrainResult | null = null;
    try {
      result = await brain({
        text,
        known: { name: c.name, city: c.city, need: c.need },
        history,
        justGreeted: isNew,
      });
    } catch (e) {
      console.error(`[alur] otak gagal: ${e instanceof Error ? e.message : e}`);
    }

    // Data lead: nilai baru menggantikan, kosong tidak pernah menghapus.
    if (result) {
      c = updateContact(c.phone, {
        name: result.name ?? c.name,
        city: result.city ?? c.city,
        need: result.need ?? c.need,
        wants_price: c.wants_price || result.intent === 'price' ? 1 : 0,
      });
    }

    let out = result?.reply ?? null;
    let handoff = result?.intent === 'price' || result?.intent === 'human';

    // Yang dihitung "ditanyakan pelanggan": pesan ini dan pesan-pesannya yang baru lalu.
    const asked = [text, ...history.filter((t) => t.dir === 'in').map((t) => t.text)].join('\n');
    const rejected = out ? checkReply(out, asked) : null;
    if (rejected) {
      console.error(`[alur] ${c.phone}: balasan dibuang (${rejected})`);
      out = null;
    }
    if (!out) {
      // Tanpa jawaban dari LLM: minta data yang kurang, atau serahkan ke sales.
      const missing = missingFields(c);
      if (missing.length && !isNew) {
        out = askMissing(missing);
      } else if (missing.length) {
        out = null; // salam yang baru dikirim sudah memintanya
      } else {
        out = HANDOFF;
      }
      handoff = true;
    }
    if (out) c = await reply(c, out);

    // Lead lengkap -> kabari sales sekali. Minta harga/orang sebelum lengkap ->
    // kabari juga sekali, dengan data seadanya, supaya tidak ada yang menunggu.
    const complete = missingFields(c).length === 0;
    if (complete && !c.lead_sent_at) {
      const p = leadPayload(c, 'Lead lengkap', text);
      outboxAdd('sales', p, at);
      outboxAdd('sheet', p, at);
      c = updateContact(c.phone, { lead_sent_at: at });
    } else if (handoff && !c.handoff_sent_at) {
      const p = leadPayload(c, result?.intent === 'human' ? 'Minta dihubungi' : 'Perlu dibantu sales', text);
      outboxAdd('sales', p, at);
      outboxAdd('sheet', p, at);
      c = updateContact(c.phone, { handoff_sent_at: at });
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
  const c = contactByAddress(m.address);
  if (c) {
    addMessage(c.phone, 'human', m.text || '[bukan teks]', at);
    updateContact(c.phone, { last_dir: 'human', followup_state: 'idle' });
  }
  console.log(`[alur] ${c?.phone ?? m.address}: dibalas manusia, bot diam ${cfg.humanPauseHours} jam`);
}
