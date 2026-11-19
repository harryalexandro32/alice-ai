/**
 * Membaca isi pesan Baileys (WhatsApp Web): teks, jenis lampiran, dan pesan
 * yang dikutip (fitur "balas"). Tanpa koneksi dan tanpa pustaka Baileys, jadi
 * bisa dites langsung.
 */

import type { MediaKind, Quote } from './types';

export function textOf(msg: Record<string, unknown> | null | undefined): string | null {
  if (!msg) return null;
  const m = msg as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    ephemeralMessage?: { message?: Record<string, unknown> };
    viewOnceMessage?: { message?: Record<string, unknown> };
  };
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  for (const inner of unwrap(msg)) return textOf(inner);
  // Keterangan yang diketik bersama foto / video / dokumen.
  const cap = msg as Record<string, { caption?: string } | undefined>;
  return cap.imageMessage?.caption || cap.videoMessage?.caption || cap.documentMessage?.caption || null;
}

/** Pesan yang dibungkus (pesan sementara, sekali lihat, dokumen berketerangan). */
export function unwrap(msg: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const k of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
    const inner = (msg[k] as { message?: Record<string, unknown> } | undefined)?.message;
    if (inner) out.push(inner);
  }
  return out;
}

const MEDIA: Record<string, MediaKind> = {
  imageMessage: 'foto', videoMessage: 'video', ptvMessage: 'video', audioMessage: 'suara', documentMessage: 'dokumen',
  stickerMessage: 'stiker', locationMessage: 'lokasi', liveLocationMessage: 'lokasi', contactMessage: 'kontak', contactsArrayMessage: 'kontak',
};

export function mediaOf(msg: Record<string, unknown> | null | undefined): MediaKind | undefined {
  if (!msg) return undefined;
  for (const k of Object.keys(msg)) if (MEDIA[k]) return MEDIA[k];
  for (const inner of unwrap(msg)) {
    const found = mediaOf(inner);
    if (found) return found;
  }
  return undefined;
}

interface ContextInfo {
  stanzaId?: string;
  participant?: string;
  quotedMessage?: Record<string, unknown>;
}

/** contextInfo yang membawa pesan kutipan, di jenis pesan apa pun (teks, foto berketerangan, …). */
function contextOf(msg: Record<string, unknown>): ContextInfo | undefined {
  for (const v of Object.values(msg)) {
    const ctx = v && typeof v === 'object' ? (v as { contextInfo?: ContextInfo }).contextInfo : undefined;
    if (ctx?.quotedMessage) return ctx;
  }
  for (const inner of unwrap(msg)) {
    const ctx = contextOf(inner);
    if (ctx) return ctx;
  }
  return undefined;
}

/** Bagian pengguna sebuah JID: "6281…:2@s.whatsapp.net" dan "2644…@lid" -> angkanya saja. */
const userOf = (jid: string): string => jid.split('@')[0]?.split(':')[0] ?? '';

/**
 * Pesan yang dikutip pelanggan saat membalas, atau undefined. `ours` = JID akun
 * bot sendiri (nomor dan LID), `sentIds` = id pesan yang baru dikirim bot.
 * Pengirim kutipan: dari `participant` (JID pengirim pesan yang dikutip), atau
 * dari id-nya kalau `participant` kosong; null kalau tidak bisa dipastikan.
 */
export function quoteOf(
  msg: Record<string, unknown> | null | undefined, ours: readonly (string | null | undefined)[], sentIds?: ReadonlySet<string>
): Quote | undefined {
  if (!msg) return undefined;
  const ctx = contextOf(msg);
  if (!ctx?.quotedMessage) return undefined;
  const q = ctx.quotedMessage;
  const doc = (q.documentMessage as { fileName?: string } | undefined)?.fileName;
  const text = (textOf(q) ?? doc ?? '').trim().slice(0, 1000);
  const media = mediaOf(q);
  const me = new Set(ours.filter((x): x is string => Boolean(x)).map(userOf));
  const by = ctx.participant
    ? (me.has(userOf(ctx.participant)) ? 'us' : 'customer')
    : ctx.stanzaId && sentIds?.has(ctx.stanzaId) ? 'us' : null;
  return { text, by, ...(media ? { media } : {}) };
}
