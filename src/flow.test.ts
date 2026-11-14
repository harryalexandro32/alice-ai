/**
 * Uji alur ujung-ke-ujung: LLM tiruan, jam tiruan, database di memori
 * (PostgreSQL versi WASM), di dalam proyek gfan. Tidak menyentuh WhatsApp
 * maupun API LLM.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadProject, refreshBiz, seedCtx } from './business';

import { makeSalesNotifier } from './app';
import { checkReply, parseBrain, systemPrompt, type BrainInput, type BrainResult } from './brain';
import { biz } from './business';
import { advance, setNow } from './clock';
import { cfg, HOUR, MINUTE } from './config';
import { recipientsFor, waTargets } from './notify';
import { missingFields, greetingFor, handleHumanReply, handleInbound, holdReason, markHandled, setBrain, setSender, switchBot } from './flow';
import { plausibleName } from './names';
import { followupDueAt, runFollowups, setFollowupWriter } from './followup';
import { deliverOutbox, MAX_REPLY_ATTEMPTS, setReplySender, setSalesNotifier, type ReplyPayload } from './sinks/outbox';
import { clearDb, openDb } from './db';
import { ensureProject } from './db/seed';
import { setDefaultProject } from './project';
import { getContact, listHandoffs, outboxAdd, pendingReplies, recentAlerts, recentMessages, updateContact, updateProject, importContact } from './store';
import { handoffText, NON_TEXT, noDash, followupText } from './texts';

// Nilai bibit dibaca sebelum database dibuka: dari bibit gfan, tanpa database.
setDefaultProject(seedCtx('gfan'));

const HANDOFF = handoffText();
import type { Transport } from './transport/types';

const GREETING = biz.greeting;
const A = '+6281211110001';
const SALES = '+6281299990001';
/** Selasa 10 Nov 2026, 10:00 WIB. */
const T0 = Date.UTC(2026, 10, 10, 3, 0);

let sent: string[] = [];
let sales: string[] = [];
let brainCalls: BrainInput[] = [];
let next: (i: BrainInput) => BrainResult | null = () => null;
/** Berapa kali lagi notifikasi ke sales dibuat gagal (WhatsApp putus). */
let salesFails = 0;

const R = (
  reply: string,
  fields: Record<string, string> = {},
  intent: BrainResult['intent'] = 'info',
  photos: string[] = [],
  docs: string[] = [],
  summary = ''
): BrainResult => ({ reply, fields, intent, photos, docs, summary });

const SEED_PRODUCTS = biz.products;
const SEED_RULES = biz.styleRules;

