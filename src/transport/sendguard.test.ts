/** Pengaman nomor: batas kiriman, jeda setelah tanda bahaya, mundur saat putus. */

import assert from 'node:assert/strict';

import { cfg, HOUR, MINUTE } from '../config';
import {
  afterSend, beforeSend, GuardBlocked, guardedSend, guardSummary, onDisconnect, onOpen, onSendError, resetGuard, setAntiBan, setGuardClock,
  setGuardListener, setGuardSleep, type AntiBanLike,
} from './sendguard';

let t = 1_800_000_000_000;
const DAY_MS = 24 * HOUR;
setGuardClock(() => t);
cfg.waMaxPerMinute = 5;
cfg.waMaxPerHour = 20;
cfg.waMaxPerDay = 30;
const quiet = console.error;
console.error = () => {};

const sendOk = () => {
  const wait = beforeSend();
  t += wait;
  afterSend();
  return wait;
};

// Per menit: tidak ditolak, hanya diantrekan.
resetGuard();
for (let i = 0; i < 5; i++) assert.equal(sendOk(), 0);
assert.equal(beforeSend(), MINUTE, 'kiriman ke-6 dalam semenit menunggu sampai jendelanya lewat');
t += 30_000;
assert.equal(beforeSend(), 30_000);

// Per jam: ditolak.
resetGuard();
for (let i = 0; i < 20; i++) { sendOk(); t += 20_000; }
assert.throws(() => beforeSend(), GuardBlocked);
assert.match(guardSummary(), /^normal · 20\/20 kiriman jam ini/);
t += HOUR;
assert.equal(sendOk(), 0, 'jam berikutnya boleh lagi');

// Per 24 jam.
for (let i = 0; i < 9; i++) { sendOk(); t += 20_000; }
assert.throws(() => beforeSend(), /30 kiriman per 24 jam/);
t += 24 * HOUR;
assert.equal(sendOk(), 0);

// Tanda pembatasan dari WhatsApp: berhenti dulu.
resetGuard();
onSendError(Object.assign(new Error('rate-overlimit'), { data: 429 }));
assert.throws(() => beforeSend(), /dijeda/);
assert.match(guardSummary(), /^DIJEDA sampai .*\(429\)/);
t += 4 * HOUR + 1;
assert.equal(beforeSend(), 0);

resetGuard();
onSendError({ output: { statusCode: 463 } });
assert.throws(() => beforeSend(), /463/);
t += HOUR + 1;
assert.equal(beforeSend(), 0);

// Gagal biasa: baru dijeda kalau beruntun.
resetGuard();
for (let i = 0; i < 4; i++) onSendError(new Error('timeout'));
assert.equal(beforeSend(), 0);
onSendError(new Error('timeout'));
assert.throws(() => beforeSend(), /5 kiriman gagal/);

// Putus: 403 = jeda panjang dan sambung ulang pelan; 515 bukan tanda bahaya.
resetGuard();
assert.equal(onDisconnect(403), 5 * MINUTE);
assert.throws(() => beforeSend(), /403/);
resetGuard();
for (let i = 0; i < 10; i++) assert.equal(onDisconnect(515), 0);
assert.equal(beforeSend(), 0);
for (let i = 0; i < 3; i++) onDisconnect(408);
assert.equal(beforeSend(), 0);
onDisconnect(undefined);
assert.throws(() => beforeSend(), /putus 4 kali/);
assert.equal(onDisconnect(503), MINUTE);

// Baru tersambung: kiriman berjarak minimal 5 detik selama semenit pertama.
resetGuard();
onOpen();
assert.equal(sendOk(), 0);
assert.equal(beforeSend(), 5000);
t += 2 * MINUTE;
sendOk();
assert.equal(beforeSend(), 0);

// AntiBan (baileys-antiban) lewat guardedSend, dengan tiruan: tanpa jaringan dan tanpa menunggu sungguhan.
(async () => {
  const waits: number[] = [];
  setGuardSleep(async (ms) => void waits.push(ms));
  const paused: string[] = [];
  setGuardListener((text) => void paused.push(text));
  const calls: string[] = [];
  let decision = { allowed: true, delayMs: 0, reason: undefined as string | undefined };
  const fake: AntiBanLike = {
    beforeSend: async (jid, text) => (calls.push(`before ${jid} ${text}`), decision),
    afterSend: (jid, text) => void calls.push(`after ${jid} ${text}`),
    afterSendFailed: (e) => void calls.push(`failed ${e}`),
    getStats: () => ({ messagesBlocked: 2, health: { risk: 'low' }, warmUp: { phase: 'warming', day: 3, totalDays: 7, todaySent: 4, todayLimit: 40 } }),
  };
  setAntiBan(fake);
  let sends = 0;
  const send = async () => { sends += 1; return 'ok'; };

  // Ditolak: tidak dikirim, pemilik dikabari lewat pendengar pengaman.
  resetGuard();
  t += DAY_MS;
  decision = { allowed: false, delayMs: 0, reason: 'risiko tinggi' };
  await assert.rejects(guardedSend('62811@s.whatsapp.net', 'halo', {}, send), (e: unknown) => e instanceof GuardBlocked && /antiban: risiko tinggi/.test((e as Error).message));
  assert.equal(sends, 0, 'yang ditolak antiban tidak dikirim');
  assert.equal(paused.length, 1);
  assert.match(paused[0] ?? '', /antiban menahan kiriman bot: risiko tinggi/);
  assert.deepEqual(waits, []);

  // Boleh dengan jeda: menunggu SEKALI, selama jeda terbesar (bukan dijumlahkan).
  calls.length = 0;
  decision = { allowed: true, delayMs: 7000, reason: undefined };
  assert.equal(await guardedSend('62811@s.whatsapp.net', 'halo', { minWaitMs: 2000 }, send), 'ok');
  assert.deepEqual(waits, [7000], 'jeda antiban dan jeda minimum tidak dijumlahkan');
  assert.equal(sends, 1);
  assert.deepEqual(calls, ['before 62811@s.whatsapp.net halo', 'after 62811@s.whatsapp.net halo'], 'afterSend dipanggil setelah terkirim');

  // Jeda yang sudah ditunggu dengan irama manusia dikurangkan dari jeda antiban.
  waits.length = 0;
  await guardedSend('62811@s.whatsapp.net', 'lagi', { pacedMs: 5000 }, send);
  assert.deepEqual(waits, [2000]);
  waits.length = 0;
  await guardedSend('62811@s.whatsapp.net', 'lagi', { pacedMs: 9000 }, send);
  assert.deepEqual(waits, [], 'irama manusia sudah lebih lama: tidak menunggu lagi');

  // Kiriman gagal dilaporkan ke antiban, dan afterSend tidak dipanggil.
  calls.length = 0;
  decision = { allowed: true, delayMs: 0, reason: undefined };
  await assert.rejects(guardedSend('62811@s.whatsapp.net', 'x', {}, async () => { throw new Error('timeout'); }), /timeout/);
  assert.deepEqual(calls, ['before 62811@s.whatsapp.net x', 'failed timeout']);

  // Keadaan antiban ikut di ringkasan pengaman (dashboard dan laporan bot).
  assert.match(guardSummary(), / · antiban: risiko rendah, pemanasan hari 3\/7 \(4\/40 hari ini\), 2 ditahan$/);
  setAntiBan(null);
  assert.ok(!guardSummary().includes('antiban'));
  setGuardListener(null);

  console.error = quiet;
  console.log('pengaman nomor: OK');
})().catch((e) => {
  console.error = quiet;
  console.error('pengaman nomor: GAGAL\n', e);
  process.exitCode = 1;
});

