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
 *
 * Di atas itu, pustaka baileys-antiban sendiri (kelas AntiBan) ikut menimbang
 * tiap kiriman: pemanasan nomor baru, deteksi pesan kembar, dan pemantau
 * kesehatan yang menjeda kiriman saat risikonya tinggi. Ia dipasang dari
 * baileys.ts lewat setAntiBan; di sini hanya cara memakainya (guardedSend).
 */

import { cfg, HOUR, MINUTE } from '../config';

const DAY = 24 * HOUR;

let clock: () => number = Date.now;
/** Tes: ganti jam. */
export function setGuardClock(fn: () => number): void {
  clock = fn;
}

let sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
/** Tes: ganti cara menunggu (supaya tes tidak benar-benar menunggu). */
export function setGuardSleep(fn: (ms: number) => Promise<void>): void {
  sleep = fn;
}

/** Bagian kelas AntiBan (baileys-antiban) yang dipakai di sini. */
export interface AntiBanLike {
  beforeSend(jid: string, text: string): Promise<{ allowed: boolean; delayMs: number; reason?: string }>;
  afterSend(jid: string, text: string): void;
  afterSendFailed?(error?: string): void;
  onDisconnect?(reason: string | number): void;
  onReconnect?(): void;
  getStats(): {
    messagesBlocked: number;
    health: { risk: string };
    warmUp: { phase: string; day: number; totalDays: number; todaySent: number; todayLimit: number };
  };
}

let antiban: AntiBanLike | null = null;
/** Pasang (atau lepas) AntiBan. baileys.ts memasang yang asli; tes memasang tiruan. */
export function setAntiBan(ab: AntiBanLike | null): void {
  antiban = ab;
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

/** AntiBan menjeda kiriman (risiko tinggi): kabari pemilik lewat jalur yang sama. */
export function antibanPaused(reason: string): void {
  onPause?.(`Pengaman antiban menahan kiriman bot: ${reason}. Pelanggan yang chat selama itu tidak dibalas bot.`);
  console.error(`[pengaman] antiban menahan kiriman: ${reason}`);
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

/**
 * Satu kiriman lewat semua pengaman: batas di modul ini, lalu AntiBan (kalau
 * terpasang), lalu satu kali menunggu, lalu `send`.
 *
 * Menunggunya hanya sekali, selama jeda TERBESAR di antara: jeda modul ini,
 * jeda minimum transport (`minWaitMs`), dan jeda AntiBan dikurangi yang sudah
 * ditunggu pemanggil dengan irama manusia (`pacedMs`). Jeda-jeda itu tidak
 * pernah dijumlahkan. Melempar GuardBlocked kalau salah satu pengaman menolak.
 */
export async function guardedSend<T>(
  jid: string, text: string, opts: { minWaitMs?: number; pacedMs?: number }, send: () => Promise<T>
): Promise<T> {
  const own = beforeSend();
  let abDelay = 0;
  if (antiban) {
    const d = await antiban.beforeSend(jid, text);
    if (!d.allowed) {
      const reason = d.reason || 'risiko pemblokiran tinggi';
      antibanPaused(reason);
      throw new GuardBlocked(`antiban: ${reason}`);
    }
    abDelay = Math.max(0, d.delayMs - (opts.pacedMs ?? 0));
  }
  const wait = Math.max(own, opts.minWaitMs ?? 0, abDelay, 0);
  if (wait) await sleep(wait);
  let res: T;
  try {
    res = await send();
  } catch (e) {
    onSendError(e);
    throw e;
  }
  afterSend();
  antiban?.afterSend(jid, text);
  return res;
}

const codeOf = (e: unknown): number | undefined => {
  const x = e as { output?: { statusCode?: number }; data?: number | { code?: number }; status?: number } | undefined;
  const n = x?.output?.statusCode ?? (typeof x?.data === 'number' ? x.data : x?.data?.code) ?? x?.status;
  return typeof n === 'number' ? n : undefined;
};

/** Kiriman gagal. Tanda pembatasan dari WhatsApp = berhenti dulu, bukan coba lagi. */
export function onSendError(e: unknown): void {
  antiban?.afterSendFailed?.(e instanceof Error ? e.message : String(e));
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
  antiban?.onDisconnect?.(code ?? 'tanpa kode');
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
  antiban?.onReconnect?.();
}

const RISK: Record<string, string> = { low: 'rendah', medium: 'sedang', high: 'tinggi', critical: 'kritis' };

/** Keadaan AntiBan dalam satu potong kalimat, atau '' kalau tidak terpasang. */
function antibanSummary(): string {
  if (!antiban) return '';
  try {
    const s = antiban.getStats();
    const warm = s.warmUp.phase === 'graduated'
      ? 'pemanasan selesai'
      : `pemanasan hari ${s.warmUp.day}/${s.warmUp.totalDays} (${s.warmUp.todaySent}/${s.warmUp.todayLimit} hari ini)`;
    return ` · antiban: risiko ${RISK[s.health.risk] ?? s.health.risk}, ${warm}, ${s.messagesBlocked} ditahan`;
  } catch {
    return '';
  }
}

/** Satu baris untuk dashboard. */
export function guardSummary(): string {
  const t = clock();
  const day = within(sent, DAY);
  const counts = `${within(sent, HOUR)}/${cfg.waMaxPerHour} kiriman jam ini · ${day}/${cfg.waMaxPerDay} dalam 24 jam`;
  return (t < pausedUntil
    ? `DIJEDA sampai ${new Date(pausedUntil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} — ${pauseReason} · ${counts}`
    : `normal · ${counts}`) + antibanSummary();
}