async function fresh(): Promise<void> {
  await clearDb();
  await ensureProject('gfan', 'gfan', 'GFAN Indonesia');
  setDefaultProject((await loadProject('gfan'))!);
  setNow(T0);
  cfg.tz = 'Asia/Jakarta';
  cfg.salesNumber = SALES;
  cfg.followupAfterHours = 23;
  cfg.followupAfterHoursMax = 23;
  cfg.followupStartHour = 8;
  cfg.followupEndHour = 20;
  cfg.followupMaxHours = 0;
  cfg.followupMaxTotal = 2;
  cfg.humanPauseHours = 12;
  cfg.maxInboundPerNumber = 40;
  cfg.onlyNumbers = [];
  sent = [];
  sales = [];
  brainCalls = [];
  salesFails = 0;
  next = () => R('Baik.');
  biz.files = [];
  biz.products = SEED_PRODUCTS;
  biz.stopAfterHuman = true;
  biz.recipients = [];
  biz.notifyRoutes = {};
  cfg.llmVision = true;
  cfg.sttApiKey = '';
  cfg.sttBaseUrl = '';
  biz.styleRules = SEED_RULES;
  biz.knownAt = 0;
  // Tes tidak pernah memanggil LLM sungguhan: bawaan = kalimat tetap.
  setFollowupWriter(async () => null);
  setSender(async (_to, text, image, fileName) =>
    void sent.push(image ? `[${fileName ? 'pdf' : 'gambar'}:${fileName ?? image.split(/[\\/]/).pop()}] ${text}` : text)
  );
  setSalesNotifier(async (text) => {
    if (salesFails > 0) {
      salesFails -= 1;
      throw new Error('wa down');
    }
    sales.push(text);
    return true;
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

  ['data lead tergabung dari beberapa pesan; sales dikabari tepat sekali', async () => {
    await say('halo');
    next = () => R('Baik Pak Budi, di kota mana?', { name: 'Budi' });
    await say('saya Budi');
    assert.equal(sales.length, 0);
    next = () => R('Siap. Butuhnya untuk apa?', { city: 'Surabaya' });
    await say('di Surabaya');
    assert.equal((await getContact(A))?.lead.name, 'Budi', 'nama tidak boleh terhapus');
    assert.deepEqual(brainCalls.at(-1)?.known, { name: 'Budi' });
    next = () => R('Baik, kami catat.', { need: 'exhaust fan gudang' });
    await say('butuh exhaust buat gudang');
    assert.equal(sales.length, 1);
    assert.match(sales[0] ?? '', /Lead lengkap/);
    assert.match(sales[0] ?? '', /Nama: Budi\nKota\/alamat: Surabaya\nKebutuhannya: exhaust fan gudang/);
    assert.match(sales[0] ?? '', /wa\.me\/6281211110001/);
    next = () => R('Sama-sama.', { need: 'exhaust fan gudang 16 inci' });
    await say('yang 16 inci ya');
    assert.equal(sales.length, 1, 'tidak dikabari dua kali');
    assert.equal((await getContact(A))?.lead.need, 'exhaust fan gudang 16 inci', 'koreksi menggantikan');
  }],

  ['tanya harga sebelum data lengkap: sales dikabari sekali, lalu lead lengkap menyusul', async () => {
    await say('halo');
    next = () => R('Untuk harga, tim kami yang akan menginfokan. Boleh tahu namanya?', {}, 'handoff');
    await say('harga GFAF-40A berapa');
    assert.equal(sales.length, 1);
    assert.match(sales[0] ?? '', /perlu dibantu[\s\S]*menanyakan harga\/stok[\s\S]*harga GFAF-40A berapa/);
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
    assert.equal((await getContact(A))?.followup_total, 1);
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

  ['manusia membalas (bawaan): bot tidak ikut campur lagi di chat itu', async () => {
    await say('halo');
    await handleHumanReply({ address: A, text: 'Halo pak, dengan saya Rina' });
    const before = sent.length;
    advance(30 * 24 * HOUR);
    await say('masih ada?');
    assert.equal(sent.length, before, 'sebulan kemudian pun bot tetap diam');
    assert.equal(brainCalls.length, 0);
    assert.equal(await follow(), 0);
    // Pelanggan lain tidak terpengaruh.
    next = () => R('Ada, Bu.');
    await say('halo', '+6281377770009');
    await say('ada exhaust?', '+6281377770009');
    assert.equal(sent.at(-1), 'Ada, Bu.');
    // Admin yang lebih dulu mengirimi nomor yang belum pernah chat: bot juga tidak menyapa.
    await handleHumanReply({ address: '+6281377770010', text: 'Halo Pak, ini penawarannya' });
    const n = sent.length;
    await say('oke terima kasih', '+6281377770010');
    assert.equal(sent.length, n, 'tidak ada salam dari bot di chat yang dimulai admin');
    // Setelan dimatikan: kembali ke aturan jeda.
    biz.stopAfterHuman = false;
    advance(13 * HOUR);
    next = () => R('Masih ada, Pak.');
    await say('masih ada kan?');
    assert.equal(sent.at(-1), 'Masih ada, Pak.');
  }],

  ['manusia membalas, setelan dimatikan: bot diam, follow-up batal, lalu aktif lagi setelah jeda', async () => {
    biz.stopAfterHuman = false;
    await say('halo');
    await handleHumanReply({ address: A, text: 'Halo pak, dengan saya Rina' });
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
    await handleHumanReply({ address: A, text: 'saya bantu ya' });
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 0);
  }],

  ['ringkasan percakapan: disimpan tiap giliran dan diberikan lagi ke LLM', async () => {
    await say('halo');
    next = () => R('Ukurannya berapa, Pak?', {}, 'info', [], [], 'Cari exhaust untuk gudang; menunggu ukuran ruangan.');
    await say('butuh exhaust gudang');
    assert.equal((await getContact(A))?.summary, 'Cari exhaust untuk gudang; menunggu ukuran ruangan.');
    next = () => R('Baik.');
    await say('10x20');
    assert.equal(brainCalls.at(-1)?.summary, 'Cari exhaust untuk gudang; menunggu ukuran ruangan.');
    assert.equal((await getContact(A))?.summary, 'Cari exhaust untuk gudang; menunggu ukuran ruangan.', 'ringkasan kosong tidak menghapus yang lama');
  }],

  ['bot tidak bisa menjawab: staf dikabari dengan pertanyaannya, tidak tiap pesan', async () => {
    await say('halo');
    next = () => R('Datanya belum ada di saya, tim kami yang akan bantu ya.', { name: 'Budi' }, 'handoff');
    await say('bisa custom warna?');
    assert.equal(sales.length, 1);
    assert.match(sales[0]!, /Bot tidak bisa menjawab, perlu dibantu/);
    assert.match(sales[0]!, /bisa custom warna\?/);
    assert.match((await recentAlerts(5))[0]!.text, /Budi \(\+6281211110001\): "bisa custom warna\?"/);
    assert.equal((await recentAlerts(5))[0]!.kind, 'butuh-staf');
    await say('bisa nggak?');
    assert.equal(sales.length, 1, 'pertanyaan susulan dalam 30 menit tidak membanjiri staf');
    advance(31 * MINUTE);
    await say('halo? ada orang?');
    assert.equal(sales.length, 2, 'masih menunggu setelah 30 menit: dikabari lagi');
    assert.equal((await recentAlerts(5)).length, 2);
    // Balasan yang ditolak pagar juga berarti bot tidak bisa menjawab.
    next = () => R('Harganya Rp 1.000.000', {}, 'info');
    advance(31 * MINUTE);
    await say('harganya berapa');
    assert.equal(sales.length, 3);
  }],

  ['foto, suara, stiker: staf dikabari, pelanggan diberi tahu, stiker didiamkan', async () => {
    const media = (m: 'foto' | 'suara' | 'stiker', text: string | null = null, id = '') =>
      handleInbound({ phone: A, address: A, text, waId: id || null, media: m }).then(() => deliverOutbox());
    await say('halo');
    const n = sent.length;
    await media('stiker');
    assert.equal(sent.length, n, 'stiker tidak dibalas');
    assert.equal(sales.length, 0);
    await media('foto');
    assert.match(sent.at(-1)!, /foto-nya sudah kami terima/);
    assert.match(sales[0]!, /Kirim foto/);
    assert.equal((await getContact(A))?.needs_sales, 1);
    assert.equal(brainCalls.length, 0, 'foto tanpa keterangan tidak memanggil LLM');
    await media('foto');
    assert.equal(sent.filter((t) => /foto-nya sudah kami terima/.test(t)).length, 1, 'foto beruntun tidak dijawab berulang');
    await media('suara');
    assert.match(sent.at(-1)!, /pesan suaranya/);
    // Foto DENGAN keterangan: keterangannya dijawab, dan LLM tahu ada foto yang tidak bisa dilihatnya.
    next = () => R('Baik, tim kami cek fotonya ya. Ruangannya ukuran berapa?');
    await media('foto', 'ini ruangan saya, cocok pakai yang mana?');
    assert.match(brainCalls.at(-1)!.note ?? '', /melampirkan foto yang TIDAK bisa kamu lihat/);
    assert.equal(brainCalls.at(-1)!.text, 'ini ruangan saya, cocok pakai yang mana?');
    assert.match(sent.at(-1)!, /tim kami cek fotonya/);
  }],

  ['foto dianalisis: fotonya sampai ke LLM, staf tidak perlu dikabari', async () => {
    const JPG = { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mime: 'image/jpeg' };
    const photo = (text: string | null, fetchMedia: () => Promise<typeof JPG | null>) =>
      handleInbound({ phone: A, address: A, text, waId: null, media: 'foto', fetchMedia }).then(() => deliverOutbox());
    await say('halo');
    next = () => R('Dari fotonya ini kamar mandi kecil, plafonnya gypsum. Cocok GFC10-10A. Ukurannya berapa × berapa?', {}, 'info', [], [], 'Kirim foto kamar mandi kecil berplafon gypsum; disarankan GFC10-10A.');
    await photo(null, async () => JPG);
    assert.equal(brainCalls.at(-1)!.image?.mime, 'image/jpeg', 'fotonya ikut ke LLM');
    assert.equal(brainCalls.at(-1)!.text, 'Pelanggan mengirim foto tanpa keterangan.');
    assert.match(brainCalls.at(-1)!.note ?? '', /Amati fotonya/);
    assert.match(sent.at(-1)!, /Dari fotonya ini kamar mandi kecil/);
    assert.equal(sales.length, 0, 'bot menjawab sendiri: staf tidak dikabari');
    assert.match((await getContact(A))?.summary ?? '', /foto kamar mandi/, 'yang terlihat di foto tersimpan di ringkasan');
    // Dengan keterangan: keterangannya jadi pertanyaannya.
    await photo('ini cocok pakai yang mana?', async () => JPG);
    assert.equal(brainCalls.at(-1)!.text, 'ini cocok pakai yang mana?');
    assert.ok(brainCalls.at(-1)!.image);

    // Foto gagal diunduh, terlalu besar, atau analisis dimatikan: kembali ke cara lama.
    const n = brainCalls.length;
    await photo(null, async () => { throw new Error('unduh gagal'); });
    assert.equal(brainCalls.length, n, 'tanpa foto dan tanpa teks, LLM tidak dipanggil');
    assert.match(sent.at(-1)!, /foto-nya sudah kami terima/);
    assert.match(sales.at(-1)!, /Kirim foto/);
    cfg.llmVision = false;
    let asked = 0;
    await photo('lihat ya', async () => { asked += 1; return JPG; });
    assert.equal(asked, 0, 'dimatikan: fotonya tidak diunduh sama sekali');
    assert.equal(brainCalls.at(-1)!.image, undefined);
    assert.match(brainCalls.at(-1)!.note ?? '', /TIDAK bisa kamu lihat/);
    cfg.llmVision = true;
    await photo('besar', async () => ({ data: Buffer.alloc(7_000_000), mime: 'image/jpeg' }));
    assert.equal(brainCalls.at(-1)!.image, undefined, 'foto terlalu besar tidak dikirim ke LLM');
  }],

  ['penerima notifikasi: pemilik dan staf, tiap jenis kabar ke rutenya', async () => {
    const OWNER = '+6281100000001';
    const STAFF1 = '+6281100000002';
    const STAFF2 = '+6281100000003';
    biz.recipients = [
      { name: 'Pak Harry', role: 'owner', phone: OWNER, email: 'owner@contoh.com', telegram: '111' },
      { name: 'Rina', role: 'staff', phone: STAFF1, email: '', telegram: '' },
      { name: 'Dedi', role: 'staff', phone: STAFF2, email: 'dedi@contoh.com', telegram: '' },
    ];
    assert.deepEqual(waTargets('lead'), [STAFF1, STAFF2], 'lead -> staf (bawaan)');
    assert.deepEqual(waTargets('butuh-staf'), [STAFF1, STAFF2]);
    assert.deepEqual(waTargets('llm'), [OWNER], 'urusan sistem -> pemilik (bawaan)');
    biz.notifyRoutes = { lead: 'both', 'butuh-staf': 'owner', llm: 'none' };
    assert.deepEqual(waTargets('lead'), [OWNER, STAFF1, STAFF2]);
    assert.deepEqual(waTargets('butuh-staf'), [OWNER]);
    assert.deepEqual(waTargets('llm'), []);
    assert.deepEqual(recipientsFor('lead').map((r) => r.email).filter(Boolean), ['owner@contoh.com', 'dedi@contoh.com']);

    // Notifikasi WA lewat antrean sampai ke semua nomor rutenya.
    const t = fakeTransport('baileys', '+6281255550000', true);
    assert.equal(await makeSalesNotifier(t.t)('halo', 'lead'), true);
    assert.deepEqual(t.out.map((o) => o.phone), [OWNER, STAFF1, STAFF2]);
    const t2 = fakeTransport('baileys', '+6281255550000', true);
    await makeSalesNotifier(t2.t)('tolong', 'butuh-staf');
    assert.deepEqual(t2.out.map((o) => o.phone), [OWNER]);

    // Pesan dari pemilik/staf bukan pesan calon pelanggan.
    await say('tes dari staf', STAFF1);
    assert.equal((await getContact(STAFF1)), undefined);
    assert.equal(sent.length, 0);

    // Daftar kosong: kembali ke nomor sales proyek untuk semua jenis kabar.
    biz.recipients = [];
    biz.notifyRoutes = {};
    assert.deepEqual(waTargets('lead'), [SALES]);
    assert.deepEqual(waTargets('wa-putus'), [SALES]);
  }],

  ['nama profil WhatsApp: nama orang dipastikan, julukan dan inisial diabaikan', async () => {
    // Yang tampak nama orang (dirapikan huruf besar-kecilnya)…
    for (const [raw, want] of [
      ['Budi Santoso', 'Budi Santoso'], ['budi', 'Budi'], ['SITI AMINAH', 'Siti Aminah'], ['  Rina 🌸', 'Rina'], ["Nur'aini", "Nur'aini"],
      ['Dedi S.', 'Dedi S.'], ['Muhammad Rizky Pratama', 'Muhammad Rizky Pratama'],
    ] as const) assert.equal(plausibleName(raw), want, raw);
    // …dan yang tidak jelas: bot bertanya seperti biasa.
    for (const raw of ['J', 'A.', 'demonslayer', 'DemonSlayer', 'xXx_gamer_xXx', 'Budi123', 'Toko Maju Jaya', 'CS GFAN', 'Admin', '🔥🔥🔥', '.', 'aaaa', 'bcd',
      'PT Sinar Abadi', 'King Slayer', '081234567890', 'user', '', null, undefined]) assert.equal(plausibleName(raw), null, String(raw));

    const first = (profileName: string | undefined, phone: string, text = 'halo') => handleInbound({ phone, address: phone, text, waId: null, ...(profileName ? { profileName } : {}) });

    // Nama orang: salamnya memastikan nama, tidak menanyakannya dari awal.
    await first('budi santoso', '+6281377770021');
    assert.match(sent.at(-1)!, /Dengan Bapak\/Ibu Budi Santoso, betul\?/);
    assert.ok(!/1\. Nama/.test(sent.at(-1)!), 'tidak meminta nama lagi');
    assert.equal((await getContact('+6281377770021'))?.wa_name, 'budi santoso');
    assert.equal((await getContact('+6281377770021'))?.lead.name, undefined, 'belum dianggap terkonfirmasi sebelum orangnya menjawab');
    // LLM diberi tahu nama profilnya, dan mengisi nama setelah pelanggan mengiyakan.
    next = () => R('Baik Pak Budi. Kebutuhannya untuk ruangan apa?', { name: 'Budi Santoso', city: 'Bekasi' });
    await first('budi santoso', '+6281377770021', 'iya betul, saya di Bekasi');
    assert.equal(brainCalls.at(-1)!.profileName, 'budi santoso');
    assert.equal((await getContact('+6281377770021'))?.lead.name, 'Budi Santoso');

    // Julukan, inisial, atau tanpa nama: salam biasa.
    for (const [name, phone] of [['demonslayer', '+6281377770022'], ['J', '+6281377770023'], [undefined, '+6281377770024']] as const) {
      await first(name, phone);
      assert.equal(sent.at(-1), GREETING, String(name));
    }
    // Julukan tetap diteruskan ke LLM apa adanya: ia yang menilai di percakapan berikutnya.
    next = () => R('Boleh tahu dengan siapa saya bicara?');
    await first('demonslayer', '+6281377770022', 'butuh exhaust');
    assert.equal(brainCalls.at(-1)!.profileName, 'demonslayer');

    // Salam khusus dikosongkan pemilik, atau profilnya tidak mengumpulkan nama: salam biasa.
    const known = biz.greetingKnown;
    biz.greetingKnown = '';
    await first('Sari Dewi', '+6281377770025');
    assert.equal(sent.at(-1), GREETING);
    biz.greetingKnown = known;
    assert.match(greetingFor({ wa_name: 'Sari Dewi', lead: {} }), /Sari Dewi/);
    assert.equal(greetingFor({ wa_name: 'Sari Dewi', lead: { name: 'Sari' } }), GREETING, 'nama sudah ada: tidak perlu dipastikan lagi');
  }],

  ['follow-up diacak di antara dua batas, tetap untuk satu masa diam, dan tidak melewati jendela Cloud API', async () => {
    cfg.followupAfterHoursMax = 25;
    cfg.followupStartHour = 0;
    cfg.followupEndHour = 24;
    const base = T0;
    const waits = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const phone = '+62812' + String(1000000 + i);
      const h = (followupDueAt(base, phone) - base) / HOUR;
      assert.ok(h >= 23 && h <= 25, `di luar 23–25 jam: ${h}`);
      assert.equal(followupDueAt(base, phone), followupDueAt(base, phone), 'putaran berikutnya tidak mengocok ulang');
      waits.add(Math.round(h * 60));
    }
    assert.ok(waits.size > 60, `kurang beragam: ${waits.size} nilai dari 200 pelanggan`);
    const hrs = [...waits].map((m) => m / 60);
    assert.ok(Math.min(...hrs) < 23.3 && Math.max(...hrs) > 24.7, 'menyebar ke kedua ujung rentang');
    // Pelanggan yang sama, masa diam berikutnya: jadwal baru.
    assert.notEqual(followupDueAt(base, A) - base, followupDueAt(base + HOUR, A) - (base + HOUR));
    // Batas atas lebih kecil dari batas bawah (salah isi): pakai batas bawah, tidak mundur.
    cfg.followupAfterHoursMax = 10;
    assert.equal(followupDueAt(base, A), base + 23 * HOUR);
    // Cloud API: acakan tidak membawa jadwal ke luar jendela 24 jam.
    cfg.followupAfterHoursMax = 25;
    cfg.followupMaxHours = 24;
    for (let i = 0; i < 50; i++) assert.ok(followupDueAt(base, '+62813' + i) <= base + 24 * HOUR - 10 * MINUTE);

    // Dari ujung ke ujung: belum waktunya di jam ke-23, sudah terkirim setelah jam ke-25.
    cfg.followupMaxHours = 0;
    await say('halo');
    next = () => R('Di kota mana?');
    await say('ya');
    advance(22 * HOUR + 59 * MINUTE);
    assert.equal(await follow(), 0);
    advance(2 * HOUR + 2 * MINUTE);
    assert.equal(await follow(), 1);
  }],

  ['"sudah ditangani": tanda perlu staf hilang sampai pelanggan butuh staf lagi', async () => {
    await say('halo');
    next = () => R('Tim kami yang akan bantu ya.', {}, 'handoff');
    await say('bisa custom warna?');
    assert.equal((await getContact(A))?.needs_sales, 1);
    await markHandled(A, T0 + 5000);
    next = () => R('Baik.');
    await say('oke');
    assert.equal((await getContact(A))?.needs_sales, 0, 'ditandai selesai dari dashboard');
    // Perintah yang sama tidak menghapus tanda yang muncul SETELAHNYA.
    next = () => R('Itu juga tim kami yang bantu.', {}, 'handoff');
    advance(HOUR);
    await say('garansinya gimana?');
    assert.equal((await getContact(A))?.needs_sales, 1, 'butuh staf lagi: tandanya kembali');
  }],

  ['pelanggan lama yang diimpor: tanpa salam perkenalan, nama sudah ada, dan "bot diam" dihormati', async () => {
    const OLD = '+6281400000001';
    const QUIET = '+6281400000002';
    // Yang dilakukan dashboard saat pemilik mengimpor daftar pelanggan lama.
    await importContact(OLD, { name: 'Pak Budi' }, false, T0 + 1);
    await importContact(QUIET, { name: 'Bu Sari' }, true, T0 + 1);
    next = () => R('Ada, Pak Budi. Untuk ruangan apa?');
    await say('ada exhaust 16 inci?', OLD);
    assert.deepEqual(sent, ['Ada, Pak Budi. Untuk ruangan apa?'], 'tidak ada salam pembuka untuk pelanggan lama');
    assert.equal(brainCalls.at(-1)!.known.name, 'Pak Budi');
    assert.match(brainCalls.at(-1)!.note ?? '', /PELANGGAN LAMA/);
    assert.equal((await getContact(OLD))?.imported, 1);
    // Yang diimpor dengan "bot diam": bot tidak menjawab, dan tetap diam sesudahnya.
    await say('halo, mau pesan lagi', QUIET);
    await say('halo?', QUIET);
    assert.equal(sent.length, 1);
    assert.equal(await holdReason(QUIET, T0), 'tombol');
    // Tombol Bot juga berlaku untuk pelanggan lama yang belum pernah chat.
    const LATER = '+6281400000004';
    await importContact(LATER, {}, true, T0);
    assert.equal((await getContact(LATER))?.pending_off, 1);
    await switchBot(LATER, 'on', T0 + 10_000);
    next = () => R('Ada.');
    await say('ada stok?', LATER);
    assert.equal(sent.at(-1), 'Ada.', 'dinyalakan dari dashboard sebelum ia pernah chat');
    // Orang baru tetap disambut seperti biasa.
    await say('halo', '+6281400000003');
    assert.equal(sent.at(-1), GREETING);
    // Impor yang sama tidak menimpa data yang sudah ada.
    await updateContact(OLD, { lead: { name: 'Budi Santoso', city: 'Bekasi' } });
    await importContact(OLD, { name: 'Pak Budi' }, false, T0 + 2);
    await say('oke', OLD);
    assert.equal((await getContact(OLD))?.lead.name, 'Budi Santoso');
  }],

  ['pesan suara ditranskripsi: isinya dijawab seperti ketikan; gagal = diteruskan ke staf', async () => {
    const hits: { auth?: string; model?: string }[] = [];
    let reply: { status: number; body: string } = { status: 200, body: JSON.stringify({ text: ' ada exhaust untuk kamar  mandi? ' }) };
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString('latin1');
      hits.push({ auth: req.headers.authorization, model: /name="model"\r\n\r\n([^\r]+)/.exec(raw)?.[1] });
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(reply.body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    cfg.sttBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cfg.sttApiKey = 'kunci-stt';
    const voice = (fetchMedia: () => Promise<{ data: Buffer; mime: string } | null>) =>
      handleInbound({ phone: A, address: A, text: null, waId: null, media: 'suara', fetchMedia }).then(() => deliverOutbox());
    const OGG = { data: Buffer.from('OggS-bukan-suara-sungguhan'), mime: 'audio/ogg; codecs=opus' };
    try {
      await say('halo');
      next = () => R('Ada, Pak. Ukuran kamar mandinya berapa?');
      await voice(async () => OGG);
      assert.deepEqual(hits[0], { auth: 'Bearer kunci-stt', model: cfg.sttModel });
      assert.equal(brainCalls.at(-1)!.text, 'ada exhaust untuk kamar mandi?');
      assert.match(brainCalls.at(-1)!.note ?? '', /PESAN SUARA yang ditranskripsi/);
      assert.equal(sent.at(-1), 'Ada, Pak. Ukuran kamar mandinya berapa?');
      assert.equal(sales.length, 0, 'terjawab bot: staf tidak dikabari');
      // Layanannya gagal: kembali ke "kami teruskan ke tim".
      reply = { status: 500, body: '{}' };
      const n = brainCalls.length;
      await voice(async () => OGG);
      assert.equal(brainCalls.length, n);
      assert.match(sent.at(-1)!, /pesan suaranya/);
      assert.match(sales.at(-1)!, /Kirim suara/);
    } finally {
      server.close();
    }
  }],

  ['follow-up ditulis untuk percakapannya; kalau penulisnya gagal, kalimat tetap yang dikirim', async () => {
    await say('halo');
    next = () => R('Ukuran gudangnya berapa, Pak?', { name: 'Budi' }, 'info', [], [], 'Cari exhaust gudang; menunggu ukuran.');
    await say('butuh exhaust gudang');
    const seen: { phone: string; hours: number; summary: string | null }[] = [];
    setFollowupWriter(async (c, hours) => {
      seen.push({ phone: c.phone, hours, summary: c.summary });
      return 'Halo Pak Budi, untuk exhaust gudangnya kemarin, ukuran ruangannya jadi berapa ya?';
    });
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 1);
    assert.equal(sent.at(-1), 'Halo Pak Budi, untuk exhaust gudangnya kemarin, ukuran ruangannya jadi berapa ya?');
    assert.equal(seen[0]?.summary, 'Cari exhaust gudang; menunggu ukuran.');
    assert.ok(seen[0]!.hours > 22.9 && seen[0]!.hours < 23.2);

    // Penulis melempar / mengembalikan null: follow-up tetap terkirim, dengan kalimat tetap.
    next = () => R('Di kota mana, Bu?');
    await say('halo', '+6281377770031');
    await say('mau tanya', '+6281377770031');
    setFollowupWriter(async () => { throw new Error('LLM mati'); });
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 1);
    assert.match(sent.at(-1)!, /Menyambung chat sebelumnya/);
  }],

  ['tanda pisah panjang tidak pernah keluar, dari sumber mana pun', async () => {
    const dash = /[–—]/;
    assert.equal(noDash('lalu arahkan model yang paling pas — bukan asal pilih.'), 'lalu arahkan model yang paling pas, bukan asal pilih.');
    assert.equal(noDash('Kebutuhannya 288–384 m³/h, model 4 – 6'), 'Kebutuhannya 288-384 m³/h, model 4-6');
    assert.equal(noDash('Model A — 5 pilihan —\n— cocok untuk toilet'), 'Model A, 5 pilihan\ncocok untuk toilet');
    assert.equal(noDash('Siap —. Baik — , ya'), 'Siap. Baik, ya');
    assert.equal(noDash('GFAF-40A tetap utuh, begitu juga 10-15 dan e-mail'), 'GFAF-40A tetap utuh, begitu juga 10-15 dan e-mail');
    assert.equal(parseBrain('{"reply":"Bisa, Pak — tinggal pilih ukurannya."}')?.reply, 'Bisa, Pak, tinggal pilih ukurannya.');

    // Jawaban LLM, salam dari dashboard, follow-up, dan keterangan lampiran: semuanya disaring.
    const greeting = biz.greeting;
    biz.greeting = 'Halo — selamat datang di toko kami — ada yang bisa dibantu?';
    biz.files = [{ id: 'd0000000b', file: 'd0000000b.pdf', name: 'Katalog — Seri A.pdf' }];
    biz.products = [{ name: 'GFAF-40A', description: '', price: '', stock: '', photos: [], pdf: 'd0000000b' }];
    try {
      next = () => R('Ada, Pak — ini katalognya. Ukuran 16–20 inci tersedia.', {}, 'info', [], ['d0000000b']);
      await say('halo ada katalog?');
      setFollowupWriter(async () => 'Halo Pak — jadi yang mana?');
      advance(23 * HOUR + MINUTE);
      await follow();
      assert.equal(sent[0], 'Halo, selamat datang di toko kami, ada yang bisa dibantu?');
      assert.equal(sent[1], 'Ada, Pak, ini katalognya. Ukuran 16-20 inci tersedia.');
      assert.equal(sent[2], '[pdf:Katalog Seri A.pdf] Katalog, Seri A');
      assert.equal(sent[3], 'Halo Pak, jadi yang mana?');
      assert.ok(sent.every((t) => !dash.test(t)), 'tidak ada satu pun kiriman yang membawa tanda pisah panjang');
      // Kabar ke staf dan kalimat tetap mesin juga bersih.
      next = () => null;
      await say('halo', '+6281377770041');
      await say('harga berapa', '+6281377770041');
      assert.ok([...sent, ...sales].every((t) => !dash.test(t)));
      assert.ok(!dash.test(followupText('Budi', [])) && !dash.test(followupText(null, missingFields({ lead: {} }))));
    } finally {
      biz.greeting = greeting;
    }
  }],

  ['aturan balasan dari pemilik masuk ke prompt; lampiran dikirim tanpa minta izin', async () => {
    assert.match(systemPrompt(), /ATURAN DARI PEMILIK[^\n]*\n- Pakai kalimat positif[\s\S]*airflow specialist[\s\S]*\n- Jangan basa-basi[\s\S]*\n- Format balasan ringkas/);
    assert.match(systemPrompt(), /tiap pilihan jadi bloknya sendiri/);
    biz.styleRules = ['Selalu tutup dengan "Salam sejuk dari kami".'];
    assert.match(systemPrompt(), /ATURAN DARI PEMILIK[^\n]*\n- Selalu tutup dengan "Salam sejuk dari kami"\./);
    assert.ok(!/airflow specialist/.test(systemPrompt()), 'aturan pemilik menggantikan bawaan, bukan menumpuk');
    biz.styleRules = [];
    assert.ok(!/ATURAN DARI PEMILIK/.test(systemPrompt()), 'tanpa aturan, bagiannya tidak ada');
    assert.match(systemPrompt(), /Jangan\s+menawarkannya dulu/);
    assert.match(systemPrompt(), /minta foto tetapi kolom Foto produk itu "-" sedangkan PDF-nya\s+ada: langsung lampirkan PDF-nya/);
    assert.match(systemPrompt(), /Jangan pernah memakai tanda pisah panjang/);
  }],

  ['tombol bot per pelanggan: dimatikan, lalu dikembalikan ke bot', async () => {
    await say('halo');
    await switchBot(A, 'off', T0 + 1000);
    const n = sent.length;
    await say('ada exhaust?');
    assert.equal(sent.length, n, 'dimatikan dari dashboard: bot diam');
    assert.equal((await holdReason(A, T0)), 'tombol');
    advance(23 * HOUR + MINUTE);
    assert.equal(await follow(), 0, 'tidak ada follow-up selama dimatikan');
    // Admin membalas, lalu pemilik mengembalikan chat ke bot.
    await handleHumanReply({ address: A, text: 'saya bantu ya' });
    await switchBot(A, 'on', T0 + 2 * 24 * HOUR);
    next = () => R('Ada, Pak.');
    await say('masih ada?');
    assert.equal(sent.at(-1), 'Ada, Pak.', 'dinyalakan: penahan dari tombol DAN dari admin dilepas');
    assert.equal((await holdReason(A, T0)), null);
    // Perintah yang sama tidak dijalankan dua kali: admin membalas lagi = bot mundur lagi.
    await handleHumanReply({ address: A, text: 'saya lanjutkan' });
    const m = sent.length;
    await say('oke');
    assert.equal(sent.length, m);
    assert.equal((await holdReason(A, T0)), 'admin');
  }],

  ['bot dijeda untuk semua chat: pesan tetap dicatat, tanpa balasan dan tanpa follow-up', async () => {
    await say('halo');
    assert.deepEqual(sent, [GREETING]);
    // Dashboard menekan "Bot dijeda untuk semua chat"; bot memuatnya sebelum giliran berikutnya.
    await updateProject('gfan', { paused: true });
    assert.equal(await refreshBiz(true), true);
    await say('ada exhaust 16 inci?');
    await say('halo?', '+6281377770031');
    assert.deepEqual(sent, [GREETING], 'tidak ada yang dibalas');
    assert.equal((await recentMessages(A, 5)).at(-1)?.text, 'ada exhaust 16 inci?', 'pesannya tetap dicatat');
    assert.ok(await getContact('+6281377770031'), 'kontak baru tetap dicatat');
    assert.equal(brainCalls.length, 0);
    advance(30 * HOUR);
    assert.equal(await follow(), 0, 'tidak ada follow-up selama dijeda');
    await updateProject('gfan', { paused: false });
    await refreshBiz(true);
    next = () => R('Ada, GFAF-40A.');
    await say('jadi ada?');
    assert.equal(sent.at(-1), 'Ada, GFAF-40A.', 'aktif lagi setelah jeda dimatikan');
  }],

  ['pesan ganda, nomor sales, dan pesan bukan teks', async () => {
    await say('halo', A, 'ID1');
    await say('halo', A, 'ID1');
    assert.equal(sent.length, 1, 'id yang sama tidak diproses dua kali');
    await say('tes dari sales', SALES);
    assert.equal(sent.length, 1);
    assert.equal((await getContact(SALES)), undefined);
    await say(null);
    await say(null);
    assert.deepEqual(sent.slice(1), [NON_TEXT], 'pemberitahuan tidak diulang');
  }],

  ['mode uji ONLY_NUMBERS: nomor lain tidak dibalas dan tidak dicatat', async () => {
    cfg.onlyNumbers = [A];
    await say('halo', '+6281377770002');
    assert.equal(sent.length, 0);
    assert.equal((await getContact('+6281377770002')), undefined);
    await say('halo');
    assert.deepEqual(sent, [GREETING]);
  }],

  ['foto: dikirim setelah teks, hanya yang ada, dan tidak diulang', async () => {
    biz.files = [
      { id: 'f0000000a', file: 'f0000000a.jpg', name: 'depan.jpg' },
      { id: 'd0000000b', file: 'd0000000b.pdf', name: 'Industrial Fan - GFan.pdf' },
      { id: 'f0000000c', file: 'f0000000c.jpg', name: 'tidak-terpasang.jpg' },
    ];
    biz.products = [{ name: 'GFAF-40A', description: 'Exhaust 16"', price: 'Rp 450.000', stock: 'ada', photos: ['f0000000a'], pdf: 'd0000000b' }];
    await say('halo');
    next = () => R('Ini fotonya ya, Pak.', {}, 'info', ['f0000000a']);
    await say('minta foto GFAF-40A');
    assert.deepEqual(sent.slice(1), ['Ini fotonya ya, Pak.', '[gambar:f0000000a.jpg] GFAF-40A']);
    next = () => R('Dayanya 130 W.');
    await say('yang tadi berapa watt');
    assert.equal(sent.filter((t) => t.startsWith('[gambar')).length, 1);
    assert.match(brainCalls.at(-1)!.history.map((h) => h.text).join('\n'), /\[foto:f0000000a\] GFAF-40A/, 'LLM melihat apa yang sudah terkirim');
    next = () => R('Harganya Rp 900.000', {}, 'info', ['f0000000a']);
    await say('foto lagi dong', '+6281377770003');
    assert.ok(!sent.some((t) => t.startsWith('[gambar') && sent.indexOf(t) > 3), 'balasan yang dibuang tidak membawa foto');
    assert.deepEqual(parseBrain('{"reply":"ok","photos":["f0000000a","karangan","f0000000a",7]}')?.photos, ['f0000000a']);

    // PDF: dikirim sebagai dokumen dengan nama berkasnya sendiri (satu PDF dipakai
    // banyak produk), dan DIKIRIM LAGI kalau pelanggan memintanya lagi.
    next = () => R('Ini brosurnya ya, Pak.', {}, 'info', [], ['d0000000b']);
    await say('ada brosurnya?');
    assert.equal(sent.at(-1), '[pdf:Industrial Fan - GFan.pdf] Industrial Fan - GFan');
    await say('mana katalognya? belum masuk');
    assert.equal(sent.filter((t) => t.startsWith('[pdf')).length, 2, 'diminta lagi = dikirim lagi');
    await say('kirim lagi');
    await say('lagi');
    assert.equal(sent.filter((t) => t.startsWith('[pdf')).length, 3, 'rem darurat: berkas yang sama paling banyak 3 kali');
    assert.match(systemPrompt(), /KECUALI pelanggan\s+memintanya lagi/);

    // Kiriman berkas gagal: bot tidak diam-diam mengingkari janjinya.
    const ok = sent.length;
    setSender(async (_to, text, image) => {
      if (image) throw new Error('unggah gagal');
      sent.push(text);
    });
    next = () => R('Ini fotonya ya, Bu.', {}, 'info', ['f0000000a']);
    await say('halo', '+6281377770011');
    await say('minta foto', '+6281377770011');
    assert.match(sent.at(-1)!, /belum berhasil terkirim/);
    assert.ok(sent.length > ok);
    // Foto tidak bisa menyamar jadi PDF, dan berkas yang tidak terpasang di produk tidak bisa dikirim.
    const mixed = parseBrain('{"reply":"ok","photos":["d0000000b","f0000000c"],"docs":["f0000000a","d0000000b"]}');
    assert.deepEqual([mixed?.photos, mixed?.docs], [[], ['d0000000b']]);

    // Harga yang tertulis di daftar produk boleh disebut; yang lain tetap ditolak.
    assert.equal(checkReply('GFAF-40A harganya Rp 450.000 ya, Pak.'), null);
    assert.equal(checkReply('Harganya Rp450.000,-'), null, 'ejaan lain dari harga yang sama');
    assert.equal(checkReply('Harganya Rp 400.000'), 'menyebut harga');
    assert.equal(checkReply('sekitar 450 ribu'), 'menyebut harga');
    assert.match(systemPrompt(), /harga dan stok yang TERTULIS di DAFTAR PRODUK/);
    assert.match(systemPrompt(), /GFAF-40A \| Exhaust 16" \| Rp 450.000 \| ada \| f0000000a \| d0000000b/);
    assert.match(systemPrompt(), /PERTANYAAN KEBUTUHAN\n- Ukuran ruangannya/);
  }],

  ['lewat jatah harian: bot diam', async () => {
    cfg.maxInboundPerNumber = 3;
    for (let i = 0; i < 6; i++) await say(`pesan ${i}`);
    assert.equal(brainCalls.length, 3);
  }],

  ['notifikasi sales gagal: lead tidak hilang, dicoba lagi tepat sekali', async () => {
    salesFails = 1;
    next = () => R('Terima kasih 🙏', { name: 'Adi', city: 'Solo', need: 'jet fan' });
    await say('Adi, Solo, butuh jet fan');
    assert.equal(sales.length, 0, 'percobaan pertama gagal');
    assert.ok(sent.some((t) => t.includes('Terima kasih')), 'balasan ke pelanggan tidak tertahan');
    await deliverOutbox();
    assert.equal(sales.length, 1, 'dicoba lagi di putaran berikutnya');
    assert.match(sales[0] ?? '', /Lead lengkap[\s\S]*Adi/);
    await deliverOutbox();
    assert.equal(sales.length, 1, 'yang sudah terkirim tidak dikirim lagi');
  }],

  ['pertanyaan yang dioper ke staf dicatat sekali untuk halaman Pengetahuan', async () => {
    await say('halo');
    next = () => R('Untuk itu tim kami yang akan menginfokan.', {}, 'handoff');
    await say('Bisa kirim ke Papua?');
    await say('bisa kirim ke papua??');
    const rows = await listHandoffs(false);
    assert.equal(rows.length, 1, 'pertanyaan yang sama (setelah dinormalkan) tidak dicatat dua kali');
    assert.deepEqual([rows[0]?.phone, rows[0]?.question], [A, 'Bisa kirim ke Papua?']);
    next = () => R('Baik, kami cek dulu.', {}, 'handoff');
    await say('Garansinya berapa lama?');
    assert.equal((await listHandoffs(false)).length, 2);
    next = () => R('GFAF-40A cocok untuk gudang.');
    await say('yang cocok untuk gudang apa?');
    assert.equal((await listHandoffs(false)).length, 2, 'jawaban biasa tidak dicatat');
  }],

  ['admin membalas dari HP: tahap "baru" pindah ke "dihubungi", tahap lain tidak disentuh', async () => {
    await say('halo');
    assert.equal((await getContact(A))?.stage, 'baru');
    await handleHumanReply({ address: A, text: 'Halo pak, dengan saya Rina' });
    const c = await getContact(A);
    assert.deepEqual([c?.stage, c?.last_dir, c?.followup_state], ['dihubungi', 'human', 'idle']);
    assert.equal((await recentMessages(A, 1))[0]?.dir, 'human');
    await updateContact(A, { stage: 'closing' });
    await handleHumanReply({ address: A, text: 'sudah saya kirim penawarannya' });
    assert.equal((await getContact(A))?.stage, 'closing', 'hanya "baru" yang berpindah otomatis');
  }],

  ['balasan dari dashboard: dikirim bot lewat antrean, menunggu selama belum tersambung, gagal terus = peringatan', async () => {
    await say('halo');
    const out: { phone: string; address: string; text: string }[] = [];
    let ready = false;
    let fail = false;
    setReplySender(async (to, text) => {
      if (fail) throw new Error('socket tertutup');
      out.push({ ...to, text });
    }, () => ready);
    try {
      const payload: ReplyPayload = { phone: A, address: A, text: 'Halo, ini dari dashboard', by: 'dashboard', message_id: null };
      await outboxAdd('reply', payload, T0);
      await deliverOutbox('reply');
      assert.equal(out.length, 0, 'WhatsApp belum tersambung: balasan menunggu');
      assert.equal((await pendingReplies(A))[0]?.attempts, 0, 'menunggu tidak dihitung gagal');
      ready = true;
      await deliverOutbox('reply');
      assert.deepEqual(out, [{ phone: A, address: A, text: 'Halo, ini dari dashboard' }]);
      assert.equal((await pendingReplies(A)).length, 0, 'terkirim = selesai');
      await deliverOutbox();
      assert.equal(out.length, 1, 'tidak dikirim dua kali');

      fail = true;
      await outboxAdd('reply', { ...payload, text: 'yang ini gagal' }, T0);
      for (let i = 0; i < MAX_REPLY_ATTEMPTS + 2; i++) await deliverOutbox('reply');
      assert.equal((await pendingReplies(A))[0]?.attempts, MAX_REPLY_ATTEMPTS, 'berhenti mencoba setelah batas');
      const alert = (await recentAlerts(10)).find((x) => x.kind === 'kiriman-gagal');
      assert.match(alert?.text ?? '', /yang ini gagal[\s\S]*socket tertutup/);
    } finally {
      setReplySender(null);
    }
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

    // Nomor sales "self": ikut nomor bot, siapa pun itu.
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
    assert.deepEqual(p, { reply: 'Halo', fields: { city: 'Bandung' }, intent: 'other', photos: [], docs: [], summary: '' });
    assert.deepEqual(parseBrain('{"reply":"Hai","summary":" Cari exhaust gudang;  menunggu ukuran. "}'), { reply: 'Hai', fields: {}, intent: 'other', photos: [], docs: [], summary: 'Cari exhaust gudang; menunggu ukuran.' });
    assert.equal(checkReply('GFAF-40A: 130 W, 2880 m³/h, 62 dB.'), null);
    assert.equal(checkReply('Tegangan 220/380 V, berat 8.5 kg.'), null);
    assert.ok(checkReply('Sekitar Rp750.000'));
    assert.ok(checkReply('kisaran 2 juta'));
    assert.ok(checkReply('Model GAI-400 tersedia'));
  }],
];

(async () => {
  await openDb('memory://');
  let failed = 0;
  for (const [name, fn] of tests) {
    await fresh();
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
