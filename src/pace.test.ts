/**
 * Irama manusia: lama mengetik mengikuti panjang pesan, satu lawan bicara pada
 * satu waktu (antre urut kedatangan), dan "sedang mengetik…" yang disegarkan.
 * Jam dan acakan maya: tes tidak benar-benar menunggu.
 */

import assert from 'node:assert/strict';

import { gfan } from './business/gfan/profile';
import { sendPaced, setPaceClock, setPaceRandom, setPaceSleep, typingMs, type PaceMode, type TypingHooks } from './pace';
import { setDefaultProject, type ProjectCtx } from './project';

// Profil minimal: pace.ts hanya membaca batas jeda balasan.
setDefaultProject({ id: 'uji', row: {}, biz: { ...gfan, replyDelayMin: 8, replyDelayMax: 30 }, seed: gfan, cfg: {} } as unknown as ProjectCtx);

// --- jam maya -----------------------------------------------------------------
let now = 1_800_000_000_000;
let seq = 0;
const timers: { at: number; seq: number; done: () => void }[] = [];
setPaceClock(() => now);
const vsleep = (ms: number): Promise<void> => new Promise((r) => timers.push({ at: now + ms, seq: seq++, done: r }));
setPaceSleep(vsleep);
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Majukan jam maya, satu timer demi satu timer, sampai semua janji selesai. */
async function run<T>(ps: Promise<T>[]): Promise<T[]> {
  let settled = false;
  const all = Promise.all(ps).finally(() => (settled = true));
  all.catch(() => {});
  let idle = 0;
  while (!settled) {
    await flush();
    if (settled) break;
    if (!timers.length) {
      if (++idle > 50) throw new Error('macet: tidak ada timer dan janji belum selesai');
      continue;
    }
    idle = 0;
    timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const t = timers.shift()!;
    now = Math.max(now, t.at);
    t.done();
  }
  return all;
}

// --- catatan kejadian -----------------------------------------------------------
let events: { t: number; ev: string }[] = [];
const log = (ev: string): void => void events.push({ t: now, ev });
const at = (ev: string): number => {
  const i = events.findIndex((e) => e.ev === ev);
  assert.ok(i >= 0, `kejadian "${ev}" tidak ada`);
  return i;
};
const hooks = (key: string, onStart?: () => void): TypingHooks => ({
  start: async () => {
    log(`${key}:start`);
    onStart?.();
  },
  stop: async () => log(`${key}:stop`),
});
/** Kirim lewat sendPaced; pengirimannya sendiri makan `sendMs` waktu maya. */
const paced = (key: string, text: string, mode: PaceMode, opts: { sendMs?: number; onStart?: () => void; fail?: boolean } = {}) =>
  sendPaced(key, text, {
    mode,
    typing: hooks(key, opts.onStart),
    send: async (pacedMs) => {
      log(`${key}:send-begin:${pacedMs}`);
      await vsleep(opts.sendMs ?? 1000);
      if (opts.fail) throw new Error('gagal kirim');
      log(`${key}:send-end`);
    },
  });
const sendBegin = (key: string): number => events.findIndex((e) => e.ev.startsWith(`${key}:send-begin:`));

const debugLines: string[] = [];
const realDebug = console.debug;
console.debug = (...a: unknown[]) => void debugLines.push(a.join(' '));

