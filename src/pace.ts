/**
 * Irama balasan: tidak instan, tidak pernah sama dua kali berturut-turut, dan
 * hanya satu lawan bicara pada satu waktu.
 *
 * Bot yang membalas dalam satu detik, setiap kali, dengan jeda yang persis
 * sama, adalah pola yang paling mudah dikenali sebagai mesin. Jadi tiap
 * kiriman berjalan seperti orang memegang satu HP:
 *
 *   1. Mikir (membaca dulu): sekian detik yang diacak di antara batas yang
 *      diatur pemilik (bawaan 8–30). Ini boleh tumpang tindih antar-chat.
 *   2. Antre: satu "perhatian" per proses bot. Selama bot mengetik ke A, tidak
 *      ada yang diketik atau dikirim ke B; B menunggu sampai pesan A terkirim,
 *      sesuai urutan datangnya.
 *   3. Mengetik: "sedang mengetik…" selama panjang pesannya (3,5–5,5 huruf per
 *      detik, dengan jeda berpikir sesekali), lalu kirim.
 *
 * Ini mengurangi tanda-tanda otomatis; ini BUKAN jaminan tidak diblokir di
 * jalur tidak resmi.
 */

import { biz } from './business';

/** Batas memegang giliran selama kiriman berjalan (ms). */
const SEND_HOLD_MS = 90_000;

/** Pesan kedua dalam satu giliran (jawaban setelah salam, foto) menyusul cepat. */
const BURST_WINDOW_MS = 20_000;

/** Kecepatan mengetik orang yang cukup cepat di HP (≈ 40–65 kata per menit). */
const CPS_MIN = 3.5;
const CPS_MAX = 5.5;
/** Tiap sekian huruf, berhenti sebentar untuk berpikir. */
const PAUSE_EVERY_CHARS = 90;
const PAUSE_MIN_MS = 800;
const PAUSE_MAX_MS = 2500;
/** Batas lama mengetik satu pesan. */
export const TYPING_MIN_MS = 1500;
export const TYPING_MAX_MS = 6000;
/** WhatsApp menghapus "sedang mengetik…" setelah ±10 detik: kirim ulang tiap 7 detik. */
export const PRESENCE_REFRESH_MS = 7000;

let random: () => number = Math.random;
/** Tes: ganti sumber acak (0 ≤ hasil < 1). */
export function setPaceRandom(fn: (() => number) | null): void {
  random = fn ?? Math.random;
}

let sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
/** Tes: ganti cara menunggu (supaya tes tidak benar-benar menunggu). */
export function setPaceSleep(fn: ((ms: number) => Promise<void>) | null): void {
  sleep = fn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

let clock: () => number = Date.now;
/** Tes: ganti jam (untuk jendela pesan beruntun dan lama antre). */
export function setPaceClock(fn: (() => number) | null): void {
  clock = fn ?? Date.now;
}

const between = (min: number, max: number): number => min + random() * (max - min);

/**
 * Berapa lama "mikir" sebelum kiriman ini (milidetik).
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

/** Satu potong waktu mengetik: mengetik, atau berhenti sebentar untuk berpikir. */
interface TypingStep {
  kind: 'type' | 'pause';
  ms: number;
}

/** Kecepatan mengetik untuk satu pesan (huruf per detik). */
const drawCps = (): number => between(CPS_MIN, CPS_MAX);

/**
 * Urutan mengetik untuk pesan sepanjang `textLength`: potongan 90 huruf, di
 * antaranya jeda berpikir 0,8–2,5 detik. Totalnya dijepit 1,5–6 detik.
 */
function typingSteps(textLength: number, cps: number): TypingStep[] {
  const len = Math.max(0, Math.round(textLength));
  const rate = Math.min(CPS_MAX, Math.max(CPS_MIN, cps));
  const steps: TypingStep[] = [];
  let done = 0;
  do {
    const chunk = Math.min(PAUSE_EVERY_CHARS, len - done);
    steps.push({ kind: 'type', ms: (chunk / rate) * 1000 });
    done += chunk;
    if (done < len) steps.push({ kind: 'pause', ms: between(PAUSE_MIN_MS, PAUSE_MAX_MS) });
  } while (done < len);

  const raw = steps.reduce((a, s) => a + s.ms, 0);
  const target = Math.round(Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, raw)));
  // Terlalu lama: semua potongan diperpendek sebanding. Terlalu cepat: potongan
  // mengetik terakhir diperpanjang.
  const scale = raw > TYPING_MAX_MS ? TYPING_MAX_MS / raw : 1;
  for (const s of steps) s.ms = Math.round(s.ms * scale);
  const last = steps[steps.length - 1] as TypingStep;
  last.ms += target - steps.reduce((a, s) => a + s.ms, 0);
  return steps;
}

/**
 * Berapa lama "sedang mengetik…" untuk pesan sepanjang `textLength` (ms).
 * `cps` = huruf per detik (3,5–5,5); kosong = diacak.
 */
