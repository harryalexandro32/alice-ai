/**
 * Uji alur ujung-ke-ujung: LLM tiruan, jam tiruan, database di memori.
 * Tidak menyentuh WhatsApp, Google, maupun API LLM.
 */

import assert from 'node:assert/strict';

import { makeSalesNotifier } from './app';
import { checkReply, parseBrain, type BrainInput, type BrainResult } from './brain';
import { biz } from './business';
import { advance, setNow } from './clock';
import { cfg, HOUR, MINUTE } from './config';
import { handleHumanReply, handleInbound, setBrain, setSender } from './flow';
import { followupDueAt, runFollowups } from './followup';
import { deliverOutbox, setSalesNotifier, setSheetWriter } from './sinks/outbox';
import { getContact, openDb } from './store';
import { HANDOFF, NON_TEXT } from './texts';
import type { Transport } from './transport/types';

const GREETING = biz.greeting;
const A = '+6281211110001';
const SALES = '+6281299990001';
/** Selasa 10 Nov 2026, 10:00 WIB. */
const T0 = Date.UTC(2026, 10, 10, 3, 0);

let sent: string[] = [];
let sales: string[] = [];
let rows: string[][] = [];
let brainCalls: BrainInput[] = [];
let next: (i: BrainInput) => BrainResult | null = () => null;
let sheetFails = 0;

const R = (reply: string, fields: Record<string, string> = {}, intent: BrainResult['intent'] = 'info'): BrainResult => ({
  reply, fields, intent,
});

function fresh(): void {
  openDb(':memory:');
  setNow(T0);
  cfg.tz = 'Asia/Jakarta';
  cfg.salesNumber = SALES;
  cfg.followupAfterHours = 23;
  cfg.followupStartHour = 8;
  cfg.followupEndHour = 20;
  cfg.followupMaxHours = 0;
  cfg.followupMaxTotal = 2;
  cfg.humanPauseHours = 12;
  cfg.maxInboundPerNumber = 40;
  cfg.onlyNumbers = [];
  sent = [];
  sales = [];
  rows = [];
  brainCalls = [];
  sheetFails = 0;
  next = () => R('Baik.');
  setSender(async (_to, text) => void sent.push(text));
  setSalesNotifier(async (text) => {
    sales.push(text);
    return true;
  });
  setSheetWriter(async (row) => {
    if (sheetFails > 0) {
      sheetFails -= 1;
      throw new Error('sheet down');
    }
    rows.push(row);
  });
  setBrain(async (i) => {
    brainCalls.push(i);
    return next(i);
  });
}

async function say(text: string | null, phone = A, waId?: string): Promise<void> {
  await handleInbound({ phone, address: phone, text, waId });
  await deliverOutbox();
}

const follow = () => runFollowups(async (_to, text) => void sent.push(text));

const fakeTransport = (name: string, self: string | null, canMessageSelf: boolean) => {
  const out: { phone: string; text: string; notify?: boolean }[] = [];
  const t: Transport = {
    name,
    canMessageSelf,
    selfPhone: () => self,
    start: async () => {},
    send: async (to, text, opts) => void out.push({ phone: to.phone, text, notify: opts?.notify }),
  };
  return { t, out };
};

