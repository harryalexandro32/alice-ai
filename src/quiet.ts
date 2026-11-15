/**
 * Jam tenang: rentang jam (zona waktu bot) saat bot tidak membalas.
 *
 * Admin manusia jarang membalas chat pukul 02.00, dan nomor yang aktif
 * mengirim sepanjang malam adalah pola yang mudah dikenali sebagai mesin.
 * Pesan yang masuk di jam tenang tetap dicatat; balasannya ditunda sampai jam
 * tenang berakhir (lihat flow.ts: handleInbound dan runDeferredTurn), dan
 * follow-up tidak pernah dijadwalkan di dalamnya (followup.ts).
 *
 * Diatur per proyek: quietEnabled, quietStartHour, quietEndHour. Rentang yang
 * melewati tengah malam (mis. 22 sampai 6) juga dimengerti, walau dashboard
 * hanya menerima jam selesai yang lebih besar dari jam mulai.
 */

import { localMinutes } from './clock';
import { cfg, MINUTE } from './config';

const DAY_MIN = 24 * 60;

/** [mulai, selesai) dalam menit sejak tengah malam; null = jam tenang mati. */
function span(): [number, number] | null {
  if (!cfg.quietEnabled) return null;
  const start = cfg.quietStartHour * 60;
  const end = cfg.quietEndHour * 60;
  return start === end ? null : [start, end];
}

/** Waktu `at` jatuh di jam tenang proyek ini. */
export function inQuiet(at: number): boolean {
  const s = span();
  if (!s) return false;
  const m = localMinutes(at);
  return s[0] < s[1] ? m >= s[0] && m < s[1] : m >= s[0] || m < s[1];
}

/** Kapan jam tenang yang sedang berlangsung di `at` berakhir (tepat di awal menitnya). `at` sendiri kalau tidak sedang tenang. */
export function quietEndAfter(at: number): number {
  const s = span();
  if (!s || !inQuiet(at)) return at;
  const m = localMinutes(at);
  const wait = m < s[1] ? s[1] - m : DAY_MIN - m + s[1];
  return at - (at % MINUTE) + wait * MINUTE;
}

/** Kapan jam tenang yang sedang berlangsung di `at` dimulai (tepat di awal menitnya). `at` sendiri kalau tidak sedang tenang. */
export function quietStartBefore(at: number): number {
  const s = span();
  if (!s || !inQuiet(at)) return at;
  const m = localMinutes(at);
  const back = m >= s[0] ? m - s[0] : m + DAY_MIN - s[0];
  return at - (at % MINUTE) - back * MINUTE;
}
