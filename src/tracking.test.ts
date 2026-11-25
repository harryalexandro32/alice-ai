/**
 * Pesanan dan resi: tangkapan nomor dari chat, tautan cek resi, pelacak
 * tiruan, aturan tahap, dan putaran berkala. Database di memori; tidak
 * menyentuh Binderbyte sungguhan (fetch diganti tiruan).
 */

import assert from 'node:assert/strict';

import { loadProject, seedCtx } from './business';
import { localStamp } from './clock';
import { cfg } from './config';
import { sql } from 'drizzle-orm';

import { clearDb, db, openDb } from './db';
import { ensureProject } from './db/seed';
import { setDefaultProject } from './project';
import {
  advanceStage, createContact, fillOrder, getContact, setStageNote, TRACK_RETRY_MS, trackingCandidates, trackUsageToday, updateContact, type Contact,
} from './store';
import {
  COURIERS, isCourier, parseOrderHints, phaseOf, runTracking, setTracker, trackContact, trackingEnabled, trackingLinks,
  type Tracker,
} from './tracking';

// Nilai bibit dibaca sebelum database dibuka: dari bibit gfan, tanpa database.
setDefaultProject(seedCtx('gfan'));

const A = '+6281234567890';
const T0 = Date.UTC(2026, 10, 25, 3, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Panggilan ke pelacak tiruan, dan jawaban berikutnya. */
let calls: { awb: string; courier: string; phoneLast5?: string }[] = [];
let answer: () => Promise<{ status: string; history: { date: string; desc: string; location: string }[] }> = async () => ({ status: 'ON PROCESS', history: [] });
const fake: Tracker = async (q) => {
  calls.push(q);
  return answer();
};

async function fresh(): Promise<void> {
  await clearDb();
  await ensureProject('gfan', 'gfan', 'GFAN Indonesia');
  setDefaultProject((await loadProject('gfan'))!);
  cfg.binderbyteKey = '';
  cfg.trackDailyMax = 500;
  calls = [];
  answer = async () => ({ status: 'ON PROCESS', history: [] });
  setTracker(fake);
}

/** Kontak dengan resi; sisanya diisi lewat `patch`. */
async function withAwb(phone: string, patch: Partial<Contact> = {}): Promise<Contact> {
  await createContact(phone, phone, T0);
  return updateContact(phone, { awb: 'JP1234567890', courier: 'jnt', awb_at: T0, ...patch });
}

const tests: [string, () => Promise<void>][] = [
  ['parseOrderHints: nomor pesanan, invoice, dan resi', async () => {
    assert.deepEqual(parseOrderHints('pesanan saya 576123456789012345 kak'), { orderRef: '576123456789012345' });
    assert.deepEqual(parseOrderHints('id 577000000000000001'), { orderRef: '577000000000000001' });
    assert.deepEqual(parseOrderHints('578123456789012345'), {}, 'hanya 576 dan 577');
    assert.deepEqual(parseOrderHints('5761234567890123456'), {}, '19 digit bukan id pesanan');
    assert.deepEqual(parseOrderHints('invoice INV/20261120/MPL/1234567890 ya'), { orderRef: 'INV/20261120/MPL/1234567890' });
    assert.deepEqual(parseOrderHints('inv/20200101/XX/I/123456'), { orderRef: 'inv/20200101/XX/I/123456' }, 'bentuk lama, apa adanya');
    // Resi Kurir Rekomendasi Tokopedia: kurirnya pasti, kata lain tidak dipakai.
    assert.deepEqual(parseOrderHints('resinya tkp01-abc1234 lewat jne'), { awb: 'TKP01-ABC1234', courier: 'kurir_tokopedia' });
    assert.deepEqual(parseOrderHints('TKP1234567890'), { awb: 'TKP1234567890', courier: 'kurir_tokopedia' });
    // Resi dengan kata kunci; kurir ditebak dari kata di pesan yang sama.
    assert.deepEqual(parseOrderHints('resi J&T: JP1234567890'), { awb: 'JP1234567890', courier: 'jnt' });
    assert.deepEqual(parseOrderHints('resi sicepat 004123456789'), { awb: '004123456789', courier: 'sicepat' });
    assert.deepEqual(parseOrderHints('kirim pakai pos, no. resi: p2311250012345'), { awb: 'P2311250012345', courier: 'pos' });
    assert.deepEqual(parseOrderHints('awb#cgk0123456789'), { awb: 'CGK0123456789' }, 'huruf kecil jadi kapital, tanpa kurir');
    assert.deepEqual(parseOrderHints('shopee express resi - SPXID012345678'), { awb: 'SPXID012345678', courier: 'spx' });
    // Angka polos tanpa kata kunci bukan resi: nomor HP dan harga.
    assert.deepEqual(parseOrderHints('hubungi 081234567890 ya, harganya 125000000000'), {});
    assert.deepEqual(parseOrderHints('resi belum ada kak'), {}, 'kata setelah "resi" tanpa angka bukan resi');
    assert.deepEqual(parseOrderHints('pesanan 576123456789012345 resi JNE CGK0123456789'), { orderRef: '576123456789012345', awb: 'CGK0123456789', courier: 'jne' });
    // "kode pos" di alamat bukan kurir POS.
    assert.deepEqual(parseOrderHints('resi JP1234567890 ya kak, alamat jl mawar 5 kode pos 40123'), { awb: 'JP1234567890' });
    assert.deepEqual(parseOrderHints('resi pos indonesia: CP017570939ID'), { awb: 'CP017570939ID', courier: 'pos' });
    assert.deepEqual(parseOrderHints('dikirim dari kantor pos, resi P2311250012345'), { awb: 'P2311250012345', courier: 'pos' });
    // Tanggal sesudah kata kunci bukan resi.
    assert.deepEqual(parseOrderHints('resi: 2026-11-25 baru dikirim'), {});
    assert.deepEqual(parseOrderHints('resi 25-11-2026 baru dikirim'), {});
    assert.deepEqual(parseOrderHints('resi - 25-11-2026'), {});
    assert.deepEqual(parseOrderHints('resi: 2026-11-25, resi JNE CGK0123456789'), { awb: 'CGK0123456789', courier: 'jne' }, 'resi sesudah tanggal tetap terbaca');
    // Kurir hanya ditebak dari kata dekat resi: nama jalan atau orang yang jauh tidak dipakai.
    assert.deepEqual(parseOrderHints('tolong kirim ke jalan lion no 5 blok c, komplek mawar indah, resi JP1234567890'), { awb: 'JP1234567890' });
    assert.deepEqual(parseOrderHints('resi JP1234567890 ya kak, tolong sampaikan terima kasih untuk pak ninja'), { awb: 'JP1234567890' });
    assert.deepEqual(parseOrderHints('resi JNE: CGK0123456789'), { awb: 'CGK0123456789', courier: 'jne' });
    assert.deepEqual(parseOrderHints('resi JP1234567890 pakai j&t'), { awb: 'JP1234567890', courier: 'jnt' });
    // Nomor HP sesudah kata "resi" bukan resi.
    assert.deepEqual(parseOrderHints('resi 081234567890'), {});
    assert.deepEqual(parseOrderHints('resi: 6281234567890'), {});
    assert.deepEqual(parseOrderHints('resi JP1234567890'), { awb: 'JP1234567890' });
    assert.deepEqual(parseOrderHints('resi 081234567890 eh salah, resi JNE CGK0123456789'), { awb: 'CGK0123456789', courier: 'jne' }, 'resi sesudah nomor HP tetap terbaca');
    // Nomor HP dengan tanda minus, tanpa awalan 0 atau 62, atau dengan spasi juga bukan resi.
    assert.deepEqual(parseOrderHints('resi 0812-3456-7890 ya kak'), {});
    assert.deepEqual(parseOrderHints('resi 85212345678'), {});
    assert.deepEqual(parseOrderHints('resi 0812 3456 7890'), {});
    assert.deepEqual(parseOrderHints('resi 62-812-3456-7890'), {});
    assert.deepEqual(parseOrderHints('resi TKP01-ABCDE12'), { awb: 'TKP01-ABCDE12', courier: 'kurir_tokopedia' });
    // Nomor pesanan sesudah kata "resi" hanya dicatat sebagai nomor pesanan.
    assert.deepEqual(parseOrderHints('resi 576123456789012345'), { orderRef: '576123456789012345' });
    assert.deepEqual(parseOrderHints('pesanan 576123456789012345 resi JP1234567890'), { orderRef: '576123456789012345', awb: 'JP1234567890' });
    assert.deepEqual(parseOrderHints('resi 576123456789012345 eh salah, resi JP1234567890'), { orderRef: '576123456789012345', awb: 'JP1234567890' }, 'resi sesudah nomor pesanan tetap terbaca');
  }],

  ['kurir, phaseOf, dan tautan cek resi', async () => {
    assert.equal(COURIERS.length, 25);
    assert.deepEqual(COURIERS.slice(0, 3).map((c) => c.code), ['jne', 'jnt', 'sicepat']);
    assert.ok(isCourier('kurir_tokopedia') && isCourier('rex'));
    assert.ok(!isCourier('dhl') && !isCourier('') && !isCourier(null));

    assert.equal(phaseOf(null), 'unknown');
    assert.equal(phaseOf(' '), 'unknown');
    for (const s of [
      'DELIVERED', 'Delivered', 'DELIVERED TO [BUDI]', 'Paket telah diterima oleh Budi', 'Terkirim', 'Paket terkirim', 'DITERIMA OLEH YBS',
      'sudah diterima', 'Sampai tujuan', 'Diterima oleh Budi',
      'Paket telah tiba di alamat tujuan', 'PROOF OF DELIVERY', 'Selesai antar', 'Pesanan selesai', 'Paket sudah sampai', 'Tiba di tujuan',
    ]) assert.equal(phaseOf(s), 'delivered', s);
    // Diterima oleh kurir, counter, atau agen saat pickup: paket baru berangkat.
    for (const s of [
      'Paket diterima oleh kurir', 'Paket telah diterima oleh counter', 'Received by courier', 'Diterima oleh agen', 'Paket diterima oleh drop point',
      'Diterima oleh petugas', 'RECEIVED BY DRIVER',
    ]) assert.equal(phaseOf(s), 'transit', s);
    // Masih di jalan: kata "deliver", "diterima", "sampai", atau "received" saja belum berarti sampai ke pelanggan.
    for (const s of [
      'ON PROCESS', 'PICKUP', 'IN TRANSIT', 'Sedang dikirim', 'ON DELIVERY', 'OUT FOR DELIVERY', 'Paket diterima di gudang sortir', 'Received at origin hub',
      'Sampai di hub Jakarta', 'RECEIVED', 'Tiba di hub Jakarta', 'Paket tiba di gudang', 'Paket telah tiba di hub Jakarta',
      'Sudah sampai di gudang sortir',
      'Gagal terkirim', 'Tidak terkirim', 'Belum terkirim', 'Paket sudah diterima di gudang sortir',
      'Kiriman telah diterima di Kantor Pos Bandung', 'Diterima di hub', 'Received in warehouse', 'Received by hub Jakarta',
    ]) assert.equal(phaseOf(s), 'transit', s);
    // Gagal kirim, retur, batal, hilang, rusak: bermasalah, tahap tidak diubah.
    for (const s of [
      'DELIVERY FAILED', 'UNDELIVERED', 'RETURN TO SENDER', 'Paket diretur', 'RETUR', 'Paket dikembalikan ke pengirim', 'CANCEL', 'Pengiriman batal',
      'LOST', 'Paket hilang', 'Paket rusak', 'DAMAGED', 'Gagal deliver, penerima tidak di tempat', 'Belum delivered',
      'Gagal terkirim', 'Tidak terkirim', 'Belum terkirim', 'Paket sudah diterima di gudang sortir',
      'Kiriman telah diterima di Kantor Pos Bandung', 'Diterima di hub', 'RETURNED TO SHIPPER',
    ]) assert.notEqual(phaseOf(s), 'delivered', s);
    // Belum diambil kurir: tahap belum naik ke "dikirim".
    for (const s of ['Menunggu pickup', 'ORDER CREATED', 'Belum dikirim', 'MANIFESTED', 'Menunggu penjemputan', 'Pesanan dibuat', 'READY TO SHIP']) {
      assert.equal(phaseOf(s), 'pending', s);
    }
    for (const s of [
      'RETURN TO SENDER', 'RETURNED TO SHIPPER', 'RETUR', 'Paket dikembalikan ke pengirim', 'CANCEL', 'Pengiriman batal', 'LOST', 'Paket hilang', 'Paket rusak', 'DAMAGED',
      'CANCELLED', 'CANCELED', 'Pengiriman dibatalkan', 'Dibatalkan', 'Paket diretur', 'UNDELIVERABLE', 'Returned',
    ]) {
      assert.equal(phaseOf(s), 'problem', s);
    }

    assert.deepEqual(trackingLinks('JP 12/3', 'jnt'), [{ label: 'cekresi.com', url: 'https://cekresi.com/?noresi=JP%2012%2F3' }]);
    assert.deepEqual(trackingLinks('TKP01-ABC1234', 'kurir_tokopedia').map((l) => l.url), [
      'https://cekresi.com/?noresi=TKP01-ABC1234', 'https://www.tokopedia.com/kurir-rekomendasi?awb=TKP01-ABC1234',
    ]);
    assert.deepEqual(trackingLinks('GTL123456', 'gtl').map((l) => l.label), ['cekresi.com', 'GTL']);
  }],

  ['trackContact: hasil disimpan, tahap hanya naik', async () => {
    const history = [{ date: '2026-11-25 09:00:00', desc: 'PAKET DIBAWA KURIR', location: 'JAKARTA' }];
    answer = async () => ({ status: 'ON PROCESS', history });
    await withAwb(A, { stage: 'payment', ship_error: 'lama' });
    let c = await trackContact(A, T0 + MIN);
    assert.deepEqual([c?.ship_status, c?.ship_history, c?.ship_checked_at, c?.ship_error, c?.ship_phase, c?.stage], ['ON PROCESS', history, T0 + MIN, null, 'transit', 'dikirim']);
    assert.deepEqual(calls, [{ awb: 'JP1234567890', courier: 'jnt' }]);

    answer = async () => ({ status: 'DELIVERED', history });
    c = await trackContact(A, T0 + 2 * MIN);
    assert.deepEqual([c?.stage, c?.ship_phase], ['selesai', 'delivered'], 'dikirim -> selesai');
    // Selesai tidak pernah turun ke dikirim.
    answer = async () => ({ status: 'ON PROCESS', history });
    c = await trackContact(A, T0 + 3 * MIN);
    assert.deepEqual([c?.stage, c?.ship_status], ['selesai', 'ON PROCESS']);

    // Tahap awal langsung ke selesai kalau paket sudah diterima; batal tidak disentuh.
    for (const [from, status, to] of [
      ['baru', 'DELIVERED', 'selesai'], ['link', 'IN TRANSIT', 'dikirim'], ['link', 'MANIFESTED', 'link'], ['payment', 'Menunggu pickup', 'payment'], ['batal', 'DELIVERED', 'batal'], ['batal', 'ON PROCESS', 'batal'],
      ['dikirim', 'ON PROCESS', 'dikirim'], ['payment', '', 'payment'],
      // Bermasalah (retur, batal, hilang) dan gagal kirim: tahap tetap.
      ['payment', 'RETURN TO SENDER', 'payment'], ['dikirim', 'Paket hilang', 'dikirim'], ['link', 'CANCEL', 'link'],
      ['dikirim', 'OUT FOR DELIVERY', 'dikirim'], ['payment', 'OUT FOR DELIVERY', 'dikirim'],
    ] as const) {
      await updateContact(A, { stage: from });
      answer = async () => ({ status, history: [] });
      assert.equal((await trackContact(A, T0))?.stage, to, `${from} + ${status || '(kosong)'}`);
    }
  }],

  ['trackContact: tahap yang diubah staf selama pengecekan tidak ditimpa', async () => {
    // Staf menandai batal saat Binderbyte masih menjawab: paket sampai tidak menjadikannya selesai.
    await withAwb(A, { stage: 'payment' });
    answer = async () => {
      await updateContact(A, { stage: 'batal' });
      return { status: 'DELIVERED', history: [] };
    };
    let c = await trackContact(A, T0);
    assert.deepEqual([c?.stage, c?.ship_status, c?.ship_checked_at], ['batal', 'DELIVERED', T0], 'batal tetap, hasil pelacakan tetap disimpan');

    // Staf menandai selesai saat paket masih di jalan: tidak turun ke dikirim.
    await updateContact(A, { stage: 'payment' });
    answer = async () => {
      await updateContact(A, { stage: 'selesai' });
      return { status: 'ON PROCESS', history: [] };
    };
    c = await trackContact(A, T0 + MIN);
    assert.deepEqual([c?.stage, c?.ship_status], ['selesai', 'ON PROCESS']);

    // Staf memindahkan ke dikirim lebih dulu: paket sampai tetap boleh menaikkannya ke selesai.
    await updateContact(A, { stage: 'payment' });
    answer = async () => {
      await updateContact(A, { stage: 'dikirim' });
      return { status: 'DELIVERED', history: [] };
    };
    assert.equal((await trackContact(A, T0 + 2 * MIN))?.stage, 'selesai');
  }],

  ['trackContact: resi diganti staf selama pengecekan, hasil dibuang', async () => {
    const reset = async (c: Contact | undefined, msg: string): Promise<void> => {
      assert.deepEqual([c?.ship_status, c?.ship_history, c?.ship_checked_at, c?.ship_error, c?.ship_phase, c?.stage], [null, null, null, null, null, 'payment'], msg);
    };
    // Berhasil: status untuk resi lama tidak boleh menempel di resi baru, tahap tetap.
    await withAwb(A, { stage: 'payment' });
    answer = async () => {
      await setStageNote(A, { awb: 'JP9999999999' }, T0 + MIN);
      return { status: 'DELIVERED', history: [{ date: 'd', desc: 'DELIVERED', location: '' }] };
    };
    let c = await trackContact(A, T0 + 2 * MIN);
    assert.deepEqual([c?.awb, c?.awb_at], ['JP9999999999', T0 + MIN]);
    await reset(c, 'berhasil, resi baru');

    // Gagal: error untuk resi lama juga dibuang.
    answer = async () => {
      await setStageNote(A, { awb: 'JP8888888888' }, T0 + 3 * MIN);
      throw new Error('Credit tidak cukup');
    };
    c = await trackContact(A, T0 + 4 * MIN);
    assert.equal(c?.awb, 'JP8888888888');
    await reset(c, 'gagal, resi baru');

    // Hanya kurir yang diganti: hasil juga dibuang.
    answer = async () => {
      await setStageNote(A, { courier: 'jne' }, T0 + 5 * MIN);
      return { status: 'ON PROCESS', history: [] };
    };
    c = await trackContact(A, T0 + 6 * MIN);
    assert.equal(c?.courier, 'jne');
    await reset(c, 'kurir baru');
  }],

  ['trackContact: gagal = error dicatat, status dan tahap lama tetap', async () => {
    answer = async () => ({ status: 'ON PROCESS', history: [{ date: 'd', desc: 'x', location: '' }] });
    await withAwb(A, { stage: 'payment' });
    await trackContact(A, T0);
    answer = async () => { throw new Error('Credit tidak cukup, silakan lakukan topup credit. ' + 'x'.repeat(400)); };
    const c = await trackContact(A, T0 + MIN);
    assert.equal(c?.ship_error?.length, 300);
    assert.match(c?.ship_error ?? '', /^Credit tidak cukup/);
    assert.deepEqual([c?.ship_status, c?.ship_history?.length, c?.ship_checked_at, c?.ship_phase, c?.stage], ['ON PROCESS', 1, T0 + MIN, 'transit', 'dikirim'], 'error: fase lama tetap');

    // Berhasil lagi: error dihapus.
    answer = async () => ({ status: 'ON PROCESS', history: [] });
    assert.equal((await trackContact(A, T0 + 2 * MIN))?.ship_error, null);
  }],

  ['trackContact: tanpa resi atau kurir yang sah tidak memanggil pelacak', async () => {
    await createContact(A, A, T0);
    assert.equal((await trackContact(A, T0))?.ship_checked_at, null);
    await updateContact(A, { awb: 'JP1234567890', courier: 'dhl' });
    assert.equal((await trackContact(A, T0))?.ship_checked_at, null, 'kurir tidak dikenal');
    await updateContact(A, { awb: null, courier: 'jnt' });
    await trackContact(A, T0);
    assert.equal((await trackContact('+6289999999999', T0)), undefined, 'kontak tidak ada');
    assert.equal(calls.length, 0);
  }],

  ['setStageNote: kurir diganti, resi dicek lagi dari awal', async () => {
    await withAwb(A, { awb_at: T0 - 40 * DAY, ship_status: 'ON PROCESS', ship_phase: 'transit', ship_checked_at: T0 - MIN, ship_error: 'lama' });
    const c = await setStageNote(A, { courier: 'jne' }, T0);
    assert.deepEqual(
      [c?.courier, c?.awb, c?.awb_at, c?.ship_status, c?.ship_checked_at, c?.ship_error, c?.ship_phase], ['jne', 'JP1234567890', T0, null, null, null, null]
    );
    assert.equal(await runTracking(T0), 1, 'resi lama dengan kurir baru masuk jendela 30 hari lagi');
    // Kurir sama: tidak ada yang diulang.
    const same = await setStageNote(A, { courier: 'jne' }, T0 + DAY);
    assert.deepEqual([same?.awb_at, same?.ship_checked_at], [T0, T0]);
  }],

  ['JNE: 5 digit terakhir nomor penerima ikut dikirim; kontak lid: tidak', async () => {
    await withAwb(A, { courier: 'jne' });
    await trackContact(A, T0);
    const L = 'lid:123456789012345';
    await withAwb(L, { courier: 'jne' });
    await trackContact(L, T0);
    assert.deepEqual(calls, [
      { awb: 'JP1234567890', courier: 'jne', phoneLast5: '67890' },
      { awb: 'JP1234567890', courier: 'jne' },
    ]);
  }],

  ['runTracking: jeda 30 menit, batas 30 hari, dan mati tanpa API key', async () => {
    const at = T0 + 40 * DAY;
    await withAwb('+6281100000001', { awb_at: at - 60 * MIN });                                   // belum pernah dicek
    await withAwb('+6281100000002', { awb_at: at - DAY, ship_checked_at: at - 10 * MIN });        // baru dicek
    await withAwb('+6281100000003', { awb_at: at - DAY, ship_checked_at: at - 31 * MIN });        // sudah 31 menit
    await withAwb('+6281100000004', { awb_at: at - 31 * DAY });                                   // lewat 30 hari
    await withAwb('+6281100000005', { awb_at: at - DAY, stage: 'selesai' });
    await withAwb('+6281100000006', { awb_at: at - DAY, stage: 'batal' });
    await withAwb('+6281100000007', { awb_at: at - DAY, courier: null });

    setTracker(null);
    assert.ok(!trackingEnabled());
    assert.equal(await runTracking(at), 0, 'tanpa API key tidak ada yang dicek');

    setTracker(fake);
    assert.ok(trackingEnabled());
    assert.equal(await runTracking(at), 2);
    // Yang paling lama tidak dicek dulu: belum pernah dicek, lalu 31 menit.
    assert.deepEqual(calls.length, 2);
    assert.equal((await getContact('+6281100000001'))?.ship_checked_at, at);
    assert.equal((await getContact('+6281100000003'))?.ship_checked_at, at);
    assert.equal((await getContact('+6281100000002'))?.ship_checked_at, at - 10 * MIN);
    assert.equal(await runTracking(at + 5 * MIN), 0, 'baru dicek');
    assert.equal(await runTracking(at + 21 * MIN), 1, 'yang dicek 10 menit sebelumnya kini lewat 30 menit');

    // Pelacak yang gagal tetap dihitung dan tidak menghentikan putaran.
    answer = async () => { throw new Error('HTTP 503'); };
    assert.equal(await runTracking(at + 2 * 60 * MIN), 3);
    assert.equal((await getContact('+6281100000001'))?.ship_error, 'HTTP 503');

    // Setelah error: dicek lagi paling cepat 6 jam kemudian, bukan 30 menit.
    const failedAt = at + 2 * 60 * MIN;
    answer = async () => ({ status: 'ON PROCESS', history: [] });
    assert.equal(await runTracking(failedAt + 31 * MIN), 0, 'error: jeda 30 menit tidak cukup');
    assert.equal(await runTracking(failedAt + TRACK_RETRY_MS - MIN), 0, 'error: belum 6 jam');
    assert.equal(await runTracking(failedAt + TRACK_RETRY_MS + MIN), 3, 'error: sudah lewat 6 jam');
    assert.equal((await getContact('+6281100000001'))?.ship_error, null);
    // Berhasil lagi: kembali ke jeda 30 menit.
    assert.equal(await runTracking(failedAt + TRACK_RETRY_MS + 32 * MIN), 3);

    // API key diisi: menyala walau tanpa pelacak tiruan.
    setTracker(null);
    cfg.binderbyteKey = 'kunci-uji';
    assert.ok(trackingEnabled());
  }],

  ['trackingCandidates: status bermasalah dicek lagi paling cepat 6 jam', async () => {
    const at = T0 + DAY;
    const HOUR = 60 * MIN;
    const P1 = '+6281100000011';
    const P7 = '+6281100000012';
    const R1 = '+6281100000013';
    await withAwb(P1, { ship_status: 'RETURNED TO SHIPPER', ship_phase: 'problem', ship_checked_at: at - HOUR });                       // bermasalah, 1 jam
    await withAwb(P7, { awb: 'JP0000000012', ship_status: 'RETURNED TO SHIPPER', ship_phase: 'problem', ship_checked_at: at - 7 * HOUR }); // bermasalah, 7 jam
    await withAwb(R1, { awb: 'JP0000000013', ship_status: 'ON PROCESS', ship_phase: 'transit', ship_checked_at: at - HOUR });          // di jalan, 1 jam
    const due = async (t: number): Promise<string[]> => (await trackingCandidates(t, 50)).map((c) => c.phone);
    assert.deepEqual(await due(at), [P7, R1], 'bermasalah 1 jam lalu belum masuk');
    assert.deepEqual(await due(at - HOUR + TRACK_RETRY_MS - MIN), [P7, R1], 'bermasalah: belum 6 jam');
    assert.deepEqual(await due(at - HOUR + TRACK_RETRY_MS + MIN), [P7, P1, R1], 'bermasalah: sudah lewat 6 jam');

    // trackContact menyimpan fase; jedanya kemudian diatur SQL.
    answer = async () => ({ status: 'RETURNED TO SHIPPER', history: [] });
    assert.equal(await runTracking(at), 2);
    assert.deepEqual(calls.map((q) => q.awb).sort(), ['JP0000000012', 'JP0000000013']);
    assert.equal((await getContact(P1))?.ship_checked_at, at - HOUR, 'bermasalah 1 jam lalu tidak dicek lagi');
    assert.equal((await getContact(R1))?.ship_phase, 'problem');
    // Semua kini bermasalah: 1 jam lagi belum ada yang dicek, 6 jam lagi semua.
    calls = [];
    assert.equal(await runTracking(at + HOUR), 0);
    assert.equal(await runTracking(at + TRACK_RETRY_MS + MIN), 3);
  }],

  ['runTracking: resi bermasalah tidak menghalangi resi lain', async () => {
    // 25 resi bermasalah (lebih dari batas 20 per putaran) dan 1 resi di jalan, semua dicek 1 jam lalu.
    const at = T0 + DAY;
    const HOUR = 60 * MIN;
    for (let i = 0; i < 25; i++) {
      await withAwb(`+62812000000${String(i).padStart(2, '0')}`, {
        awb: `JP10000000${String(i).padStart(2, '0')}`, ship_status: 'RETURN TO SENDER', ship_phase: 'problem', ship_checked_at: at - HOUR,
      });
    }
    await withAwb('+6281200000099', { awb: 'JP2000000099', ship_status: 'ON PROCESS', ship_phase: 'transit', ship_checked_at: at - HOUR });
    assert.equal(await runTracking(at), 1);
    assert.deepEqual(calls.map((q) => q.awb), ['JP2000000099']);
  }],

  ['advanceStage: resi, kurir, atau awb_at di database berbeda, tahap tetap', async () => {
    await withAwb(A, { stage: 'payment' });
    const expect = { awb: 'JP1234567890', courier: 'jnt', awb_at: T0 };
    assert.equal(await advanceStage(A, ['payment'], 'dikirim', { ...expect, awb: 'JP0000000000' }), false);
    assert.equal(await advanceStage(A, ['payment'], 'dikirim', { ...expect, courier: 'jne' }), false, 'kurir lain');
    assert.equal(await advanceStage(A, ['payment'], 'dikirim', { ...expect, awb_at: T0 + MIN }), false, 'awb_at lain');
    assert.equal(await advanceStage(A, ['payment'], 'dikirim', { ...expect, awb_at: null }), false, 'awb_at null');
    assert.equal((await getContact(A))?.stage, 'payment');
    await setStageNote(A, { awb: null }, T0);
    assert.equal(await advanceStage(A, ['payment'], 'dikirim', expect), false, 'resi dikosongkan staf');
    assert.equal((await getContact(A))?.stage, 'payment');
    await setStageNote(A, { awb: 'JP1234567890' }, T0);
    assert.equal(await advanceStage(A, ['payment'], 'dikirim', expect), true);
    assert.equal((await getContact(A))?.stage, 'dikirim');
    // Tanpa expect: hanya tahapnya yang diperiksa.
    assert.equal(await advanceStage(A, ['dikirim'], 'selesai'), true);
  }],

  ['runTracking: batas cek resi harian', async () => {
    cfg.trackDailyMax = 2;
    const at = T0 + DAY;
    await withAwb('+6281300000001', { awb: 'JP3000000001' });
    await withAwb('+6281300000002', { awb: 'JP3000000002' });
    await withAwb('+6281300000003', { awb: 'JP3000000003' });
    const day = localStamp(at).slice(0, 10);
    assert.equal(await runTracking(at), 2);
    assert.equal(calls.length, 2);
    assert.equal(await trackUsageToday(day), 2, 'hitungan ada di database');
    // Bot dijalankan ulang: tidak ada hitungan di memori, batas tetap berlaku
    // dari database walau jeda 30 menit sudah lewat.
    assert.equal(await runTracking(at + 31 * MIN), 0);
    assert.equal(calls.length, 2);
    // Error dari pelacak juga dihitung.
    cfg.trackDailyMax = 3;
    answer = async () => { throw new Error('Credit tidak cukup'); };
    assert.equal(await runTracking(at + 31 * MIN), 1);
    assert.equal(await trackUsageToday(day), 3);
    assert.equal(await runTracking(at + 31 * MIN), 0);
    answer = async () => ({ status: 'ON PROCESS', history: [] });
    cfg.trackDailyMax = 2;
    // Tombol "Cek resi" (trackContact langsung) tidak dibatasi dan tidak dihitung.
    assert.equal((await trackContact('+6281300000003', at + 32 * MIN))?.ship_checked_at, at + 32 * MIN);
    assert.equal(calls.length, 4);
    assert.equal(await trackUsageToday(day), 3);
    // Hari berikutnya: jalan lagi.
    assert.equal(await runTracking(at + DAY), 2);
    assert.equal(calls.length, 6);
    assert.equal(await trackUsageToday(localStamp(at + DAY).slice(0, 10)), 2);
  }],

  ['runTracking: error saat mencatat jatah harian tidak mengubah hasil pelacakan', async () => {
    const at = T0 + DAY;
    await withAwb(A, { stage: 'payment' });
    // Tabel hitungan hilang sesudah hitungan hari ini dibaca: bumpTrackUsage error.
    answer = async () => {
      await db().execute(sql`alter table track_usage rename to track_usage_x`);
      return { status: 'ON PROCESS', history: [] };
    };
    const errs: string[] = [];
    const realError = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(' ')); };
    try {
      assert.equal(await runTracking(at), 1);
    } finally {
      console.error = realError;
      await db().execute(sql`alter table track_usage_x rename to track_usage`);
    }
    const c = await getContact(A);
    assert.deepEqual([c?.ship_status, c?.ship_error, c?.ship_checked_at, c?.stage], ['ON PROCESS', null, at, 'dikirim']);
    assert.ok(errs.some((e) => e.startsWith('[resi] catatan jatah harian gagal:')), errs.join('\n'));
    assert.ok(!errs.some((e) => e.includes('cek gagal')), 'bukan error pengecekan');
  }],

  ['fillOrder: hanya kolom yang di database masih kosong', async () => {
    await createContact(A, A, T0);
    let c = await fillOrder(A, { order_ref: '576123456789012345', awb: 'JP1234567890', courier: 'jnt' }, T0);
    assert.deepEqual([c.order_ref, c.awb, c.courier, c.awb_at], ['576123456789012345', 'JP1234567890', 'jnt', T0]);
    // Isian staf yang masuk lebih dulu tidak ditimpa.
    await setStageNote(A, { order_ref: 'INV/20261120/MPL/1234567890', awb: 'CGK0123456789', courier: null }, T0 + MIN);
    await updateContact(A, { ship_status: 'ON PROCESS', ship_phase: 'transit', ship_checked_at: T0 + MIN });
    c = await fillOrder(A, { order_ref: '577000000000000001', awb: 'JP0000000001', courier: 'jnt' }, T0 + 2 * MIN);
    assert.deepEqual(
      [c.order_ref, c.awb, c.courier, c.awb_at, c.ship_status, c.ship_phase],
      ['INV/20261120/MPL/1234567890', 'CGK0123456789', null, T0 + MIN, 'ON PROCESS', 'transit'],
      'kurir tidak menempel di resi lain',
    );
    // Resi yang sama: kurir yang masih kosong diisi, hasil pelacakan tetap.
    c = await fillOrder(A, { awb: 'CGK0123456789', courier: 'jne' }, T0 + 3 * MIN);
    assert.deepEqual([c.courier, c.awb_at, c.ship_status], ['jne', T0 + MIN, 'ON PROCESS']);
    // Resi baru di kontak yang hasil pelacakannya masih ada: hasil lama dikosongkan.
    await updateContact(A, { awb: null, courier: null });
    c = await fillOrder(A, { awb: 'JP2222222222' }, T0 + 4 * MIN);
    assert.deepEqual([c.awb, c.awb_at, c.ship_status, c.ship_phase, c.ship_checked_at, c.courier], ['JP2222222222', T0 + 4 * MIN, null, null, null, null]);
  }],

  ['pelacak Binderbyte: alamat, hasil, dan pesan error', async () => {
    const real = globalThis.fetch;
    const urls: string[] = [];
    let reply: { code: number; body: unknown; raw?: string } = { code: 200, body: {} };
    globalThis.fetch = (async (url: string | URL) => {
      urls.push(String(url));
      return new Response(reply.raw ?? JSON.stringify(reply.body), { status: reply.code, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      setTracker(null);
      cfg.binderbyteKey = 'kunci-uji';
      reply = {
        code: 200,
        body: {
          status: 200, message: 'Successfully tracked package',
          data: {
            summary: { awb: 'JP1234567890', courier: 'JNE Express', status: 'DELIVERED' },
            history: [{ date: '2020-10-02 13:33:00', desc: 'DELIVERED TO [BUDI]', location: '' }, { date: '2020-10-01 08:00:00', desc: 'PICKUP' }, ...Array(30).fill({})],
          },
        },
      };
      await withAwb(A, { courier: 'jne', stage: 'payment' });
      const c = await trackContact(A, T0);
      const u = new URL(urls[0] as string);
      assert.equal(u.origin + u.pathname, 'https://api.binderbyte.com/v1/track');
      assert.deepEqual(Object.fromEntries(u.searchParams), { api_key: 'kunci-uji', courier: 'jne', awb: 'JP1234567890', number: '67890' });
      assert.equal(c?.ship_status, 'DELIVERED');
      assert.equal(c?.ship_history?.length, 20);
      assert.deepEqual(c?.ship_history?.[1], { date: '2020-10-01 08:00:00', desc: 'PICKUP', location: '' });
      assert.equal(c?.stage, 'selesai');

      reply = { code: 400, body: { status: 400, message: 'Credit tidak cukup, silakan lakukan topup credit.' } };
      assert.equal((await trackContact(A, T0 + MIN))?.ship_error, 'Credit tidak cukup, silakan lakukan topup credit.');
      reply = { code: 200, body: { status: 403, message: 'API Key tidak memiliki akses ke produk ini' } };
      assert.equal((await trackContact(A, T0 + 2 * MIN))?.ship_error, 'API Key tidak memiliki akses ke produk ini');
      reply = { code: 503, body: {} };
      assert.equal((await trackContact(A, T0 + 3 * MIN))?.ship_error, 'HTTP 503');
      // HTTP 200 dengan isi yang bukan JSON: pesan tersendiri, bukan "HTTP 200".
      reply = { code: 200, body: {}, raw: '<html>maintenance</html>' };
      assert.equal((await trackContact(A, T0 + 4 * MIN))?.ship_error, 'Jawaban Binderbyte tidak bisa dibaca.');
      assert.equal((await getContact(A))?.ship_status, 'DELIVERED', 'status lama tetap');
      // Bukan JNE: tanpa nomor penerima.
      await updateContact(A, { courier: 'jnt' });
      await trackContact(A, T0);
      assert.equal(new URL(urls.at(-1) as string).searchParams.has('number'), false);
    } finally {
      globalThis.fetch = real;
    }
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
  setTracker(null);
  console.log(`\nresi: ${tests.length - failed}/${tests.length} lulus`);
  process.exit(failed ? 1 : 0);
})();