const tests: [string, () => Promise<void>][] = [
  ['salam hanya sekali, dan sapaan kosong tidak memanggil LLM', async () => {
    await say('Halo');
    assert.deepEqual(sent, [GREETING]);
    assert.equal(brainCalls.length, 0);
    await say('mau tanya exhaust fan');
    assert.equal(sent.length, 2);
    assert.notEqual(sent[1], GREETING);
    assert.equal(brainCalls.length, 1);
    assert.equal(brainCalls[0]?.justGreeted, false);
  }],

  ['pesan pertama berupa pertanyaan: salam + jawaban', async () => {
    next = () => R('GFAF-40A berukuran 16 inci.');
    await say('exhaust 16 inci ada?');
    assert.deepEqual(sent, [GREETING, 'GFAF-40A berukuran 16 inci.']);
    assert.equal(brainCalls[0]?.justGreeted, true);
    assert.deepEqual(brainCalls[0]?.history, []);
  }],

  ['data lead tergabung dari beberapa pesan; sales + Sheet dikabari tepat sekali', async () => {
    await say('halo');
    next = () => R('Baik Pak Budi, di kota mana?', { name: 'Budi' });
    await say('saya Budi');
    assert.equal(sales.length, 0);
    next = () => R('Siap. Butuhnya untuk apa?', { city: 'Surabaya' });
    await say('di Surabaya');
    assert.equal(getContact(A)?.lead.name, 'Budi', 'nama tidak boleh terhapus');
    assert.deepEqual(brainCalls.at(-1)?.known, { name: 'Budi' });
    next = () => R('Baik, kami catat.', { need: 'exhaust fan gudang' });
    await say('butuh exhaust buat gudang');
    assert.equal(sales.length, 1);
    assert.match(sales[0] ?? '', /Lead lengkap/);
    assert.match(sales[0] ?? '', /Nama: Budi\nKota\/alamat: Surabaya\nKebutuhannya: exhaust fan gudang/);
    assert.match(sales[0] ?? '', /wa\.me\/6281211110001/);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.slice(1), [
      'Lead lengkap', A, 'Budi', 'Surabaya', 'exhaust fan gudang', '', 'butuh exhaust buat gudang',
    ]);
    next = () => R('Sama-sama.', { need: 'exhaust fan gudang 16 inci' });
    await say('yang 16 inci ya');
    assert.equal(sales.length, 1, 'tidak dikabari dua kali');
    assert.equal(rows.length, 1);
    assert.equal(getContact(A)?.lead.need, 'exhaust fan gudang 16 inci', 'koreksi menggantikan');
  }],

  ['tanya harga sebelum data lengkap: sales dikabari sekali, lalu lead lengkap menyusul', async () => {
    await say('halo');
    next = () => R('Untuk harga, tim kami yang akan menginfokan. Boleh tahu namanya?', {}, 'handoff');
    await say('harga GFAF-40A berapa');
    assert.equal(sales.length, 1);
    assert.match(sales[0] ?? '', /Perlu dibantu[\s\S]*menanyakan harga\/stok[\s\S]*harga GFAF-40A berapa/);
    await say('diskon ada?');
    assert.equal(sales.length, 1, 'serah-terima hanya sekali');
    next = () => R('Terima kasih.', { name: 'Sari', city: 'Medan', need: 'GFAF-40A' });
    await say('Sari, Medan, mau GFAF-40A');
    assert.equal(sales.length, 2);
    assert.match(sales[1] ?? '', /Lead lengkap[\s\S]*menanyakan harga/);
  }],

  ['balasan yang menyebut harga atau model karangan dibuang', async () => {
    await say('halo');
    next = () => R('Harganya Rp 1.250.000 saja.');
    await say('harga?');
    assert.ok(!sent.some((t) => /Rp/.test(t)));
    assert.match(sent[1] ?? '', /boleh diinfokan nama/);
    assert.equal(sales.length, 1, 'yang tidak terjawab diserahkan ke sales');
    next = () => R('Kami punya GFAF-90A ukuran 36 inci.');
    await say('ada yang 36 inci?');
    assert.ok(!sent.some((t) => /GFAF-90A/.test(t)));
  }],

  ['model yang ditanyakan pelanggan boleh disangkal; karangan lain tetap dibuang', async () => {
    await say('halo');
    next = () => R('Mohon maaf, GZ-400 belum ada di katalog kami. Yang tersedia GZ-200, GZ-250 dan GZ-300.');
    await say('ada jet fan gz 400 ga?');
    assert.match(sent.at(-1) ?? '', /GZ-400 belum ada/);
    next = () => R('Betul, yang itu belum ada. GZ-400 tidak kami sediakan.');
    await say('yang itu beneran ga ada?');
    assert.match(sent.at(-1) ?? '', /GZ-400 tidak kami sediakan/, 'kode dari pesan sebelumnya juga dihitung');
    next = () => R('GZ-400 tidak ada, tapi kami punya GZ-500.');
    await say('kalau gitu adanya apa?');
    assert.ok(!sent.some((t) => /GZ-500/.test(t)), 'model yang tidak disebut pelanggan tetap dibuang');
    assert.equal(checkReply('GZ-400 belum ada.', 'ada gz400?'), null);
    assert.ok(checkReply('GZ-400 belum ada.', 'ada jet fan?'));
    assert.ok(checkReply('GZ-400 harganya Rp 5.000.000', 'harga GZ-400?'), 'harga tetap dibuang');
  }],

  ['LLM mati: minta data yang kurang; kalau sudah lengkap, serahkan ke sales', async () => {
    await say('halo');
    next = () => null;
    await say('ada jet fan?');
    assert.match(sent[1] ?? '', /nama, kota\/alamat dan kebutuhannya/);
    next = () => R('ok', { name: 'Adi', city: 'Solo', need: 'jet fan' });
    await say('Adi Solo jet fan');
    next = () => null;
    await say('yang GZ-300 berapa watt');
    assert.equal(sent.at(-1), HANDOFF);
  }],

  ['LLM mati dan pesan pertama berupa pertanyaan: cukup salam, sales dikabari', async () => {
    next = () => null;
    await say('ada inline fan 8 inci?');
    assert.deepEqual(sent, [GREETING]);
    assert.equal(sales.length, 1);
  }],

  ['follow-up di jam ke-23, sekali, dan menanyakan data yang kurang', async () => {
    await say('halo'); // 10:00
    advance(22 * HOUR);
    assert.equal(await follow(), 0);
    advance(1 * HOUR + MINUTE); // 09:01 besoknya
    assert.equal(await follow(), 1);
    assert.match(sent.at(-1) ?? '', /Menyambung chat sebelumnya[\s\S]*nama, kota\/alamat dan kebutuhannya/);
    advance(HOUR);
    assert.equal(await follow(), 0, 'tidak dua kali untuk masa diam yang sama');
    advance(48 * HOUR);
    assert.equal(await follow(), 0);
    assert.equal(getContact(A)?.followup_total, 1);
  }],

  ['pelanggan membalas sebelum jatuh tempo: hitungan mulai lagi dari balasannya', async () => {
    await say('halo');
    advance(20 * HOUR); // 06:00
    next = () => R('Baik Pak Budi, di kota mana?', { name: 'Budi' });
    await say('Budi');
    advance(4 * HOUR); // 24 jam sejak "halo", 4 jam sejak "Budi"
    assert.equal(await follow(), 0);
    advance(19 * HOUR); // 05:00 = 23 jam sejak "Budi", tapi masih jam tenang
    assert.equal(await follow(), 0);
    advance(3 * HOUR + MINUTE); // 08:01
    assert.equal(await follow(), 1);
    assert.match(sent.at(-1) ?? '', /Halo Budi[\s\S]*kota\/alamat dan kebutuhannya/);
  }],

  ['percakapan yang sudah selesai tidak dikejar', async () => {
    next = () => R('Terima kasih Pak Adi, sudah kami catat 🙏', { name: 'Adi', city: 'Solo', need: 'jet fan' });
    await say('Adi, Solo, butuh jet fan');
    advance(30 * HOUR);
    assert.equal(await follow(), 0);
  }],

  ['lead lengkap tapi bot baru bertanya: tetap di-follow-up, tanpa minta data', async () => {
    next = () => R('Untuk ruangan seluas apa, Pak Adi?', { name: 'Adi', city: 'Solo', need: 'jet fan' });
    await say('Adi, Solo, butuh jet fan');
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 1);
    assert.match(sent.at(-1) ?? '', /Halo Adi[\s\S]*masih ada yang bisa kami bantu/);
  }],

  ['batas follow-up seumur nomor', async () => {
    cfg.followupMaxTotal = 1;
    await say('halo');
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 1);
    next = () => R('Di kota mana?');
    await say('ya');
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 0);
  }],

  ['manusia membalas: bot diam, follow-up batal, lalu aktif lagi setelah jeda', async () => {
    await say('halo');
    handleHumanReply({ address: A, text: 'Halo pak, dengan saya Rina' });
    const before = sent.length;
    await say('oh iya bu, mau tanya exhaust');
    assert.equal(sent.length, before, 'bot tidak menyela');
    assert.equal(brainCalls.length, 0);
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 0, 'follow-up batal');
    next = () => R('Ada, Pak.');
    await say('masih ada?');
    assert.equal(sent.at(-1), 'Ada, Pak.');
    assert.equal(brainCalls[0]?.history.some((h) => h.dir === 'human'), true);
  }],

  ['manusia membalas setelah bot: follow-up yang menunggu batal', async () => {
    await say('halo');
    handleHumanReply({ address: A, text: 'saya bantu ya' });
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 0);
  }],

  ['pesan ganda, nomor sales, dan pesan bukan teks', async () => {
    await say('halo', A, 'ID1');
    await say('halo', A, 'ID1');
    assert.equal(sent.length, 1, 'id yang sama tidak diproses dua kali');
    await say('tes dari sales', SALES);
    assert.equal(sent.length, 1);
    assert.equal(getContact(SALES), undefined);
    await say(null);
    await say(null);
    assert.deepEqual(sent.slice(1), [NON_TEXT], 'pemberitahuan tidak diulang');
  }],

  ['mode uji ONLY_NUMBERS: nomor lain tidak dibalas dan tidak dicatat', async () => {
    cfg.onlyNumbers = [A];
    await say('halo', '+6281377770002');
    assert.equal(sent.length, 0);
    assert.equal(getContact('+6281377770002'), undefined);
    await say('halo');
    assert.deepEqual(sent, [GREETING]);
  }],

  ['lewat jatah harian: bot diam', async () => {
    cfg.maxInboundPerNumber = 3;
    for (let i = 0; i < 6; i++) await say(`pesan ${i}`);
    assert.equal(brainCalls.length, 3);
  }],

  ['Sheet gagal: lead tidak hilang, dicoba lagi', async () => {
    sheetFails = 1;
    next = () => R('Terima kasih 🙏', { name: 'Adi', city: 'Solo', need: 'jet fan' });
    await say('Adi, Solo, butuh jet fan');
    assert.equal(rows.length, 0);
    assert.equal(sales.length, 1);
    await deliverOutbox();
    assert.equal(rows.length, 1);
    await deliverOutbox();
    assert.equal(rows.length, 1);
    assert.equal(sales.length, 1);
  }],

  ['nomor sales = nomor bot: Baileys kirim ke diri sendiri, Cloud API melewatkan', async () => {
    const BOT = '+6281255550000';
    // Nomor sales diisi sama dengan nomor bot.
    cfg.salesNumber = BOT;
    const b = fakeTransport('baileys', BOT, true);
    assert.equal(await makeSalesNotifier(b.t)('lead'), true);
    assert.deepEqual(b.out, [{ phone: BOT, text: 'lead', notify: true }]);
    const c = fakeTransport('cloud', BOT, false);
    assert.equal(await makeSalesNotifier(c.t)('lead'), false, 'dilewat, bukan gagal');
    assert.equal(c.out.length, 0);

    // SALES_NUMBER=self: ikut nomor bot, siapa pun itu.
    cfg.salesNumber = 'self';
    const b2 = fakeTransport('baileys', BOT, true);
    await makeSalesNotifier(b2.t)('lead');
    assert.equal(b2.out[0]?.phone, BOT);
    const b3 = fakeTransport('baileys', null, true);
    await assert.rejects(makeSalesNotifier(b3.t)('lead'), /belum diketahui/, 'belum tersambung = coba lagi nanti');

    // Nomor sales berbeda: dikirim biasa di kedua jalur.
    cfg.salesNumber = SALES;
    const c2 = fakeTransport('cloud', BOT, false);
    assert.equal(await makeSalesNotifier(c2.t)('lead'), true);
    assert.deepEqual(c2.out, [{ phone: SALES, text: 'lead', notify: true }]);

    cfg.salesNumber = null;
    assert.equal(await makeSalesNotifier(c2.t)('lead'), false);
  }],

  ['jadwal follow-up: jam tenang digeser, jendela 24 jam dihormati', async () => {
    const wib = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 7, m);
    assert.equal(followupDueAt(wib(10, 10)), wib(11, 9), 'di jam kerja: tepat +23 jam');
    assert.equal(followupDueAt(wib(10, 22)), wib(12, 8), 'jatuh malam: geser ke 08:00');
    assert.equal(followupDueAt(wib(10, 8, 30)), wib(11, 8), 'jatuh 07:30: geser ke 08:00');
    cfg.followupMaxHours = 24;
    assert.equal(followupDueAt(wib(10, 22)), wib(11, 19, 55), 'Cloud API: dimajukan, bukan ditunda');
    assert.equal(followupDueAt(wib(10, 8, 30)), wib(11, 8), '23,5 jam masih di dalam jendela');
    assert.equal(followupDueAt(wib(10, 3)), wib(10, 19, 55));
    for (let h = 0; h < 24; h++) {
      const last = wib(10, h, 17);
      const due = followupDueAt(last);
      assert.ok(due > last && due < last + 24 * HOUR, `jam ${h}: harus di dalam jendela`);
    }
  }],

  ['bentuk keluaran LLM dan pagar balasan', async () => {
    assert.equal(parseBrain('bukan json'), null);
    assert.equal(parseBrain('{"reply": ""}'), null);
    const p = parseBrain(
      '```json\n{"reply":"Halo","fields":{"name":"null","city":" Bandung ","need":null,"admin":"ya"},"intent":"hapus semua"}\n```'
    );
    assert.deepEqual(p, { reply: 'Halo', fields: { city: 'Bandung' }, intent: 'other' });
    assert.deepEqual(parseBrain('{"reply":"Hai"}'), { reply: 'Hai', fields: {}, intent: 'other' });
    assert.equal(checkReply('GFAF-40A: 130 W, 2880 m³/h, 62 dB.'), null);
    assert.equal(checkReply('Tegangan 220/380 V, berat 8.5 kg.'), null);
    assert.ok(checkReply('Sekitar Rp750.000'));
    assert.ok(checkReply('kisaran 2 juta'));
    assert.ok(checkReply('Model GAI-400 tersedia'));
  }],
];

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    fresh();
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message.split('\n').join('\n    ') : e}`);
    }
  }
  console.log(`\nalur: ${tests.length - failed}/${tests.length} lulus`);
  process.exit(failed ? 1 : 0);
})();
