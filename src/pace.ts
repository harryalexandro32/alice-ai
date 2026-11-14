/**
 * Irama balasan: tidak instan, dan tidak pernah sama dua kali berturut-turut.
 *
 * Bot yang membalas dalam satu detik, setiap kali, dengan jeda yang persis
 * sama, adalah pola yang paling mudah dikenali sebagai mesin. Jadi tiap
 * balasan menunggu sekian detik yang diacak di antara batas yang diatur
 * pemilik (bawaan 8–30), dan "sedang mengetik…" baru muncul di beberapa detik
 * terakhir — seperti orang yang membaca dulu, baru mengetik.
 *
 * Ini mengurangi tanda-tanda otomatis; ini BUKAN jaminan tidak diblokir di
 * jalur tidak resmi.
 */

import { biz } from './business';

/** Pesan kedua dalam satu giliran (jawaban setelah salam, foto) menyusul cepat. */
const BURST_WINDOW_MS = 20_000;

const between = (min: number, max: number): number => min + Math.random() * (max - min);

/**
 * Berapa lama menunggu sebelum kiriman ini (milidetik).
 * `sinceLast` = jarak dari kiriman terakhir ke orang yang sama.
 */
export function pickDelayMs(sinceLast: number, previous: number | null): number {
  if (sinceLast < BURST_WINDOW_MS) return Math.round(between(2000, 5000));

  const min = biz.replyDelayMin * 1000;
  const max = biz.replyDelayMax * 1000;
  if (max <= min) return min;

  // Jangan sampai dua jeda berturut-turut hampir sama: ulangi undian kalau
  // jaraknya di bawah 15% rentang.
  let d = between(min, max);
  for (let i = 0; i < 5 && previous !== null && Math.abs(d - previous) < (max - min) * 0.15; i++) {
    d = between(min, max);
  }
  return Math.round(d);
}

/** Berapa detik terakhir dari jeda itu diisi "sedang mengetik…". */
export function typingMs(delay: number, textLength: number): number {
  const byLength = 1500 + Math.min(textLength, 400) * 15;
  return Math.min(delay, byLength);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const lastSentAt = new Map<string, number>();
let previousDelay: number | null = null;

/** Tunggu dengan irama manusia sebelum mengirim ke `key`. Mengembalikan lamanya menunggu (ms). */
export async function humanPause(key: string, textLength: number, startTyping: () => Promise<void>): Promise<number> {
  const delay = pickDelayMs(Date.now() - (lastSentAt.get(key) ?? 0), previousDelay);
  if (delay >= 6000) previousDelay = delay;

  const typing = typingMs(delay, textLength);
  await sleep(delay - typing);
  await startTyping().catch(() => {});
  await sleep(typing);

  lastSentAt.set(key, Date.now());
  if (lastSentAt.size > 5000) lastSentAt.delete(lastSentAt.keys().next().value as string);
  return delay;
}