(async () => {
  // --- lama mengetik mengikuti panjang ---------------------------------------
  setPaceRandom(() => 0); // jeda berpikir 0,8 s; cps acak = 3,5
  assert.equal(typingMs(60, 4), 15_000, '60 huruf / 4 per detik, tanpa jeda berpikir');
  assert.equal(typingMs(150, 5), 18_000 + 800 + 12_000, 'jeda berpikir di antara potongan 90 huruf');
  assert.ok(typingMs(40, 4) < typingMs(80, 4), 'lebih panjang = lebih lama');
  assert.equal(typingMs(0), 1500, 'batas bawah');
  assert.equal(typingMs(3), 1500, 'batas bawah');
  assert.equal(typingMs(5000), 40_000, 'batas atas');
  assert.equal(typingMs(70), 20_000, 'acakan 0 = 3,5 huruf per detik');
  setPaceRandom(() => 0.999_999);
  assert.ok(Math.abs(typingMs(70) - 70_000 / 5.5) <= 1, 'acakan ≈1 = 5,5 huruf per detik');
  assert.ok(Math.abs(typingMs(100, 5) - (18_000 + 2500 + 2000)) <= 1, 'jeda berpikir paling lama 2,5 s');
  setPaceRandom(null);
  for (let i = 0; i < 300; i++) {
    const ms = typingMs(70);
    assert.ok(ms >= Math.floor(70_000 / 5.5) && ms <= 20_000, `cps di luar 3,5–5,5: ${ms}`);
  }

  // --- satu lawan bicara pada satu waktu ---------------------------------------
  setPaceRandom(() => 0.5);
  events = [];
  const [a, b] = await run([paced('A', 'x'.repeat(40), 'reply'), paced('B', 'y'.repeat(40), 'reply')]);
  assert.ok(at('A:send-end') < at('B:start'), 'B baru mengetik setelah kiriman A selesai');
  assert.ok(sendBegin('A') < sendBegin('B'), 'urut kedatangan');
  assert.equal(a!.thinkingMs, b!.thinkingMs, 'mikir boleh bersamaan');
  assert.equal(a!.queuedMs, 0);
  assert.equal(b!.queuedMs, a!.typingMs + 1000, 'B antre selama A mengetik dan mengirim');
  assert.ok(events.some((e) => e.ev === `A:send-begin:${a!.thinkingMs + a!.typingMs}`), 'pacedMs = mikir + mengetik');

  // Urutan antre = urutan selesai mikir, bukan urutan panggilan.
  events = [];
  const [x, y, z] = await run([
    paced('X', 'halo kak', 'reply'), // mikir 19 s
    paced('Y', 'baik kak, kami cek dulu', 'dashboard'), // mikir 2 s
    paced('Z', 'lead baru', 'notify', { sendMs: 5000 }), // langsung antre
  ]);
  assert.ok(sendBegin('Z') < sendBegin('Y') && sendBegin('Y') < sendBegin('X'));
  assert.ok(at('Z:send-end') < at('Y:start') && at('Y:send-end') < at('X:start'));
  assert.equal(y!.thinkingMs, 2000);
  assert.ok(y!.queuedMs > 0, 'Y datang saat Z sedang dikirim');
  assert.equal(x!.queuedMs, 0, 'X selesai mikir setelah Y terkirim');
  assert.equal(z!.thinkingMs + z!.typingMs, 0);

  // --- pesan susulan ke orang yang sama: tetap mikir singkat ------------------
  events = [];
  const [first] = await run([paced('C', 'Selamat siang kak', 'reply')]);
  assert.ok(first!.thinkingMs >= 8000 && first!.thinkingMs <= 30_000);
  const [second] = await run([paced('C', 'Ada yang bisa kami bantu?', 'reply')]);
  assert.ok(second!.thinkingMs >= 2000 && second!.thinkingMs <= 5000, `susulan: ${second!.thinkingMs}`);
  assert.ok(at('C:send-end') < events.findIndex((e, i) => i > at('C:send-end') && e.ev === 'C:start'), 'susulan tetap antre dan mengetik');
  now += 60_000;
  const [later] = await run([paced('C', 'Halo lagi', 'reply')]);
  assert.ok(later!.thinkingMs >= 8000, 'setelah jendela susulan lewat, mikir biasa lagi');

  // --- "sedang mengetik…" disegarkan tiap 7 s ----------------------------------
  setPaceRandom(() => 0); // 3,5 huruf per detik, jeda berpikir 0,8 s
  events = [];
  const [long] = await run([paced('D', 'k'.repeat(105), 'followup')]);
  assert.equal(long!.typingMs, 30_800, '105 huruf: 25,7 s + jeda 0,8 s + 4,3 s');
  const starts = events.filter((e) => e.ev === 'D:start').map((e) => e.t);
  const stops = events.filter((e) => e.ev === 'D:stop').map((e) => e.t);
  const begin = starts[0]!;
  assert.deepEqual(starts.map((t) => t - begin), [0, 7000, 14_000, 21_000, 26_514], 'tiap 7 s, dan lagi setelah jeda berpikir');
  assert.deepEqual(stops.map((t) => t - begin), [25_714, 30_800], 'paused saat jeda berpikir, dan sekali tepat sebelum kirim');
  const iSend = sendBegin('D');
  assert.equal(events[iSend - 1]!.ev, 'D:stop', 'paused tepat sebelum kirim');
  assert.equal(events[iSend - 2]!.ev, 'D:start', 'hanya satu paused di antara ketikan terakhir dan kiriman');
  assert.equal(events[iSend]!.t, begin + 30_800);

  // --- notify: ikut antre, tanpa mengetik --------------------------------------
  events = [];
  let typingStarted!: () => void;
  const started = new Promise<void>((r) => (typingStarted = r));
  const e1 = paced('E', 'k'.repeat(60), 'reply', { onStart: () => typingStarted() });
  await run([started]);
  const n1 = paced('N', 'lead lengkap', 'notify');
  const [, notified] = await run([e1, n1]);
  assert.ok(at('E:send-end') < sendBegin('N'), 'kabar menunggu chat yang sedang diketik');
  assert.ok(!events.some((e) => e.ev === 'N:start' || e.ev === 'N:stop'), 'kabar tanpa "sedang mengetik…"');
  assert.ok(notified!.queuedMs > 0);
  assert.equal(notified!.thinkingMs + notified!.typingMs, 0);

  // --- kiriman gagal tetap melepas giliran -------------------------------------
  events = [];
  const failing = paced('F', 'halo', 'notify', { fail: true });
  const after = paced('G', 'halo', 'notify');
  await assert.rejects(run([failing]), /gagal kirim/);
  await run([after]);
  assert.ok(sendBegin('G') > sendBegin('F'));

  // --- satu baris log per kiriman ----------------------------------------------
  assert.ok(debugLines.some((l) => /^\[irama\] B \(balasan\): mikir \d+,\d s, mengetik \d+,\d s \(antre \d+,\d s\)$/.test(l)), debugLines.join('\n'));
  assert.ok(debugLines.some((l) => /^\[irama\] A \(balasan\): mikir \d+,\d s, mengetik \d+,\d s$/.test(l)), 'antre 0 tidak ditulis');

  console.debug = realDebug;
  console.log('irama: OK');
})().catch((e) => {
  console.debug = realDebug;
  console.error('irama: GAGAL\n', e);
  process.exitCode = 1;
});
