/**
 * Jam yang bisa digeser. Follow-up itu soal waktu, dan fitur soal waktu yang
 * cuma bisa diuji dengan menunggu 23 jam adalah fitur yang tidak diuji.
 */

import { cfg } from './config';

let fixed: number | null = null;
let offset = 0;

export const now = (): number => (fixed ?? Date.now()) + offset;

/** Tes: jam berhenti di titik ini. */
export function setNow(t: number): void {
  fixed = t;
  offset = 0;
}

/** Tes & mode latihan: maju sekian milidetik. */
export function advance(ms: number): void {
  offset += ms;
}

/** Menit sejak tengah malam, di zona waktu bot. */
export function localMinutes(ts: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function localStamp(ts: number): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: cfg.tz,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(ts));
}

export function localDay(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: cfg.tz }).format(new Date(ts));
}
