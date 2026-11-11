/**
 * Pengaman nomor untuk jalur Baileys: bot menahan diri sebelum WhatsApp yang
 * menahannya.
 *
 * Isinya hanya pembatasan perilaku — batas kiriman, jeda setelah tanda bahaya,
 * dan mundur teratur saat sambungan bermasalah. Idenya diambil dari pustaka
 * baileys-antiban, ditulis ulang di sini; bagian pustaka itu yang menyamarkan
 * identitas (perangkat palsu, proxy, variasi teks, aktivitas palsu) SENGAJA
 * tidak diambil. Tidak ada kode yang bisa menjamin nomor tidak diblokir: jalur
 * yang benar-benar aman adalah Cloud API resmi.
 *
 * Angka bawaannya mengikuti preset "conservative" pustaka itu; kode putus dan
 * artinya belum diuji terhadap pemblokiran sungguhan.
 */

import { cfg, HOUR, MINUTE } from '../config';

const DAY = 24 * HOUR;

let clock: () => number = Date.now;
/** Tes: ganti jam. */
export function setGuardClock(fn: () => number): void {
  clock = fn;
}

/** Waktu tiap kiriman dalam 24 jam terakhir. */
let sent: number[] = [];
let failures: number[] = [];
let disconnects: number[] = [];
let pausedUntil = 0;
let pauseReason = '';
let openedAt = 0;

export function resetGuard(): void {
  sent = [];
  failures = [];
  disconnects = [];
  pausedUntil = 0;
  pauseReason = '';
  openedAt = 0;
}

const within = (list: number[], ms: number): number => {
  const from = clock() - ms;
  return list.filter((t) => t > from).length;
};

let onPause: ((text: string) => void) | null = null;
/** Dipasang app.ts: pemilik perlu tahu kalau bot berhenti mengirim. */
export function setGuardListener(fn: ((text: string) => void) | null): void {
  onPause = fn;
}

function pause(ms: number, reason: string): void {
  const until = clock() + ms;
  if (until <= pausedUntil) return;
  pausedUntil = until;
  pauseReason = reason;
  onPause?.(`Bot berhenti mengirim selama ${Math.round(ms / MINUTE)} menit: ${reason}. Pelanggan yang chat selama itu tidak dibalas bot.`);
  console.error(`[pengaman] kiriman DIJEDA ${Math.round(ms / MINUTE)} menit: ${reason}`);
}

export class GuardBlocked extends Error {}

/**
 * Dipanggil sebelum tiap kiriman. Mengembalikan berapa lama harus menunggu
 * dulu (ms), atau melempar GuardBlocked kalau kiriman ini tidak boleh keluar.
 */
export function beforeSend(): number {
  const t = clock();
  if (t < pausedUntil) {
    throw new GuardBlocked(`kiriman dijeda sampai ${new Date(pausedUntil).toLocaleTimeString('id-ID')} (${pauseReason})`);
  }
  sent = sent.filter((x) => x > t - DAY);
  if (sent.length >= cfg.waMaxPerDay) throw new GuardBlocked(`batas ${cfg.waMaxPerDay} kiriman per 24 jam tercapai`);
  if (within(sent, HOUR) >= cfg.waMaxPerHour) throw new GuardBlocked(`batas ${cfg.waMaxPerHour} kiriman per jam tercapai`);

  let wait = 0;
  // Batas per menit tidak menolak, hanya mengantre: tunggu sampai kiriman
  // tertua di menit ini keluar dari jendela.
  const lastMinute = sent.filter((x) => x > t - MINUTE);
  if (lastMinute.length >= cfg.waMaxPerMinute) {
    wait = (lastMinute[lastMinute.length - cfg.waMaxPerMinute] as number) + MINUTE - t;
  }
  // Baru tersambung lagi: mulai pelan, jangan langsung menumpahkan antrean.
  if (openedAt && t - openedAt < MINUTE) {
    const last = sent[sent.length - 1] ?? 0;
    wait = Math.max(wait, last + 5000 - t);
  }
  return Math.max(0, wait);
}

export function afterSend(): void {
  sent.push(clock());
}

const codeOf = (e: unknown): number | undefined => {
  const x = e as { output?: { statusCode?: number }; data?: number | { code?: number }; status?: number } | undefined;
  const n = x?.output?.statusCode ?? (typeof x?.data === 'number' ? x.data : x?.data?.code) ?? x?.status;
  return typeof n === 'number' ? n : undefined;
};

/** Kiriman gagal. Tanda pembatasan dari WhatsApp = berhenti dulu, bukan coba lagi. */
export function onSendError(e: unknown): void {
  const text = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  const code = codeOf(e);
  if (code === 429 || text.includes('rate-overlimit')) return pause(4 * HOUR, 'WhatsApp menolak karena terlalu sering mengirim (429)');
  if (code === 463 || text.includes('reachout')) return pause(HOUR, 'WhatsApp membatasi kiriman dari nomor ini (463)');
  failures.push(clock());
  failures = failures.filter((x) => x > clock() - HOUR);
  if (failures.length >= 5) pause(30 * MINUTE, '5 kiriman gagal dalam satu jam');
}

/**
 * Sambungan putus. Mengembalikan jeda minimum sebelum menyambung lagi (ms);
 * pemanggil tetap memakai jeda bertingkatnya sendiri kalau itu lebih lama.
 */
export function onDisconnect(code: number | undefined): number {
  const t = clock();
  if (code === 403) {
    pause(6 * HOUR, 'WhatsApp menolak sambungan (403) — periksa nomor ini di HP sebelum lanjut');
    return 5 * MINUTE;
  }
  if (code === 429) {
    pause(4 * HOUR, 'WhatsApp membatasi sambungan (429)');
    return 5 * MINUTE;
  }
  // 515 = WhatsApp minta sambungan diulang (biasa setelah pairing): bukan tanda bahaya.
  if (code !== 515) {
    disconnects.push(t);
    disconnects = disconnects.filter((x) => x > t - HOUR);
    if (disconnects.length >= 4) pause(30 * MINUTE, `sambungan putus ${disconnects.length} kali dalam satu jam`);
  }
  return code === 503 ? MINUTE : 0;
}

export function onOpen(): void {
  openedAt = clock();
}

/** Satu baris untuk dashboard. */
export function guardSummary(): string {
  const t = clock();
  const day = within(sent, DAY);
  const counts = `${within(sent, HOUR)}/${cfg.waMaxPerHour} kiriman jam ini · ${day}/${cfg.waMaxPerDay} dalam 24 jam`;
  return t < pausedUntil
    ? `DIJEDA sampai ${new Date(pausedUntil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} — ${pauseReason} · ${counts}`
    : `normal · ${counts}`;
}