export function typingMs(textLength: number, cps: number = drawCps()): number {
  return typingSteps(textLength, cps).reduce((a, s) => a + s.ms, 0);
}

/** Cara menampilkan "sedang mengetik…" di jalur yang bisa. */
export interface TypingHooks {
  /** "sedang mengetik…" sekarang (WhatsApp: presence `composing`). */
  start(): Promise<void>;
  /** Berhenti mengetik (WhatsApp: presence `paused`). */
  stop?(): Promise<void>;
}

/**
 * Jenis kiriman:
 *   - reply: balasan ke pelanggan; mikir sesuai pengaturan pemilik.
 *   - followup, dashboard: mikir singkat 1–3 detik (isinya sudah diputuskan).
 *   - notify: kabar ke sales/pemilik; tanpa mikir dan tanpa mengetik, hanya antre.
 */
export type PaceMode = 'reply' | 'followup' | 'dashboard' | 'notify';

export interface PaceResult {
  thinkingMs: number;
  typingMs: number;
  /** Berapa lama menunggu giliran (chat lain sedang diketik/dikirim). */
  queuedMs: number;
}

const MODE_LABEL: Record<PaceMode, string> = { reply: 'balasan', followup: 'follow-up', dashboard: 'dashboard', notify: 'kabar' };

const lastSentAt = new Map<string, number>();
let previousDelay: number | null = null;

/** Ekor antrean perhatian: kiriman berikutnya menunggu yang ini selesai. */
let attention: Promise<void> = Promise.resolve();

/** Ambil giliran perhatian (urut kedatangan). Mengembalikan cara melepasnya. */
function takeTurn(): Promise<() => void> {
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const before = attention;
  attention = before.then(() => mine);
  return before.then(() => release);
}

const quiet = async (fn?: () => Promise<void>): Promise<void> => {
  if (!fn) return;
  await fn().catch(() => {});
};

/** Jalankan urutan mengetik, dengan "sedang mengetik…" yang terus disegarkan. */
async function typeOut(steps: TypingStep[], hooks?: TypingHooks): Promise<void> {
  for (const s of steps) {
    if (s.kind === 'pause') {
      await quiet(hooks?.stop?.bind(hooks));
      await sleep(s.ms);
      continue;
    }
    let left = s.ms;
    while (left > 0) {
      await quiet(hooks?.start.bind(hooks));
      const d = Math.min(PRESENCE_REFRESH_MS, left);
      await sleep(d);
      left -= d;
    }
  }
  // Tepat sebelum pesannya keluar.
  await quiet(hooks?.stop?.bind(hooks));
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

/**
 * Kirim satu pesan dengan irama manusia: mikir → antre → mengetik → kirim →
 * lepas giliran. `send` menerima lama mikir + mengetik (ms), untuk diteruskan
 * ke transport sebagai `pacedMs`. Error dari `send` diteruskan ke pemanggil;
 * gilirannya tetap dilepas.
 */
export async function sendPaced(
  key: string,
  text: string,
  opts: { typing?: TypingHooks; send: (pacedMs: number) => Promise<void>; mode: PaceMode }
): Promise<PaceResult> {
  const { mode } = opts;
  let thinking = 0;
  if (mode === 'reply') {
    thinking = pickDelayMs(clock() - (lastSentAt.get(key) ?? 0), previousDelay);
    if (thinking >= 6000) previousDelay = thinking;
  } else if (mode !== 'notify') {
    thinking = Math.round(between(1000, 3000));
  }
  if (thinking > 0) await sleep(thinking);

  const queuedFrom = clock();
  const release = await takeTurn();
  const queued = Math.max(0, clock() - queuedFrom);
  let typing = 0;
  try {
    if (mode !== 'notify') {
      const steps = typingSteps(text.length, drawCps());
      typing = steps.reduce((a, s) => a + s.ms, 0);
      await typeOut(steps, opts.typing);
      lastSentAt.set(key, clock());
      if (lastSentAt.size > 5000) lastSentAt.delete(lastSentAt.keys().next().value as string);
    }
    console.debug(
      `[irama] ${key} (${MODE_LABEL[mode]}): ` +
        (mode === 'notify' ? 'tanpa mengetik' : `mikir ${secs(thinking)}, mengetik ${secs(typing)}`) +
        (queued > 0 ? ` (antre ${secs(queued)})` : '')
    );
    // Giliran dilepas paling lama SEND_HOLD_MS walau kirimannya menggantung:
    // satu socket yang macet tidak boleh membuat semua chat lain menunggu.
    // Kirimannya sendiri tetap berjalan (dan gagal) dengan caranya sendiri.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hold = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[irama] ${key}: kiriman belum selesai setelah ${secs(SEND_HOLD_MS)}, giliran dilepas`);
        resolve();
      }, SEND_HOLD_MS);
    });
    try {
      await Promise.race([opts.send(thinking + typing), hold]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    release();
  }
  return { thinkingMs: thinking, typingMs: typing, queuedMs: queued };
}
