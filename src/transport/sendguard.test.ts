/** Pengaman nomor: batas kiriman, jeda setelah tanda bahaya, mundur saat putus. */

import assert from 'node:assert/strict';

import { cfg, HOUR, MINUTE } from '../config';
import { afterSend, beforeSend, GuardBlocked, guardSummary, onDisconnect, onOpen, onSendError, resetGuard, setGuardClock } from './sendguard';

let t = 1_800_000_000_000;
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

console.error = quiet;
console.log('pengaman nomor: OK');
