/**
 * Dashboard: masuk, proyek, simpan profil (dan bot ikut memuat ulang), foto,
 * uji coba, tombol per chat, WhatsApp, dan pagar keamanannya. Database di
 * memori dan folder data sementara; tidak menyentuh data asli.
 *
 * Tes ini sekaligus memerankan proses bot proyek gfan (proyek bawaan proses):
 * setelah dashboard menyimpan, "bot" memuat ulang seperti sebelum gilirannya.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';

import { checkReply, systemPrompt } from '../brain';
import { biz, initBiz, knowledgeText, loadProject, mediaDir, refreshBiz } from '../business';
import { localDay } from '../clock';
import { cfg } from '../config';
import { closeDb, db, openDb } from '../db';
import { ensureProject } from '../db/seed';
import { humanHolds } from '../flow';
import { handlePairingRequest, reportState, resetWaNumberCheck, startHeartbeat } from '../heartbeat';
import { pickDelayMs, typingMs } from '../pace';
import { withProject } from '../project';
import { makeState, setTiktokFetch, type TiktokFetch } from '../tiktok';
import { setQuotaFetcher, setTracker } from '../tracking';
import { deliverOutbox, MAX_REPLY_ATTEMPTS, setReplySender, setTestSender } from '../sinks/outbox';
import {
  addHandoff, addMessage, addUsage, bumpTrackUsage, createContact, deleteShopLink, getContact, getProfile, getProject, getShopLink, getWebhookEvent, humanSeenAt, pendingReplies, readStatus,
  recentAlerts, recentMessages, saveProfile, saveShopLink, trackUsageToday, updateContact, updateProject,
} from '../store';
import type { Transport, TransportState } from '../transport/types';
import { HELP_PAGES, parseHelp, unansweredPath, type Helper } from './help';
import { setAdminBrain, setAdminExplainer, setAdminHelper, startAdmin, stopAdmin } from './server';
import { localStore } from './store-local';
import { OLD_ROUTES, renamedPath, ROUTES } from './routes';

const PASSWORD = 'kata-sandi-uji-123';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-admin-'));
  cfg.dataRoot = dir;
  cfg.adminPassword = PASSWORD;
  cfg.adminPort = 0;
  cfg.adminHost = '127.0.0.1';
  await openDb('memory://');
  await ensureProject('gfan', 'gfan', 'GFAN Indonesia');
  await initBiz('gfan');

  let base = '';
  let cookie = '';
  const call = async (path: string, init: RequestInit = {}, withCookie = true) => {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...(withCookie && cookie ? { cookie } : {}) },
    });
    const type = res.headers.get('content-type') ?? '';
    const out = { status: res.status, body: type.includes('json') ? ((await res.json()) as any) : await res.arrayBuffer(), res };
    // Proses bot memeriksa perubahan sebelum gilirannya; di sini langsung.
    if (init.method && init.method !== 'GET') await refreshBiz(true);
    return out;
  };
  const put = (body: unknown) =>
    call('/api/gfan/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const post = (path: string, body?: unknown) =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  try {
    base = `http://127.0.0.1:${await startAdmin(localStore())}`;

    // --- masuk ---
    assert.equal((await call('/login')).status, 200);
    assert.equal((await call('/api/gfan/state')).status, 401, 'tanpa sesi tidak ada data');
    const login = (password: string) =>
      call('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }, false);
    assert.equal((await login('salah')).status, 401);
    const ok = await login(PASSWORD);
    assert.equal(ok.status, 200);
    const setCookie = ok.res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly; SameSite=Strict/);
    cookie = setCookie.split(';')[0] as string;
    assert.equal((await call('/api/gfan/state', { headers: { cookie: 'admin_session=9999999999999.palsu' } }, false)).status, 401);

    const state = await call('/api/gfan/state');
    assert.equal(state.body.profile.brand, 'GFAN Indonesia');
    assert.equal(state.body.profile.id, undefined, 'hanya kunci yang boleh diubah yang ditampilkan');
    assert.equal(state.body.business, 'gfan');
    assert.equal(state.body.project.name, 'GFAN Indonesia');
    assert.equal(state.body.status.reportedAt, null, 'bot belum pernah melapor');
    assert.equal((await call('/api/state')).status, 404, 'tanpa proyek di alamat: tidak ada');
    assert.equal((await call('/api/tidak-ada/state')).status, 404, 'proyek yang tidak ada');

    // --- simpan profil: bot langsung ikut ---
    assert.ok(checkReply('GFAF-70A tersedia'), 'sebelum ditambah, GFAF-70A dianggap karangan');
    const saved = await put({
      alias: 'Rina',
      replyDelayMin: 5,
      replyDelayMax: 12,
      catalog: biz.catalog.map((s, i) =>
        i === 2 ? { ...s, tables: s.tables.map((t, j) => (j === 0 ? { ...t, rows: [...t.rows, ['GFAF-70A', ...t.columns.slice(1).map(() => '1')]] } : t)) } : s
      ),
      notes: 'Jam buka: Senin–Sabtu 08.00–17.00.',
      id: 'diretas',
      evalCases: [],
    });
    assert.equal(saved.status, 200);
    assert.equal(biz.alias, 'Rina');
    assert.equal(biz.id, 'gfan', 'kunci di luar daftar dibuang');
    assert.match(systemPrompt(), /Nama panggilanmu Rina/);
    assert.equal(checkReply('GFAF-70A tersedia'), null, 'pagar kode mengikuti data produk yang baru');
    assert.ok(checkReply('GFAF-99A tersedia'));
    assert.match(knowledgeText(), /\nGFAF-70A \| 1 \| 1/);
    assert.match(systemPrompt(), /Jam buka: Senin–Sabtu/);
    assert.equal(state.body.profile.catalog.length, 7, 'tabel produk bawaan tampil di dashboard');
    assert.equal(state.body.profile.products.length, 35, 'satu baris per model');
    assert.deepEqual(state.body.profile.products[0], { name: 'GFC10-12B4', description: 'Ceiling Fan GFC — Model B4 (ceiling vent-type)', price: '', stock: '', photos: [], pdf: '', links: { tokopedia: '', shopee: '' } });
    assert.equal(state.body.profile.knowledge, undefined);

    // --- tabel produk: masukan dirapikan, yang salah ditolak ---
    const tbl = (rows: unknown[], columns: unknown[] = ['Model', 'Daya']) =>
      put({ catalog: [{ name: 'Seri Uji', facts: 'baris satu\n- baris dua', tables: [{ title: 'Spek', columns, rows }] }] });
    assert.match((await tbl([['', '10']])).body.error, /belum diisi Model/);
    assert.match((await tbl([['X-1', '10']], ['Model', 'model'])).body.error, /kolom yang sama/);
    assert.match((await put({ catalog: [{ name: '', tables: [] }] })).body.error, /belum diberi nama/);
    assert.equal((await tbl([['UJI-1', '10 | W\n'], ['', ''], ['UJI-2']])).status, 200);
    assert.equal(
      knowledgeText().slice(knowledgeText().indexOf('### ')),
      '### Seri Uji\n- baris satu\n- baris dua\n\nSpek:\nModel | Daya\nUJI-1 | 10 W\nUJI-2 | \n\nJam buka: Senin–Sabtu 08.00–17.00.'
    );
    assert.equal(checkReply('UJI-1 tersedia'), null);
    assert.ok(checkReply('UJI-9 tersedia'));

    // --- pemakaian LLM + tarif ---
    addUsage({ day: '2026-11-10', calls: 2, promptTokens: 9000, cachedTokens: 8000, completionTokens: 300 });
    addUsage({ day: '2026-11-10', calls: 1, promptTokens: 1000, cachedTokens: 0, completionTokens: 100 });
    addUsage({ day: '2026-11-11', calls: 1, promptTokens: 500, cachedTokens: 0, completionTokens: 50 });
    const usage = (await call('/api/gfan/usage')).body.usage;
    assert.deepEqual(usage.days[1], { day: '2026-11-10', calls: 3, promptTokens: 10000, cachedTokens: 8000, completionTokens: 400 });
    assert.equal(usage.days[0].day, '2026-11-11');
    assert.equal(usage.price.out, cfg.llmPriceOut);
    assert.equal((await call('/api/gfan/usage', {}, false)).status, 401);

    // --- pemakaian cek resi + akun Binderbyte (pembaca akun tiruan) ---
    {
      const today = localDay(Date.now());
      await bumpTrackUsage(today, 'auto');
      await bumpTrackUsage(today, 'auto');
      await bumpTrackUsage(today, 'manual');
      cfg.binderbyteKey = '';
      setTracker(async () => ({ status: 'ON PROCESS', history: [] }));
      setQuotaFetcher(async () => ({ status: 200, product: 'cek-resi', count: '40', limit: '100', price: '20', balance: '5000.00' }));
      const resi = (await call('/api/gfan/usage')).body.usage.resi;
      assert.deepEqual([resi.enabled, resi.price, resi.dailyMax, resi.accountError], [true, 20, cfg.trackDailyMax, null], 'tarif dari akun');
      assert.deepEqual(resi.days, [{ day: today, auto: 2, manual: 1 }]);
      assert.deepEqual({ ...resi.account, at: 0 }, { used: 40, limit: 100, freeLeft: 60, balance: 5000, at: 0 });
      assert.ok(resi.account.at > 0);
      // Biaya bulan ini di bilah keadaan: LLM + cek resi (3 cek × Rp20).
      const month = (await call('/api/gfan/state')).body.month;
      assert.equal(month.resi, 60);
      assert.equal(month.idr, month.llm + month.resi);
      assert.equal(month.llm, Math.round(month.usd * cfg.usdIdr));
      // Akun tidak terbaca (API key salah): /usage menunggu pembacaan pertama, lalu tanpa akun, dengan pesan error, tarif bawaan.
      setQuotaFetcher(async () => ({ status: 400, message: 'API Key not found' }));
      const realError = console.error;
      console.error = () => {};
      let failed;
      try {
        failed = (await call('/api/gfan/usage')).body.usage.resi;
      } finally {
        console.error = realError;
      }
      assert.deepEqual([failed.account, failed.accountError, failed.price], [null, 'API Key not found', cfg.trackPriceIdr]);
      // /state tidak menunggu Binderbyte: pembaca yang tidak pernah menjawab tidak menahan jawabannya.
      setQuotaFetcher(() => new Promise(() => {}));
      const slow = (await call('/api/gfan/state')).body.month;
      assert.equal(slow.resi, 3 * cfg.trackPriceIdr, 'tarif bawaan selama akun belum terbaca');
      // Tanpa pelacakan: tidak ada akun, tarif bawaan.
      setTracker(null);
      setQuotaFetcher(null);
      const off = (await call('/api/gfan/usage')).body.usage.resi;
      assert.deepEqual([off.enabled, off.price, off.account, off.accountError], [false, cfg.trackPriceIdr, null, null]);
    }
    assert.equal((await getProfile('gfan')).alias, 'Rina', 'tersimpan di database');

    // --- masukan yang salah ditolak dengan pesan yang bisa dibaca ---
    assert.equal((await put({ leadFields: [] })).status, 400);
    assert.match((await put({ leadFields: [{ key: 'Nama Lengkap', label: 'nama' }] })).body.error, /huruf kecil/);
    assert.match((await put({ replyDelayMin: 40, replyDelayMax: 10 })).body.error, /Jeda/);
    assert.equal((await put({ greeting: '   ' })).status, 400);
    const fields = await put({ leadFields: [{ key: 'name', label: 'nama', hint: '', isName: true }, { key: 'tanggal', label: 'tanggal acara', hint: '' }] });
    assert.equal(fields.status, 200);
    assert.match(systemPrompt(), /"tanggal": null/);

    // --- proses lain menyimpan: bot ini ikut tanpa restart ---
    await saveProfile('gfan', { ...(await getProfile('gfan')), honorific: 'Kak' });
    assert.notEqual(biz.honorific, 'Kak', 'belum dimuat ulang');
    assert.equal(await refreshBiz(true), true, 'perubahan terdeteksi');
    assert.equal(biz.honorific, 'Kak');
    assert.equal(await refreshBiz(true), false, 'tanpa perubahan: tidak dimuat ulang');

    // --- berkas: foto dan PDF, dipasang ke baris produk ---
    const up = (data: Buffer, name = 'depan.png') =>
      call(`/api/gfan/files?${new URLSearchParams({ name })}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: data });
    assert.equal((await up(Buffer.from('<script>alert(1)</script>'))).status, 400, 'bukan gambar/PDF ditolak, apa pun content-type-nya');
    const photo = (await up(PNG)).body.file;
    assert.match(photo.file, /^f[0-9a-f]{8}\.png$/);
    const pdf = (await up(Buffer.from('%PDF-1.4\n%isi'), '../../Brosur <b>GFAF</b>.pdf')).body.file;
    assert.match(pdf.file, /^d[0-9a-f]{8}\.pdf$/, 'nama berkas dibuat sendiri, bukan dari pengunggah');
    const stray = (await up(PNG, 'tidak-jadi.png')).body.file;
    assert.ok(existsSync(join(mediaDir(), photo.file)) && existsSync(join(mediaDir(), pdf.file)));
    assert.equal((await call(`/api/gfan/media/${photo.file}`)).status, 200);
    assert.equal((await call(`/api/gfan/media/${pdf.file}`)).res.headers.get('content-type'), 'application/pdf');
    assert.equal((await call(`/api/gfan/media/${photo.file}`, {}, false)).status, 401);
    assert.equal((await call('/api/gfan/media/..%2F..%2Fprofile.json')).status, 404);
    assert.equal((await call('/api/gfan/media/f00000000.png')).status, 404);

    // Menyimpan daftar produk: lampiran harus berkas yang ada dan jenisnya benar;
    // berkas yang tidak dirujuk baris mana pun dibuang.
    assert.match((await put({ products: [{ name: '', price: 'Rp 1' }] })).body.error, /belum diberi nama/);
    const prod = await put({
      products: [
        { name: 'GFAF-40A', description: 'Exhaust 16" | industri', price: 'Rp 450.000', stock: 'ada', photos: [photo.id, pdf.id, 'f99999999'], pdf: pdf.id },
        { name: 'GFAF-50A', description: '', price: '', stock: '', photos: [], pdf: photo.id },
        { name: '', description: '', price: '', stock: '', photos: [], pdf: '' },
      ],
      questions: ['Ukuran kamarnya berapa × berapa?', '  ', 'Dipakai untuk apa?'],
      logo: 'f99999999',
    });
    assert.match(prod.body.error, /Logo/);
    // Tautan marketplace: https di situs marketplace itu saja.
    const TOKO = 'https://www.tokopedia.com/kipashisap/axial-wall-fan-16-inch';
    for (const [links, error] of [
      [{ tokopedia: 'http://www.tokopedia.com/kipashisap/x' }, /Tokopedia harus https/],
      [{ tokopedia: 'https://shopee.co.id/x' }, /Tokopedia harus https/],
      [{ shopee: 'https://www.tokopedia.com/x' }, /Shopee harus https/],
      [{ shopee: 'bukan tautan' }, /Shopee tidak sah/],
    ] as const) {
      assert.match((await put({ products: [{ name: 'GFAF-40A', links }] })).body.error, error);
    }
    const prod2 = await put({
      products: [
        { name: 'GFAF-40A', description: 'Exhaust 16" | industri', price: 'Rp 450.000', stock: 'ada', photos: [photo.id, pdf.id, 'f99999999'], pdf: pdf.id, links: { tokopedia: ` ${TOKO} `, lazada: 'https://lazada.co.id/x' } },
        { name: 'GFAF-50A', description: '', price: '', stock: '', photos: [], pdf: photo.id },
        { name: '', description: '', price: '', stock: '', photos: [], pdf: '' },
      ],
      questions: ['Ukuran kamarnya berapa × berapa?', '  ', 'Dipakai untuk apa?'],
    });
    assert.equal(prod2.status, 200);
    assert.deepEqual(biz.products, [
      { name: 'GFAF-40A', description: 'Exhaust 16" industri', price: 'Rp 450.000', stock: 'ada', photos: [photo.id], pdf: pdf.id, links: { tokopedia: TOKO, shopee: '' } },
      { name: 'GFAF-50A', description: '', price: '', stock: '', photos: [], pdf: '', links: { tokopedia: '', shopee: '' } },
    ]);
    assert.deepEqual(biz.files.map((f) => f.id), [photo.id, pdf.id], 'foto yang tidak dipakai dihapus dari daftar');
    assert.ok(!existsSync(join(mediaDir(), stray.file)), '…dan dari disk');
    assert.match(systemPrompt(), new RegExp(`GFAF-40A \\| Exhaust 16" industri \\| Rp 450.000 \\| ada \\| ${photo.id} \\| ${pdf.id} \\| Tokopedia\n`));
    assert.match(systemPrompt(), /GFAF-50A \| - \| - \| - \| - \| - \| -\n/);
    assert.ok(!systemPrompt().includes(TOKO), 'tautannya tidak masuk prompt; kode yang mengirimnya');
    assert.match(systemPrompt(), /MEMBELI\n/);
    assert.match(systemPrompt(), /PERTANYAAN KEBUTUHAN\n- Ukuran kamarnya berapa × berapa\?\n- Dipakai untuk apa\?/);

    // Logo: harus gambar yang ada; selama dipakai tidak ikut dibuang.
    const logo = (await up(PNG, 'logo.png')).body.file;
    assert.equal((await put({ logo: logo.id })).status, 200);
    assert.match((await put({ logo: pdf.id })).body.error, /Logo/);
    assert.deepEqual(biz.files.map((f) => f.id), [photo.id, pdf.id, logo.id]);

    // --- uji coba: memakai pagar yang sama dengan bot sungguhan ---
    setAdminBrain(async (i) => ({
      reply: i.text.includes('harga') ? 'Harganya Rp 500.000' : i.text.includes('40A') ? 'GFAF-40A Rp 450.000 ya' : 'Ini fotonya ya',
      fields: { name: 'Budi' }, intent: 'info', photos: [photo.id], docs: [pdf.id], buy: i.text.includes('beli') ? ['GFAF-40A', 'GFAF-50A'] : [], summary: '',
    }));
    const test = (text: string) => call('/api/gfan/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const t1 = await test('minta foto');
    assert.equal(t1.body.rejected, null);
    assert.equal(t1.body.photos[0].file, photo.file);
    assert.equal(t1.body.docs[0].file, pdf.file);
    assert.equal((await test('harga berapa')).body.rejected, 'menyebut harga', 'harga di luar daftar produk ditolak');
    assert.equal((await test('40A berapa')).body.rejected, null, 'harga yang tertulis di daftar produk boleh');
    assert.deepEqual((await test('mau beli')).body.buy, [{ text: `*GFAF-40A*\nTokopedia: ${TOKO}`, mark: `[link:GFAF-40A] Tokopedia: ${TOKO}` }],
      'uji coba menampilkan tautan beli yang akan dikirim; produk tanpa tautan dilewati');

    // Foto yang dilepas dari produk ikut dihapus; PDF tetap di pustaka sampai
    // dihapus dari halaman PDF, dan saat itu lepas dari semua produk.
    assert.equal((await put({ products: [{ name: 'GFAF-40A', description: '', price: '', stock: '', photos: [], pdf: pdf.id }, { name: 'GFAF-40AB', pdf: pdf.id }] })).status, 200);
    assert.ok(!existsSync(join(mediaDir(), photo.file)) && existsSync(join(mediaDir(), pdf.file)));
    assert.deepEqual(biz.files.map((f) => f.id), [pdf.id, logo.id]);
    assert.equal((await call(`/api/gfan/files/${logo.id}`, { method: 'DELETE' })).status, 404, 'hanya PDF yang dihapus lewat sini');
    const gone = await call(`/api/gfan/files/${pdf.id}`, { method: 'DELETE' });
    assert.equal(gone.status, 200);
    assert.deepEqual(gone.body.profile.products.map((p: { pdf: string }) => p.pdf), ['', '']);
    assert.ok(!existsSync(join(mediaDir(), pdf.file)));
    assert.deepEqual(biz.files.map((f) => f.id), [logo.id]);

    // --- PDF dicocokkan dengan produk yang disebut di dalamnya ---
    {
      const { matchProducts, pdfText, squash } = await import('./pdftext');
      const names = ['GFAF-40A', 'GFAF-40AB', 'GFAF-50A', 'GZ-200', 'AB', 'Kipas Meja 12 inci'];
      const text = squash('Model GFAF - 40AB | 16" ... gz200 ... KIPAS MEJA 12 INCI, AB');
      assert.deepEqual(matchProducts(text, names), ['GFAF-40AB', 'GZ-200', 'Kipas Meja 12 inci'], '40A tidak ikut hanya karena 40AB ada; nama pendek dilewati');
      assert.deepEqual(matchProducts(squash('GFAF-40A dan GFAF-40AB'), names), ['GFAF-40A', 'GFAF-40AB']);
      assert.deepEqual(matchProducts('', names), []);
      assert.equal(await pdfText(Buffer.from('%PDF-1.4 rusak')), '', 'PDF yang tidak terbaca = tanpa kecocokan, bukan error');

      const real = join(process.cwd(), 'catalog-pdf', 'Industrial Fan - GFan.pdf');
      await put({ products: [{ name: 'GFAF-40A' }, { name: 'GFAF-40AB' }, { name: 'GZ-200' }] });
      const upPdf = await call(`/api/gfan/files?${new URLSearchParams({ name: 'Industrial Fan - GFan.pdf' })}`, { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: readFileSync(real) });
      assert.equal(upPdf.body.readable, true);
      assert.deepEqual(upPdf.body.matches, ['GFAF-40A']);
      await put({ products: [{ name: 'GFAF-40A' }, { name: 'GFAF-60A' }] });
      const again = await call(`/api/gfan/files/${upPdf.body.file.id}/match`, { method: 'POST' });
      assert.deepEqual(again.body.matches, ['GFAF-40A', 'GFAF-60A'], 'cocokkan ulang memakai daftar produk terbaru');
      assert.ok(biz.files.some((f) => f.id === upPdf.body.file.id), 'PDF yang belum dipasang tetap ada di pustaka');
      const pid = upPdf.body.file.id as string;
      assert.ok(existsSync(join(mediaDir(), `${pid}.txt`)), 'teks PDF disimpan di samping PDF-nya');

      // Produk yang BARU ditambahkan otomatis dipasangi PDF; produk lama yang PDF-nya dilepas tidak.
      const auto = await put({ products: [{ name: 'GFAF-40A' }, { name: 'GFAF-60A' }, { name: 'GFAF-50A' }, { name: 'GZ-200' }] });
      assert.equal(auto.body.autoPdf, 1);
      assert.deepEqual(biz.products.map((x) => [x.name, x.pdf]), [['GFAF-40A', ''], ['GFAF-60A', ''], ['GFAF-50A', pid], ['GZ-200', '']]);

      // Bot membaca isi PDF hanya kalau dinyalakan untuk PDF itu.
      assert.ok(!knowledgeText().includes('ISI PDF'));
      const on = await call(`/api/gfan/files/${pid}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: true }) });
      assert.equal(on.status, 200);
      assert.equal(on.body.files.find((x: { id: string }) => x.id === pid).read, true);
      await refreshBiz(true);
      assert.match(knowledgeText(), /ISI PDF "Industrial Fan - GFan\.pdf" — dibaca otomatis/);
      assert.match(knowledgeText(), /GFAF-60A/);
      assert.match(systemPrompt(), /ISI PDF "Industrial Fan - GFan\.pdf"/);
      await call(`/api/gfan/files/${pid}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: false }) });
      assert.ok(!knowledgeText().includes('ISI PDF'), 'dimatikan = tidak lagi dibaca');
      // PDF yang tidak terbaca tidak bisa dinyalakan.
      const scan = (await up(Buffer.from('%PDF-1.4 rusak'), 'pindai.pdf')).body.file;
      assert.equal((await call(`/api/gfan/files/${scan.id}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: true }) })).status, 400);

      // Tombol bot per pelanggan: langsung ke database, bot membacanya di giliran berikutnya.
      const C = '+6281211110001';
      const sw = (phone: string, mode: unknown) => post(`/api/gfan/leads/${encodeURIComponent(phone)}/bot`, { mode });
      assert.equal((await sw(C, 'off')).status, 404, 'kontak yang belum ada');
      await createContact(C, C, Date.now());
      assert.equal((await sw('DROP TABLE', 'off')).status, 400);
      assert.equal((await sw(C, 'entah')).status, 400);
      assert.equal(await humanHolds(C, Date.now()), false);
      assert.equal((await sw(C, 'off')).status, 200);
      assert.equal(await humanHolds(C, Date.now()), true, 'dimatikan dari dashboard: bot diam');
      assert.equal((await call('/api/gfan/leads')).body.rows.find((r: { phone: string }) => r.phone === C).hold, 'tombol');
      assert.equal((await sw(C, 'on')).status, 200);
      assert.equal(await humanHolds(C, Date.now()), false, 'dinyalakan lagi');
      // Menunggu jam tenang dan minta berhenti juga tampil di daftar lead dan di percakapan.
      const holdOf = async () => (await call('/api/gfan/leads')).body.rows.find((r: { phone: string }) => r.phone === C).hold;
      await updateContact(C, { deferred_until: Date.now() + 3_600_000 });
      assert.equal(await holdOf(), 'tenang');
      assert.equal((await call(`/api/gfan/leads/${encodeURIComponent(C)}`)).body.contact.hold, 'tenang');
      await updateContact(C, { deferred_until: null, opted_out_at: Date.now() });
      assert.equal(await holdOf(), 'berhenti');
      assert.equal((await call(`/api/gfan/leads/${encodeURIComponent(C)}`)).body.contact.hold, 'berhenti');
      assert.equal((await sw(C, 'on')).status, 200);
      assert.equal(await holdOf(), null, 'dinyalakan pemilik: permintaan berhenti dihapus');

      // Warning dan catatan error tampil di dashboard.
      const { addAlert, addError } = await import('../store');
      await addAlert({ at: Date.now(), kind: 'butuh-staf', key: '+6281211110001', text: 'Bot tidak bisa menjawab: Budi — "bisa custom?"' });
      // Baris lama (sebelum level diganti ke bahasa Inggris) tetap tampil dengan level baru.
      await addError({ at: Date.now(), level: 'galat', text: '[alur] contoh error lama' });
      await addError({ at: Date.now(), level: 'error', text: '[alur] contoh error' });
      const al = await call('/api/gfan/alerts');
      assert.equal(al.body.alerts[0].kind, 'butuh-staf');
      assert.equal(al.body.errors[0].text, '[alur] contoh error');
      assert.equal(al.body.errors[0].level, 'error');
      assert.equal(al.body.errors[1].text, '[alur] contoh error lama');
      assert.equal(al.body.errors[1].level, 'error', "level lama 'galat' tampil sebagai 'error'");
      assert.equal((await call('/api/gfan/state')).body.alerts.length, 1);
      assert.equal((await call('/api/gfan/alerts', {}, false)).status, 401);
      const leads = await call('/api/gfan/leads');
      assert.ok('reportedAt' in leads.body);

      // --- Pelanggan lama: impor digabung, nomor dirapikan, baris ngawur dilewati ---
      const imp = (text: string, off = false) => call('/api/gfan/known', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, off }) });
      const i1 = await imp('0812 3456 7890, Pak Budi\n+62 813-5550-1234\nbukan nomor\n\n');
      assert.deepEqual([i1.body.added, i1.body.invalid, i1.body.total], [2, 1, 2]);
      const at1 = biz.knownAt;
      assert.ok(at1 > 0);
      assert.equal((await getContact('+6281234567890'))?.lead.name, 'Pak Budi', 'langsung dicatat sebagai kontak');
      const i2 = await imp('081234567890; Budi Santoso\n081700000009, Bu Sari', true);
      assert.deepEqual([i2.body.added, i2.body.total, i2.body.profile.knownCount], [1, 3, 3]);
      assert.equal((await getContact('+6281234567890'))?.lead.name, 'Pak Budi', 'kontak yang sudah ada tidak ditimpa');
      assert.equal((await getContact('+6281234567890'))?.pending_off, 1, '"bot diam" dicatat sampai alamat chatnya diketahui');
      assert.equal((await getContact('+6281355501234'))?.pending_off, 0);
      assert.deepEqual((await getContact('+6281700000009'))?.lead, { name: 'Bu Sari' });
      assert.equal((await imp('   ')).status, 400);
      assert.equal((await call('/api/gfan/known', { method: 'POST', body: '{}' }, false)).status, 401);
      // "Sudah ditangani": tanda "perlu staf" dihapus, langsung di database.
      await updateContact(C, { needs_sales: 1 });
      assert.equal((await post(`/api/gfan/leads/${encodeURIComponent('x')}/handled`)).status, 400);
      assert.equal((await post(`/api/gfan/leads/${encodeURIComponent('+6281299999999')}/handled`)).status, 404);
      assert.equal((await post(`/api/gfan/leads/${encodeURIComponent(C)}/handled`)).status, 200);
      assert.equal((await getContact(C))?.needs_sales, 0);
      assert.ok(((await getContact(C))?.handled_at ?? 0) > 0);
      assert.equal((await put({ settings: { followupSmart: false } })).status, 200);
      assert.equal(cfg.followupSmart, false);
      await put({ settings: {} });

      // Aturan balasan dari pemilik: baris kosong dibuang, panjang dan jumlahnya dibatasi.
      const sr = await put({ styleRules: ['  Pakai kalimat positif.  ', '', 'Langsung kirim katalog.'] });
      assert.deepEqual(sr.body.profile.styleRules, ['Pakai kalimat positif.', 'Langsung kirim katalog.']);
      assert.match(systemPrompt(), /ATURAN DARI PEMILIK[^\n]*\n- Pakai kalimat positif\.\n- Langsung kirim katalog\./);
      assert.match((await put({ styleRules: Array.from({ length: 21 }, () => 'x') })).body.error, /maksimal 20/);
      assert.match((await put({ styleRules: ['x'.repeat(401)] })).body.error, /terlalu panjang/);

      // Salam untuk nama yang sudah diketahui harus memuat {nama}.
      assert.match((await put({ greetingKnown: 'Halo, betul?' })).body.error, /\{nama\}/);
      assert.equal((await put({ greetingKnown: 'Halo Kak {nama}, betul?' })).status, 200);
      assert.equal((await put({ greetingKnown: '' })).status, 200, 'boleh dikosongkan');

      // --- Pengaturan: penerima, rute, dan setelan yang menimpa .env ---
      assert.equal((await put({ recipients: [] })).status, 200);
      assert.match((await post('/api/gfan/notify/test', {})).body.error, /Belum ada penerima/);
      const rec = await put({
        recipients: [
          { name: ' Pak Harry ', role: 'owner', phone: '0811 0000 0001' },
          { name: 'Rina', role: 'apa saja', phone: 'self' },
          { name: '', role: 'staff', phone: '' },
        ],
        notifyRoutes: { lead: 'both', llm: 'none', 'bot-mati': 'semua', ngawur: 'owner', resi: 'staff', marketplace: 'owner' },
      });
      assert.equal(rec.status, 200);
      assert.deepEqual(biz.recipients, [
        { name: 'Pak Harry', role: 'owner', phone: '+6281100000001' },
        { name: 'Rina', role: 'staff', phone: 'self' },
      ]);
      assert.deepEqual(biz.notifyRoutes, { lead: 'both', llm: 'none', resi: 'staff', marketplace: 'owner' }, 'jenis "resi" dan "marketplace" diterima');

      // "Kirim tes": satu pesan per nomor penerima, isinya kabar apa saja yang diterima nomor itu.
      const tq = await post('/api/gfan/notify/test', {});
      assert.deepEqual([tq.status, tq.body.phones], [200, ['+6281100000001', 'self']]);
      const sentTests: [string, string][] = [];
      setTestSender(async (phone, text) => { sentTests.push([phone, text]); return true; });
      await deliverOutbox(['test']);
      assert.deepEqual(sentTests.map(([p]) => p), ['+6281100000001', 'self']);
      assert.match(sentTests[0]![1], /^🔔 \*Tes notifikasi\* \| GFAN Indonesia\nIni pesan tes dari dashboard\. Kalau pesan ini sampai, nomor ini akan menerima kabar: lead baru, tautan toko Tokopedia & Shop\.$/,
        'pemilik: lead (rutenya keduanya) dan tautan toko; butuh staf ke staf');
      assert.match(sentTests[1]![1], /menerima kabar: lead baru, pelanggan butuh staf, saldo atau batas cek resi\.$/, 'staf; LLM "tidak dikirim" tidak disebut');
      const st = await call(`/api/gfan/notify/test?ids=${tq.body.ids.join(',')}`);
      assert.deepEqual(st.body.items.map((x: { done: boolean }) => x.done), [true, true]);
      // Gagal terus: baris ditutup sesudah MAX_REPLY_ATTEMPTS percobaan, tapi tidak tampil sebagai terkirim.
      const tq2 = await post('/api/gfan/notify/test', {});
      setTestSender(async () => { throw new Error('socket tertutup'); });
      for (let i = 0; i < MAX_REPLY_ATTEMPTS + 2; i++) await deliverOutbox(['test']);
      const st2 = await call(`/api/gfan/notify/test?ids=${tq2.body.ids.join(',')}`);
      assert.deepEqual(st2.body.items.map((x: { done: boolean; attempts: number }) => [x.done, x.attempts]), [[false, MAX_REPLY_ATTEMPTS], [false, MAX_REPLY_ATTEMPTS]]);
      setTestSender(null);
      assert.match((await put({ recipients: [{ name: 'X', phone: '12' }] })).body.error, /nomor WhatsApp/);
      assert.match((await put({ recipients: [{ name: 'X' }] })).body.error, /isi nomor WhatsApp/);

      // Kompatibilitas: profil lama masih membawa jalur email atau telegram (sudah dihapus). Penerima yang hanya
      // punya jalur itu dibuang tanpa pesan, kolomnya tidak disimpan, dan dashboard tetap bisa memuat profilnya.
      const legacyRows = [
        { name: 'Lama', role: 'owner', phone: '', email: '', telegram: '123456' },
        { name: 'Surel', role: 'owner', phone: '', email: 'owner@contoh.com' },
        { name: 'Campur', role: 'staff', phone: '0811 0000 0002', email: 'campur@contoh.com', telegram: '654321' },
      ];
      const old = await put({ recipients: legacyRows });
      assert.equal(old.status, 200, 'penerima lama tidak membuat simpan gagal');
      assert.deepEqual(biz.recipients, [{ name: 'Campur', role: 'staff', phone: '+6281100000002' }]);
      const keptProfile = await getProfile('gfan');
      await saveProfile('gfan', { ...keptProfile, recipients: legacyRows });
      await refreshBiz(true);
      assert.deepEqual(biz.recipients, [{ name: 'Campur', role: 'staff', phone: '0811 0000 0002' }], 'profil tersimpan: jalur lama dibuang saat dimuat');
      const legacyState = await call('/api/gfan/state');
      assert.equal(legacyState.status, 200);
      assert.ok(legacyState.body.profile.recipients.every((r: Record<string, unknown>) => !('telegram' in r) && !('email' in r)), 'dashboard tidak menerima jalur lama');
      assert.equal(legacyState.body.status.channels?.telegram, undefined);
      await saveProfile('gfan', keptProfile);
      await refreshBiz(true);

      const before = { after: cfg.followupAfterHours, vision: cfg.llmVision, only: [...cfg.onlyNumbers], perDay: cfg.waMaxPerDay };
      const set = await put({ settings: { followupAfterHours: 20, waMaxPerDay: '', llmPriceIn: 0.25, llmVision: false, onlyNumbers: ['0812 1111 0001'], adminPassword: 'x', dbPath: 'y' } });
      assert.equal(set.status, 200);
      assert.deepEqual(biz.settings, { followupAfterHours: 20, llmPriceIn: 0.25, llmVision: false, onlyNumbers: ['+6281211110001'] }, 'hanya setelan yang dikenal; yang kosong tidak disimpan');
      assert.equal(cfg.followupAfterHours, 20, 'langsung berlaku di bot');
      assert.equal(cfg.llmVision, false);
      assert.deepEqual(cfg.onlyNumbers, ['+6281211110001']);
      assert.equal(cfg.waMaxPerDay, before.perDay, 'yang tidak diisi tetap ikut .env');
      assert.equal(cfg.adminPassword, PASSWORD, 'kata sandi tidak bisa diubah dari sini');
      assert.equal((await call('/api/gfan/state')).body.status.effective.followupAfterHours, 20);
      assert.match((await put({ settings: { followupAfterHours: 500 } })).body.error, /1–72/);
      assert.match((await put({ settings: { followupStartHour: 20, followupEndHour: 8 } })).body.error, /jam selesai/);
      assert.match((await put({ settings: { followupAfterHours: 30, followupAfterHoursMax: 24 } })).body.error, /paling lama/);
      assert.equal((await put({ settings: { followupAfterHours: 20, followupAfterHoursMax: 22 } })).status, 200);
      assert.deepEqual([cfg.followupAfterHours, cfg.followupAfterHoursMax], [20, 22]);
      assert.match((await put({ settings: { onlyNumbers: ['abc'] } })).body.error, /bukan nomor/);
      // Jam tenang dan pemanasan: diperiksa seperti jam follow-up, langsung berlaku di bot.
      assert.deepEqual([cfg.quietEnabled, cfg.quietStartHour, cfg.quietEndHour, cfg.waWarmup], [true, 0, 7, true], 'bawaan');
      assert.match((await put({ settings: { quietStartHour: 8, quietEndHour: 6 } })).body.error, /Jam tenang: jam selesai/);
      assert.match((await put({ settings: { quietEndHour: 25 } })).body.error, /1–24/);
      assert.equal((await put({ settings: { quietEnabled: false, quietStartHour: 1, quietEndHour: 6, waWarmup: false } })).status, 200);
      assert.deepEqual([cfg.quietEnabled, cfg.quietStartHour, cfg.quietEndHour, cfg.waWarmup], [false, 1, 6, false]);
      const eff = (await call('/api/gfan/state')).body.status.effective;
      assert.deepEqual([eff.quietEnabled, eff.quietStartHour, eff.quietEndHour, eff.waWarmup], [false, 1, 6, false]);
      // Dikosongkan = kembali ke .env.
      assert.equal((await put({ settings: {} })).status, 200);
      assert.deepEqual([cfg.followupAfterHours, cfg.llmVision, cfg.onlyNumbers], [before.after, before.vision, before.only]);
      assert.deepEqual([cfg.quietEnabled, cfg.quietEndHour, cfg.waWarmup], [true, 7, true]);
      await put({ recipients: [], notifyRoutes: {} });
    }

    // --- proyek: daftar, buat baru, data terpisah per proyek ---
    {
      const list = await call('/api/projects');
      assert.deepEqual(list.body.projects.map((p: { id: string }) => p.id), ['gfan']);
      assert.ok(list.body.templates.includes('generic') && list.body.templates.includes('gfan'));
      const make = (body: unknown) => post('/api/projects', body);
      assert.match((await make({ id: 'API', name: 'X', template: 'generic' })).body.error, /Id proyek/);
      assert.equal((await make({ id: 'api', name: 'X', template: 'generic' })).status, 400, 'id yang dipakai alamat dashboard');
      for (const id of ['conversations', 'knowledge', 'settings', 'percakapan', 'pengetahuan', 'pengaturan']) {
        assert.equal((await make({ id, name: 'X', template: 'generic' })).status, 400, `id "${id}" dipakai alamat dashboard`);
      }
      assert.match((await make({ id: 'toko-b', name: 'X', template: 'entah' })).body.error, /Profil awal/);
      assert.match((await make({ id: 'toko-b', name: '', template: 'generic' })).body.error, /Nama/);
      assert.match((await make({ id: 'toko-b', name: 'Toko B', template: 'generic', wa_number: '12' })).body.error, /WhatsApp bot/);
      const made = await make({ id: 'toko-b', name: 'Toko B', template: 'generic', wa_number: '0812 7777 0001', sales_number: 'self' });
      assert.equal(made.status, 200);
      assert.deepEqual([made.body.project.wa_number, made.body.project.sales_number, made.body.project.enabled], ['+6281277770001', 'self', true]);
      assert.equal((await make({ id: 'toko-b', name: 'Lagi', template: 'gfan' })).status, 409, 'id yang sudah dipakai');
      assert.deepEqual((await call('/api/projects')).body.projects.map((p: { id: string }) => p.id), ['gfan', 'toko-b']);
      assert.equal((await call('/api/projects', {}, false)).status, 401);

      const b = await call('/api/toko-b/state');
      assert.equal(b.body.business, 'toko-b');
      assert.equal(b.body.profile.brand, 'Bisnis Baru', 'bibit umum');
      assert.deepEqual(b.body.profile.products, []);
      assert.equal((await call('/api/toko-b/leads')).body.rows.length, 0, 'lead proyek lain tidak ikut');
      assert.ok((await call('/api/gfan/leads')).body.rows.length > 0);
      assert.equal((await call('/api/toko-b/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand: 'Toko B' }) })).status, 200);
      assert.equal((await getProfile('toko-b')).brand, 'Toko B');
      assert.equal(biz.brand, 'GFAN Indonesia', 'profil gfan tidak tersentuh');

      // Baris proyek: jeda semua chat, nomor, jalur.
      const pp = (id: string, body: unknown) => call(`/api/${id}/project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.match((await pp('gfan', { sales_number: 'abc' })).body.error, /sales/);
      assert.match((await pp('gfan', { transport: 'telepati' })).body.error, /Jalur/);
      assert.equal((await pp('gfan', { paused: true, sales_number: '0812 9999 0001' })).body.project.paused, true);
      assert.equal((await getProject('gfan'))?.paused, true);
      assert.equal((await getProject('gfan'))?.sales_number, '+6281299990001', 'API lama tetap menerima nomor sales');
      assert.equal((await call('/api/projects')).body.projects[0].paused, true);
      assert.equal((await pp('gfan', { paused: false, sales_number: '' })).body.project.paused, false);
    }

    // --- WhatsApp: laporan bot, kode pairing, tautkan ulang ---
    {
      assert.equal((await call('/api/gfan/wa')).body.wa, null, 'bot belum pernah melapor');
      let listener: ((s: TransportState) => void) | null = null;
      const asked: string[] = [];
      let relinked = 0;
      const fake: Transport = {
        name: 'baileys', canMessageSelf: true, selfPhone: () => null, start: async () => {}, send: async () => {},
        onState: (cb) => void ((listener = cb), cb({ state: 'starting' })),
        requestPairingCode: async (n) => {
          asked.push(n);
          listener?.({ state: 'pairing', pairingCode: 'ABCD1234' });
          return 'ABCD1234';
        },
        relink: async () => {
          relinked += 1;
          listener?.({ state: 'qr', qr: 'qr-baru' });
        },
      };
      const stop = startHeartbeat(fake);
      try {
        await reportState({ state: 'qr', qr: '2@isi-qr' });
        const st = await readStatus('gfan');
        assert.deepEqual([st?.state, st?.qr, st?.pid], ['qr', '2@isi-qr', process.pid]);
        assert.ok((st?.last_seen_at ?? 0) > 0);
        const w = (await call('/api/gfan/wa')).body;
        assert.deepEqual([w.wa.state, w.wa.qr, w.pending], ['qr', '2@isi-qr', null]);
        assert.ok((await call('/api/gfan/state')).body.status.reportedAt > 0, 'laporan bot tampil di keadaan bot');

        assert.match((await post('/api/gfan/wa/pair', { number: 'abc' })).body.error, /tidak sah/);
        assert.equal((await post('/api/gfan/wa/pair', { number: '0812 3456 0001' })).status, 200);
        assert.deepEqual((await getProject('gfan'))?.pairing_request?.number, '6281234560001');
        assert.equal((await getProject('gfan'))?.wa_number, '+6281234560001', 'nomor bot diatur di halaman WhatsApp: ikut disimpan');
        assert.equal((await call('/api/gfan/wa')).body.pending, 'pair');
        await handlePairingRequest(fake);
        assert.deepEqual(asked, ['6281234560001']);
        assert.equal((await getProject('gfan'))?.pairing_request, null, 'permintaan selesai ditangani');
        const w2 = (await call('/api/gfan/wa')).body.wa;
        assert.deepEqual([w2.state, w2.pairing_code], ['pairing', 'ABCD1234']);

        assert.equal((await post('/api/gfan/wa/reset')).status, 200);
        await handlePairingRequest(fake);
        assert.equal(relinked, 1);
        assert.equal((await readStatus('gfan'))?.qr, 'qr-baru');
        await handlePairingRequest(fake);
        assert.equal(relinked, 1, 'tiap permintaan dijalankan sekali');

        // Nomor yang tersambung mengisi "Nomor WA bot" yang masih kosong, sekali, tanpa menimpa isian pemilik.
        const before = (await getProject('gfan'))?.wa_number ?? null;
        await updateProject('gfan', { wa_number: null });
        resetWaNumberCheck();
        await reportState({ state: 'connected', selfPhone: '+6281234560099' });
        assert.equal((await getProject('gfan'))?.wa_number, '+6281234560099');
        await updateProject('gfan', { wa_number: '+6281234560001' });
        await reportState({ state: 'connected', selfPhone: '+6281234560099' });
        assert.equal((await getProject('gfan'))?.wa_number, '+6281234560001', 'sekali per proses');
        resetWaNumberCheck();
        await reportState({ state: 'connected', selfPhone: '+6281234560099' });
        assert.equal((await getProject('gfan'))?.wa_number, '+6281234560001', 'isian pemilik tidak ditimpa');
        await updateProject('gfan', { wa_number: before });
      } finally {
        stop();
      }
    }

    // --- alamat halaman: satu alamat per menu, id proyek di depan ---
    {
      const page = (path: string, withCookie = true, headers: Record<string, string> = {}) =>
        fetch(base + path, { redirect: 'manual', headers: { ...headers, ...(withCookie ? { cookie } : {}) } });
      const r0 = await page('/', false);
      assert.deepEqual([r0.status, r0.headers.get('location')], [302, '/login'], 'tanpa sesi: ke halaman masuk');
      const r1 = await page('/');
      assert.deepEqual([r1.status, r1.headers.get('location')], [302, '/gfan'], 'proyek aktif yang pertama');
      for (const path of ['/gfan', '/gfan/conversations', '/gfan/conversations/%2B6281211110001', '/gfan/knowledge/behavior', '/gfan/knowledge/products',
        '/gfan/knowledge/brochures', '/gfan/settings', '/gfan/settings/whatsapp',
        '/gfan/settings/notifications', '/gfan/settings/advanced', '/gfan/conversations/', '/gfan/orders', '/gfan/settings/marketplace']) {
        const r = await page(path, false);
        assert.equal(r.status, 200, path);
        assert.match(r.headers.get('content-type') ?? '', /text\/html/);
        assert.match(await r.text(), /<script src="\/assets\/app\.js"><\/script>/, `${path}: halaman yang sama untuk semua menu`);
      }
      const last = await page('/toko-b/settings');
      assert.match(last.headers.get('set-cookie') ?? '', /^last_project=toko-b; SameSite=Strict; Path=\/; Max-Age=31536000/);
      const r2 = await page('/', false, { cookie: `${cookie}; last_project=toko-b` });
      assert.equal(r2.headers.get('location'), '/toko-b', '"/" kembali ke proyek yang terakhir dibuka');
      const r3 = await page('/', false, { cookie: `${cookie}; last_project=tidak-ada` });
      assert.equal(r3.headers.get('location'), '/gfan');
      const kn = await page('/gfan/knowledge');
      assert.deepEqual([kn.status, kn.headers.get('location')], [302, '/gfan/knowledge/behavior']);
      // Alamat lama berbahasa Indonesia: 301 ke alamat baru, sisa alamat dan query ikut.
      for (const [old, now] of [
        ['/gfan/percakapan', '/gfan/conversations'],
        ['/gfan/percakapan/', '/gfan/conversations'],
        ['/gfan/percakapan?stage=baru', '/gfan/conversations?stage=baru'],
        ['/gfan/percakapan/%2B6281211110001', '/gfan/conversations/%2B6281211110001'],
        ['/gfan/percakapan/lid%3A1234567890', '/gfan/conversations/lid%3A1234567890'],
        ['/gfan/pengetahuan', '/gfan/knowledge'],
        ['/gfan/pengaturan', '/gfan/settings'],
        ['/gfan/pengaturan/whatsapp', '/gfan/settings/whatsapp'],
        ['/gfan/pengaturan/notifikasi', '/gfan/settings/notifications'],
        ['/gfan/pengaturan/lanjutan', '/gfan/settings/advanced'],
        ['/toko-b/pengaturan/lanjutan', '/toko-b/settings/advanced'],
      ] as const) {
        const r = await page(old, false);
        assert.deepEqual([r.status, r.headers.get('location')], [301, now], `alamat lama ${old}`);
      }
      // Halaman Pengetahuan yang dihapus (dan alamat lama berbahasa Indonesia-nya) sengaja tidak dialihkan.
      for (const path of ['/gfan/knowledge/identity', '/gfan/knowledge/recommendations', '/gfan/knowledge/other',
        '/gfan/pengetahuan/identitas', '/gfan/pengetahuan/produk', '/gfan/pengetahuan/rekomendasi', '/gfan/pengetahuan/brosur',
        '/gfan/pengetahuan/lainnya']) {
        const r = await page(path);
        assert.deepEqual([r.status, r.headers.get('location')], [404, null], `halaman lama ${path}`);
      }
      for (const path of ['/gfan/entah', '/gfan/knowledge/entah', '/gfan/conversations/bukan-nomor', '/tidak-ada', '/tidak-ada/conversations',
        '/gfan/pengetahuan/entah', '/gfan/percakapan/bukan-nomor', '/tidak-ada/percakapan', '/gfan/pengaturan/umum',
        '/conversations', '/knowledge', '/settings', '/percakapan', '/assets', '/api']) {
        assert.equal((await page(path)).status, 404, path);
      }
      for (const path of ['/admin', '/admin/', '/admin/gfan/api/state']) {
        const r = await page(path);
        assert.deepEqual([r.status, r.headers.get('location')], [301, '/'], `alamat lama ${path}`);
      }
      const li = await page('/login');
      assert.deepEqual([li.status, li.headers.get('location')], [302, '/'], 'sudah masuk: tidak perlu halaman masuk');
      assert.equal((await page('/login?next=%2Fgfan%2Fsettings')).headers.get('location'), '/gfan/settings');
      assert.equal((await page('/login?next=%2F%2Fsitus-lain.example')).headers.get('location'), '/', 'hanya alamat di situs ini');
      for (const [path, type] of [['/assets/app.js', /javascript/], ['/assets/app.css', /text\/css/], ['/assets/qrcode.js', /javascript/]] as const) {
        const r = await page(path, false);
        assert.equal(r.status, 200, path);
        assert.match(r.headers.get('content-type') ?? '', type);
        assert.equal(r.headers.get('cache-control'), 'no-cache');
      }
      // Ikon tab dan berkas merek: tanpa sesi, jenis yang benar, boleh disimpan sehari.
      for (const [path, type] of [
        ['/favicon.ico', 'image/x-icon'], ['/assets/favicon.svg', 'image/svg+xml'], ['/assets/favicon-32.png', 'image/png'],
        ['/assets/favicon-192.png', 'image/png'], ['/assets/apple-touch-icon.png', 'image/png'],
        ['/assets/wordmark.svg', 'image/svg+xml'], ['/assets/wordmark.png', 'image/png'],
        ['/assets/tokopedia.png', 'image/png'], ['/assets/shopee.svg', 'image/svg+xml'],
      ] as const) {
        const r = await page(path, false);
        assert.equal(r.status, 200, path);
        assert.equal(r.headers.get('content-type'), type, path);
        assert.equal(r.headers.get('cache-control'), 'public, max-age=86400', path);
        assert.ok((await r.arrayBuffer()).byteLength > 0, `${path} tidak kosong`);
      }
      // Salinan alamat di app.js harus sama dengan routes.ts (app.js tidak bisa mengimpornya).
      {
        const src = readFileSync(join(__dirname, 'app.js'), 'utf8');
        const block = src.slice(src.indexOf('const ROUTES = {'), src.indexOf('const KNOWLEDGE'));
        const js = new Function(`${block}; return { ROUTES, OLD_ROUTES, renamedPath };`)() as {
          ROUTES: unknown; OLD_ROUTES: unknown; renamedPath: (rest: string) => string | null;
        };
        assert.deepEqual(js.ROUTES, ROUTES, 'ROUTES di app.js sama dengan routes.ts');
        assert.deepEqual(js.OLD_ROUTES, OLD_ROUTES, 'OLD_ROUTES di app.js sama dengan routes.ts');
        for (const rest of ['percakapan/%2B628121', 'pengaturan/lanjutan', 'pengetahuan', 'pengetahuan/entah', 'pengetahuan/produk', 'constructor']) {
          assert.equal(js.renamedPath(rest), renamedPath(rest), rest);
        }
      }
      // Daftar "Di halaman ini": bagian tanpa id diberi id dari id halaman + judul Indonesianya.
      {
        const src = readFileSync(join(__dirname, 'app.js'), 'utf8');
        const at = src.indexOf('function tocSlug(');
        const tocSlug = new Function(`${src.slice(at, src.indexOf('\n}\n', at) + 2)}; return tocSlug;`)() as (page: string, title: string) => string;
        assert.equal(tocSlug('pengaturan', 'Follow-up'), 'pengaturan-follow-up');
        assert.equal(tocSlug('lanjutan', 'Batas &amp; pengaman'), 'lanjutan-batas-pengaman');
        assert.equal(tocSlug('beranda', 'Pertanyaan yang belum terjawab'), 'beranda-pertanyaan-yang-belum-terjawab');
        assert.equal(tocSlug('x', '<b>Énergie</b>  2 kW'), 'x-energie-2-kw');
        assert.equal(tocSlug('x', '…'), 'x-bagian');
        // Satu daftar bersama untuk semua halaman, tanpa tautan yang ditulis tangan.
        const html = readFileSync(join(__dirname, 'page.html'), 'utf8');
        assert.equal(html.split('class="toc"').length - 1, 1, 'satu daftar "Di halaman ini"');
        assert.ok(!/<a href="#/.test(html), 'tautan daftar diisi app.js');
      }
      // Tiap halaman di ROUTES punya satu bagian dan satu tautan menu di page.html; halaman yang dihapus hilang.
      {
        const html = readFileSync(join(__dirname, 'page.html'), 'utf8');
        const all = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
        const pages = all(/<section data-page="([^"]+)"/g);
        const navs = all(/<a data-nav="([^"]+)"/g);
        for (const pg of Object.keys(ROUTES)) {
          assert.equal(pages.filter((x) => x === pg).length, 1, `bagian data-page="${pg}"`);
          assert.equal(navs.filter((x) => x === pg).length, 1, `menu data-nav="${pg}"`);
        }
        for (const pg of ['identitas', 'rekomendasi', 'lainnya']) {
          assert.ok(!pages.includes(pg) && !navs.includes(pg), `halaman ${pg} sudah dihapus`);
        }
        // Isian yang dipindah tetap terikat ke kunci profil yang sama (penyimpanan tidak berubah).
        for (const key of ['brand', 'alias', 'persona', 'honorific', 'about', 'greeting', 'greetingKnown', 'advice', 'notes',
          'guardCodes', 'handoffTopics', 'handoffLabel', 'forbidPrices']) {
          assert.equal(all(/data-key="([^"]+)"/g).filter((x) => x === key).length, 1, `data-key="${key}"`);
        }
      }
      // Teks dashboard tanpa tanda pisah panjang (em dash): pakai koma, titik dua, atau titik.
      for (const name of ['page.html', 'app.js', 'app.css']) {
        const text = readFileSync(join(__dirname, name), 'utf8');
        const at = text.indexOf('\u2014');
        assert.equal(at, -1, `${name} masih memuat tanda pisah panjang: "${text.slice(Math.max(0, at - 40), at + 40)}"`);
      }
      for (const id of ['login', 'assets', 'health', 'webhook', 'admin', 'logout', 'tiktok', 'orders']) {
        assert.equal((await post('/api/projects', { id, name: 'X', template: 'generic' })).status, 400, `id "${id}" dipakai alamat dashboard`);
      }
    }

    // --- panel Bantuan: panduan dashboard (bantuan.md) dan tanya jawab darinya ---
    {
      const guide = readFileSync(join(__dirname, 'bantuan.md'), 'utf8');
      const html = readFileSync(join(__dirname, 'page.html'), 'utf8');
      const plain = (t: string) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
      // Judul kartu, judul lipatan, dan nama menu di page.html: semuanya harus dibahas panduan,
      // supaya fitur baru tidak lolos tanpa teks bantuannya.
      const titles = new Set<string>();
      for (const m of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)) titles.add(plain(m[1] as string));
      for (const m of html.matchAll(/<summary><span[^>]*>([\s\S]*?)<\/span>/g)) titles.add(plain(m[1] as string));
      for (const m of html.matchAll(/<a data-nav="[^"]+">[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/g)) titles.add(plain(m[1] as string));
      titles.delete('');
      assert.ok(titles.size >= 30, `judul yang ditemukan di page.html terlalu sedikit: ${titles.size}`);
      const low = guide.toLowerCase();
      for (const t of titles) assert.ok(low.includes(t.toLowerCase()), `bantuan.md belum membahas "${t}" (judul di page.html)`);
      assert.equal(guide.indexOf('\u2014'), -1, 'bantuan.md masih memuat tanda pisah panjang');
      assert.deepEqual([...HELP_PAGES].sort(), Object.keys(ROUTES).sort(), 'kunci halaman yang boleh disebut jawaban = halaman dashboard');

      // Pembacaan jawaban model: tanda pisah panjang dirapikan, halaman yang tidak dikenal dibuang.
      assert.deepEqual(parseHelp('{"answer":"Buka Pengaturan › WhatsApp — lalu pindai QR.","found":true,"page":"whatsapp"}'),
        { answer: 'Buka Pengaturan › WhatsApp, lalu pindai QR.', found: true, page: 'whatsapp' });
      assert.deepEqual(parseHelp('{"answer":"Belum ada.","found":false,"page":"tidak-ada"}'), { answer: 'Belum ada.', found: false, page: '' });
      assert.equal(parseHelp('{"found":true}'), null);
      assert.equal(parseHelp('bukan json'), null);

      const help = await call('/api/gfan/help');
      assert.equal(help.status, 200);
      assert.match(help.body.text, /^# Panduan dashboard Alice AI/);
      assert.equal(help.body.ready, false, 'tanpa LLM_API_KEY tanya jawab belum siap');
      assert.match((await post('/api/gfan/help/ask', { question: 'cara tautkan wa?' })).body.error, /LLM belum diatur/);
      assert.match((await post('/api/gfan/help/ask', { question: '' })).body.error, /masih kosong/);

      let seen: Parameters<Helper>[0] | null = null;
      setAdminHelper(async (i) => {
        seen = i;
        return i.question.includes('siaran')
          ? { answer: 'Belum bisa dari dashboard.', found: false, page: '' }
          : { answer: 'Buka Pengaturan › WhatsApp.', found: true, page: 'whatsapp' };
      });
      assert.equal((await call('/api/gfan/help')).body.ready, true);
      const ok1 = await post('/api/gfan/help/ask', { question: 'cara tautkan wa?', history: [{ dir: 'in', text: 'halo' }, { dir: 'out', text: 'hai' }], lang: 'en' });
      assert.equal(ok1.status, 200);
      assert.deepEqual(ok1.body, { answer: 'Buka Pengaturan › WhatsApp.', found: true, page: 'whatsapp' });
      assert.deepEqual(seen, { question: 'cara tautkan wa?', history: [{ dir: 'in', text: 'halo' }, { dir: 'out', text: 'hai' }], project: 'gfan', lang: 'en' });
      assert.ok(!existsSync(unansweredPath()), 'pertanyaan yang terjawab tidak dicatat');
      const ok2 = await post('/api/gfan/help/ask', { question: 'bisa kirim siaran ke semua pelanggan?' });
      assert.equal(ok2.body.found, false);
      const logged = readFileSync(unansweredPath(), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { project: string; question: string });
      assert.equal(logged.length, 1);
      assert.deepEqual([logged[0]?.project, logged[0]?.question], ['gfan', 'bisa kirim siaran ke semua pelanggan?']);
    }

    // --- satu percakapan: riwayat, tahap + catatan, balasan dari web ---
    {
      const P = '+6281288880001';
      const lead = (path = '', init?: RequestInit) => call(`/api/gfan/leads/${encodeURIComponent(P)}${path}`, init);
      const putLead = (body: unknown) => lead('', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const reply = (text: unknown) => post(`/api/gfan/leads/${encodeURIComponent(P)}/reply`, { text });
      assert.equal((await lead()).status, 404, 'kontak yang belum ada');
      assert.equal((await call('/api/gfan/leads/bukan-nomor')).status, 400);
      const t0 = Date.now() - 60_000;
      await createContact(P, `${P.slice(1)}@s.whatsapp.net`, t0);
      for (let i = 0; i < 5; i++) await addMessage(P, i % 2 ? 'out' : 'in', `pesan ${i}`, t0 + i * 1000);
      const d = await lead();
      assert.equal(d.status, 200);
      assert.deepEqual(d.body.messages.map((m: { text: string }) => m.text), ['pesan 0', 'pesan 1', 'pesan 2', 'pesan 3', 'pesan 4'], 'terlama dulu');
      assert.deepEqual([d.body.contact.stage, d.body.contact.note, d.body.contact.canReply, d.body.more], ['baru', '', true, false]);
      assert.deepEqual(d.body.pending_replies, []);
      const pg = await lead(`?limit=2`);
      assert.deepEqual([pg.body.messages.map((m: { text: string }) => m.text), pg.body.more], [['pesan 3', 'pesan 4'], true]);
      const older = await lead(`?limit=2&before=${pg.body.messages[0].id}`);
      assert.deepEqual(older.body.messages.map((m: { text: string }) => m.text), ['pesan 1', 'pesan 2'], 'halaman sebelumnya');

      // Tahap pipeline dan catatan.
      assert.match((await putLead({ stage: 'menang' })).body.error, /Tahap/);
      const empty = await putLead({});
      assert.deepEqual([empty.status, empty.body.error], [400, 'Isi tahap, catatan, atau data pesanan.']);
      assert.match((await putLead({ note: 'x'.repeat(2001) })).body.error, /terlalu panjang/);
      assert.match((await putLead({ stage: 'closing' })).body.error, /Tahap/, '"closing" sudah diganti tiga tahap pesanan');
      for (const stage of ['dikirim', 'selesai']) assert.equal((await putLead({ stage })).body.stage, stage);
      const st = await putLead({ stage: 'payment', note: '  minta penawaran Senin  ' });
      assert.deepEqual([st.status, st.body.stage, st.body.note], [200, 'payment', 'minta penawaran Senin']);
      assert.deepEqual([(await getContact(P))?.stage, (await getContact(P))?.note], ['payment', 'minta penawaran Senin']);
      const row = (await call('/api/gfan/leads')).body.rows.find((r: { phone: string }) => r.phone === P);
      assert.deepEqual([row.stage, row.note], ['payment', 'minta penawaran Senin'], 'tahap dan catatan tampil di daftar');
      assert.equal((await putLead({ note: '' })).body.note, null, 'catatan bisa dikosongkan');
      await putLead({ stage: 'baru' });

      // Pesanan dan resi: isian staf, lalu "Cek resi" dengan pelacak tiruan.
      setTracker(null);
      cfg.binderbyteKey = '';
      const track = (phone = P) => post(`/api/gfan/leads/${encodeURIComponent(phone)}/track`);
      const d0 = (await lead()).body;
      assert.deepEqual(d0.order, {
        ref: '', awb: '', courier: '', status: null, phase: 'unknown', history: [], checkedAt: null, error: null, links: [], trackingEnabled: false,
      });
      assert.equal(d0.couriers.length, 25);
      assert.deepEqual(d0.couriers[0], { code: 'jne', label: 'JNE' });
      const badAwb = await putLead({ awb: 'JP 123/4' });
      assert.deepEqual([badAwb.status, badAwb.body.error], [400, 'Nomor resi hanya boleh huruf, angka, dan tanda minus.']);
      assert.equal((await putLead({ awb: 'J'.repeat(41) })).status, 400, 'resi maksimal 40 karakter');
      const badCourier = await putLead({ courier: 'dhl' });
      assert.deepEqual([badCourier.status, badCourier.body.error], [400, 'Kurir tidak dikenal.']);
      assert.match((await putLead({ order_ref: 'x'.repeat(61) })).body.error, /terlalu panjang/);
      assert.equal((await getContact(P))?.awb, null, 'isian yang ditolak tidak disimpan');
      const o1 = await putLead({ order_ref: '  576123456789012345 ', awb: ' jp1234567890 ', courier: 'jnt' });
      assert.equal(o1.status, 200, 'badan hanya berisi data pesanan juga diterima');
      assert.deepEqual([o1.body.order.ref, o1.body.order.awb, o1.body.order.courier, o1.body.stage], ['576123456789012345', 'JP1234567890', 'jnt', 'baru']);
      assert.deepEqual(o1.body.order.links, [{ label: 'cekresi.com', url: 'https://cekresi.com/?noresi=JP1234567890' }]);
      assert.ok(((await getContact(P))?.awb_at ?? 0) > 0, 'awb_at diisi');

      const off = await track();
      assert.deepEqual([off.status, off.body.error], [503, 'Pelacakan resi belum diatur. Isi BINDERBYTE_API_KEY di .env server.']);
      assert.equal((await track('+6281299998888')).status, 404);

      const hist = [{ date: '2026-11-25 09:00:00', desc: 'PAKET DIBAWA KURIR', location: 'JAKARTA' }];
      setTracker(async () => ({ status: 'ON PROCESS', history: hist }));
      await updateContact(P, { stage: 'payment' });
      const before = await trackUsageToday(localDay(Date.now()));
      const t1 = await track();
      assert.equal(t1.status, 200);
      const counted = await trackUsageToday(localDay(Date.now()));
      assert.deepEqual(counted, { auto: before.auto, manual: before.manual + 1 }, '"Cek resi" dihitung sebagai cek manual');
      assert.deepEqual([t1.body.stage, t1.body.order.status, t1.body.order.phase, t1.body.order.history, t1.body.order.error, t1.body.order.trackingEnabled],
        ['dikirim', 'ON PROCESS', 'transit', hist, null, true]);
      assert.ok(t1.body.order.checkedAt > 0);
      const d1 = (await lead()).body;
      assert.deepEqual([d1.contact.stage, d1.order.status, d1.order.trackingEnabled], ['dikirim', 'ON PROCESS', true]);

      // Pelacak gagal: bukan 500, pesannya ada di order.error; status dan tahap lama tetap.
      setTracker(async () => { throw new Error('Credit tidak cukup, silakan lakukan topup credit.'); });
      const t2 = await track();
      assert.deepEqual([t2.status, t2.body.order.error, t2.body.order.status, t2.body.stage],
        [200, 'Credit tidak cukup, silakan lakukan topup credit.', 'ON PROCESS', 'dikirim']);
      // Retur: fase "problem", tahap tetap.
      setTracker(async () => ({ status: 'RETURN TO SENDER', history: hist }));
      const tp = await track();
      assert.deepEqual([tp.body.order.phase, tp.body.order.status, tp.body.order.error, tp.body.stage], ['problem', 'RETURN TO SENDER', null, 'dikirim']);

      // Kurir diganti: hasil pelacakan lama dikosongkan, resi tetap.
      const o2 = await putLead({ courier: 'jne' });
      assert.deepEqual([o2.body.order.awb, o2.body.order.status, o2.body.order.error, o2.body.order.checkedAt, o2.body.order.history],
        ['JP1234567890', null, null, null, []]);
      setTracker(async () => ({ status: 'DELIVERED', history: hist }));
      assert.equal((await track()).body.stage, 'selesai');
      // Resi dikosongkan: hasil pelacakan dan awb_at ikut kosong, "Cek resi" minta resi dulu.
      const o3 = await putLead({ awb: '' });
      assert.deepEqual([o3.body.order.awb, o3.body.order.status, o3.body.order.checkedAt, o3.body.order.links, o3.body.order.courier],
        ['', null, null, [], 'jne']);
      assert.equal((await getContact(P))?.awb_at, null);
      const noAwb = await track();
      assert.deepEqual([noAwb.status, noAwb.body.error], [400, 'Isi nomor resi dan kurir dulu.']);
      setTracker(null);
      await putLead({ stage: 'baru', order_ref: '', courier: '' });
      assert.deepEqual((await lead()).body.order.ref, '');

      // Balas dari web: masuk antrean bot dan bot mundur, sama seperti membalas dari HP.
      assert.match((await reply('   ')).body.error, /kosong/);
      assert.match((await reply('x'.repeat(4001))).body.error, /terlalu panjang/);
      assert.equal((await post(`/api/gfan/leads/${encodeURIComponent('+6281299998888')}/reply`, { text: 'halo' })).status, 404);
      assert.match((await post(`/api/gfan/leads/${encodeURIComponent('+6281700000009')}/reply`, { text: 'halo' })).body.error, /belum pernah chat/, 'pelanggan lama yang belum pernah chat');
      await updateContact(P, { needs_sales: 1 });
      const sentAt = Date.now();
      const r = await reply('  Halo Pak, saya Rina dari GFAN.\r\nAda yang bisa dibantu?  ');
      assert.equal(r.status, 200);
      assert.deepEqual([r.body.message.dir, r.body.message.text, r.body.message.kind, r.body.stage], ['human', 'Halo Pak, saya Rina dari GFAN.\nAda yang bisa dibantu?', 'dashboard', 'dihubungi']);
      const c = await getContact(P);
      // 'pending' = pengingat setelah admin dijadwalkan, sama seperti balasan dari HP.
      assert.deepEqual([c?.last_dir, c?.followup_state, c?.stage], ['human', 'pending', 'dihubungi'], 'tahap "baru" pindah ke "dihubungi"');
      assert.equal(c?.needs_sales, 0, 'dibalas dari web: tanda perlu staf lepas');
      assert.ok(((await humanSeenAt(c?.address as string)) ?? 0) >= sentAt, 'tanda "admin membalas" dipasang');
      assert.equal((await recentMessages(P, 1))[0]?.dir, 'human');
      const after = await lead();
      assert.equal(after.body.contact.hold, 'admin', 'bot mundur di chat ini');
      assert.equal(after.body.messages.at(-1).kind, 'dashboard');
      assert.equal(after.body.pending_replies.length, 1);
      assert.deepEqual([after.body.pending_replies[0].message_id, after.body.pending_replies[0].failed], [r.body.message.id, false]);
      const queued = await pendingReplies(P);
      assert.deepEqual(queued.map((q) => (q.payload as { text: string; by: string; address: string }).by), ['dashboard']);
      assert.equal((queued[0]?.payload as { address: string }).address, c?.address);

      // Proses bot mengirimnya; setelah itu tidak lagi "menunggu terkirim".
      const out: string[] = [];
      setReplySender(async (to, text) => void out.push(`${to.address}: ${text}`));
      await deliverOutbox(['reply']);
      assert.deepEqual(out, [`${c?.address}: Halo Pak, saya Rina dari GFAN.\nAda yang bisa dibantu?`]);
      assert.deepEqual((await lead()).body.pending_replies, []);
      // Yang terus gagal: tampil "gagal" di percakapan dan jadi warning.
      setReplySender(async () => { throw new Error('tidak tersambung'); });
      await reply('yang ini gagal');
      for (let i = 0; i < MAX_REPLY_ATTEMPTS; i++) await deliverOutbox(['reply']);
      assert.equal((await lead()).body.pending_replies[0].failed, true);
      assert.ok((await recentAlerts(20)).some((a) => a.kind === 'kiriman-gagal'));
      setReplySender(null);
      // Balasan manusia tidak memindahkan tahap selain "baru".
      await putLead({ stage: 'batal' });
      await reply('terima kasih');
      assert.equal((await getContact(P))?.stage, 'batal');
    }

    // --- Tokopedia & Shop: callback izin, webhook, pesanan, tautan ke percakapan (fetch tiruan) ---
    {
      const KEY = 'appkey-uji';
      const SECRET = 'secret-uji';
      const ORDER = '576462377512830999';
      const P2 = '+6281288880002';
      const raw = (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: 'manual', ...init });
      const putJson = (path: string, body: unknown) => call(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'Success', request_id: 'r', data }), { status: 200 });
      const sec = Math.floor(Date.now() / 1000);
      let orderStatus = 'AWAITING_SHIPMENT';
      let failToken = false;
      /** Selama diisi: pencarian pesanan menunggu janji ini (sinkron "sedang berjalan"). */
      let searchGate: Promise<void> | null = null;
      /** Selama diisi: detail pesanan menunggu janji ini (webhook "sedang diproses"). */
      let detailGate: Promise<void> | null = null;
      const fetched: string[] = [];
      const fake: TiktokFetch = async (url) => {
        const u = new URL(url);
        fetched.push(u.pathname);
        if (u.host === 'auth.tiktok-shops.com') {
          if (failToken) return new Response(JSON.stringify({ code: 36004004, message: 'invalid auth code', request_id: 'r', data: {} }), { status: 200 });
          return ok({ access_token: 'akses', access_token_expire_in: sec + 7 * 86400, refresh_token: 'segar', refresh_token_expire_in: sec + 60 * 86400, seller_name: 'Toko GFAN', granted_scopes: [] });
        }
        if (u.pathname === '/authorization/202309/shops') return ok({ shops: [{ id: 'SHOP-UJI', name: 'GFAN Official', region: 'ID', cipher: 'CIPHER-UJI' }] });
        if (u.pathname === '/order/202309/orders/search') {
          if (searchGate) await searchGate;
          return ok({ orders: [], next_page_token: '' });
        }
        if (u.pathname === '/order/202507/orders') {
          if (detailGate) await detailGate;
          return ok({ orders: [{
            id: ORDER, status: orderStatus, commerce_platform: 'TOKOPEDIA', create_time: sec - 600, update_time: sec, paid_time: sec - 300,
            payment: { total_amount: '250000', currency: 'IDR' }, recipient_address: { name: 'B***i', phone_number: '(+62)812-***-1234' },
            line_items: [{ product_name: 'Kipas Plafon', sku_id: 'S1', sale_price: '250000' }],
          }] });
        }
        throw new Error(`panggilan tak terduga: ${url}`);
      };

      // Mati tanpa app key dan secret: halaman menjelaskan, callback tidak ada.
      cfg.tiktokAppKey = '';
      cfg.tiktokAppSecret = '';
      assert.equal((await raw('/tiktok/auth?state=x&code=y')).status, 404, 'fitur mati');
      assert.equal((await raw('/tiktok/webhook', { method: 'POST', body: '{}' })).status, 404);
      const m0 = (await call('/api/gfan/marketplace')).body;
      assert.deepEqual([m0.enabled, m0.canAuth, m0.link, m0.webhookUrl, m0.redirectUrl, m0.orders],
        [false, false, null, 'https://alice-api.lukicenturi.com/tiktok/webhook', 'https://alice-api.lukicenturi.com/tiktok/auth', { total: 0, unmatched: 0 }]);
      assert.equal((await call('/api/gfan/marketplace', {}, false)).status, 401, 'halaman pengaturan butuh sesi');
      assert.equal((await post('/api/gfan/marketplace/auth-url')).status, 400, 'fitur mati: tidak ada halaman izin');

      cfg.tiktokAppKey = KEY;
      cfg.tiktokAppSecret = SECRET;
      cfg.tiktokServiceId = 'svc-uji';
      setTiktokFetch(fake);
      const m1 = (await call('/api/gfan/marketplace')).body;
      assert.deepEqual([m1.enabled, m1.canAuth, m1.authUrl], [true, true, undefined], 'alamat halaman izin tidak ikut di GET');
      // Alamat halaman izin dibuat tiap klik, hanya dengan sesi.
      assert.equal((await call('/api/gfan/marketplace/auth-url', { method: 'POST' }, false)).status, 401, 'butuh sesi');
      const au = await post('/api/gfan/marketplace/auth-url');
      assert.equal(au.status, 200);
      assert.match(au.body.url, /^https:\/\/services\.tiktokshop\.com\/open\/authorize\?service_id=svc-uji&state=/);
      const au2 = await post('/api/gfan/marketplace/auth-url');
      assert.notEqual(new URL(au2.body.url).searchParams.get('state'), new URL(au.body.url).searchParams.get('state'), 'state baru tiap klik');

      // Callback izin: state palsu 400 (halaman kecil, bukan JSON), ditolak pemilik toko, berhasil, dan kode yang salah.
      const badState = await raw('/tiktok/auth?state=palsu&code=abc');
      assert.equal(badState.status, 400);
      assert.match(badState.headers.get('content-type') ?? '', /text\/html/);
      const badHtml = await badState.text();
      assert.match(badHtml, /Tautan kedaluwarsa atau tidak sah, misalnya setelah dashboard dimulai ulang\. Buka dashboard lalu klik Tautkan toko lagi\./);
      assert.match(badHtml, /<a href="\/">/, 'tautan ke dashboard (alamat relatif tanpa ADMIN_ORIGINS)');
      const denied = await raw(`/tiktok/auth?state=${makeState('gfan', Date.now())}&code=null&error=auth_denied`);
      assert.deepEqual([denied.status, denied.headers.get('location')], [302, '/gfan/settings/marketplace?linked=0']);
      failToken = true;
      const wrong = await raw(`/tiktok/auth?state=${makeState('gfan', Date.now())}&code=lama`);
      assert.equal(wrong.status, 302);
      assert.match(wrong.headers.get('location') ?? '', /^\/gfan\/settings\/marketplace\?linked=0&error=.*invalid%20auth%20code/);
      assert.equal((await call('/api/gfan/marketplace')).body.link, null);
      failToken = false;
      // Toko yang sudah tertaut ke proyek lain ditolak, dengan pesan yang bisa dibaca.
      await withProject((await loadProject('toko-b'))!, () => saveShopLink({
        shop_id: 'SHOP-UJI', shop_cipher: 'C', shop_name: 'GFAN Official', region: 'ID', seller_name: null, open_id: null, access_token: 'a',
        access_expires_at: Date.now() + 86_400_000, refresh_token: 'r', refresh_expires_at: Date.now() + 86_400_000, granted_scopes: [],
        linked_at: Date.now(), last_sync_at: null, status: 'active', error: null, updated_at: Date.now(),
      }));
      const taken = await raw(`/tiktok/auth?state=${makeState('gfan', Date.now())}&code=kode-0`);
      assert.deepEqual([taken.status, taken.headers.get('location')], [302, `/gfan/settings/marketplace?linked=0&error=${encodeURIComponent('Toko ini sudah tertaut ke proyek toko-b. Putuskan tautannya di sana dulu.')}`]);
      assert.equal((await call('/api/gfan/marketplace')).body.link, null);
      await withProject((await loadProject('toko-b'))!, () => deleteShopLink());
      // Kembali ke alamat dashboard (ADMIN_ORIGINS yang pertama); state hanya sekali pakai.
      const origins = cfg.adminOrigins;
      cfg.adminOrigins = ['https://dash.contoh.id'];
      const goodState = makeState('gfan', Date.now());
      const good = await raw(`/tiktok/auth?state=${goodState}&code=kode-1`);
      assert.deepEqual([good.status, good.headers.get('location')], [302, 'https://dash.contoh.id/gfan/settings/marketplace?linked=1']);
      const reused = await raw(`/tiktok/auth?state=${goodState}&code=kode-1`);
      assert.equal(reused.status, 400, 'state yang sudah dipakai ditolak');
      const reusedPage = await reused.text();
      assert.match(reusedPage, /<a href="https:\/\/dash\.contoh\.id\/">/);
      assert.match(reusedPage, /misalnya setelah dashboard dimulai ulang\. Buka dashboard lalu klik Tautkan toko lagi\./);
      cfg.adminOrigins = origins;
      const m2 = (await call('/api/gfan/marketplace')).body;
      assert.deepEqual([m2.link.shopId, m2.link.shopName, m2.link.region, m2.link.sellerName, m2.link.status], ['SHOP-UJI', 'GFAN Official', 'ID', 'Toko GFAN', 'active']);
      assert.equal(m2.link.accessExpiresAt, (sec + 7 * 86400) * 1000);
      assert.equal(m2.link.access_token, undefined, 'token tidak dikirim ke peramban');

      // Webhook: tanda tangan salah 401; benar 200, pesanan masuk sesudahnya.
      const body = JSON.stringify({ type: 1, tts_notification_id: 'w-1', shop_id: 'SHOP-UJI', timestamp: sec, data: { order_id: ORDER, order_status: 'AWAITING_SHIPMENT', update_time: sec } });
      const sig = createHmac('sha256', SECRET).update(KEY + body).digest('hex');
      const hook = (b: string, authorization?: string) => raw('/tiktok/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: b });
      assert.equal((await hook(body)).status, 401, 'tanpa tanda tangan');
      assert.equal((await hook(body, `Bearer ${sig}`)).status, 401, 'dengan awalan');
      assert.equal((await hook(body.replace('w-1', 'w-2'), sig)).status, 401, 'badan diubah');
      // Detail pesanan ditahan: jawaban 200 datang sebelum pemrosesan selesai, dan webhook sudah tersimpan menunggu.
      let releaseDetail!: () => void;
      detailGate = new Promise<void>((r) => (releaseDetail = r));
      const details = () => fetched.filter((p) => p === '/order/202507/orders').length;
      const detailsBefore = details();
      const hooked = await hook(body, sig);
      assert.deepEqual([hooked.status, await hooked.json()], [200, { ok: true }]);
      const pending = await getWebhookEvent('w-1');
      assert.deepEqual([pending?.tries, (pending?.pending as { tts_notification_id?: string } | null)?.tts_notification_id], [0, 'w-1'], 'tersimpan menunggu sebelum diproses');
      assert.equal((await call('/api/gfan/orders')).body.rows.length, 0, 'belum diproses');
      // Kiriman ulang selagi menunggu: 200, tanpa pemrosesan kedua.
      assert.equal((await hook(body, sig)).status, 200);
      for (let i = 0; i < 100 && details() === detailsBefore; i++) await new Promise((r) => setTimeout(r, 5));
      releaseDetail();
      detailGate = null;
      let rows: { orderId: string; status: string; contactPhone: string | null; contactName: string | null; items: unknown[]; total: string }[] = [];
      for (let i = 0; i < 100 && !rows.length; i++) {
        rows = (await call('/api/gfan/orders')).body.rows;
        if (!rows.length) await new Promise((r) => setTimeout(r, 20));
      }
      assert.deepEqual(rows.map((r) => [r.orderId, r.status, r.contactPhone, r.total]), [[ORDER, 'AWAITING_SHIPMENT', null, '250000']]);
      assert.deepEqual(rows[0]!.items, [{ name: 'Kipas Plafon', sku: 'S1', qty: 1, price: '250000' }]);
      for (let i = 0; i < 100 && (await getWebhookEvent('w-1'))?.pending; i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal((await getWebhookEvent('w-1'))?.pending, null, 'selesai: pending dikosongkan');
      assert.equal(details() - detailsBefore, 1, 'satu kali diproses');
      assert.equal((await hook(body, sig)).status, 200, 'kiriman ulang sesudah selesai: 200');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(details() - detailsBefore, 1, 'sesudah selesai: dilewati');
      const other = JSON.stringify({ type: 1, tts_notification_id: 'w-3', shop_id: 'SHOP-LAIN', data: { order_id: '1' } });
      assert.equal((await hook(other, createHmac('sha256', SECRET).update(KEY + other).digest('hex'))).status, 200, 'toko tidak dikenal: 200, diabaikan');

      // Saringan dan pencarian.
      const ids = async (qs: string) => (await call(`/api/gfan/orders?${qs}`)).body.rows.map((r: { orderId: string }) => r.orderId);
      assert.deepEqual(await ids('status=belum-tertaut'), [ORDER]);
      assert.deepEqual(await ids('status=perlu-kirim'), [ORDER]);
      assert.deepEqual(await ids('status=batal'), []);
      assert.deepEqual(await ids('q=kipas'), [ORDER]);
      assert.deepEqual(await ids('q=b***'), [ORDER], 'nama penerima');
      assert.deepEqual(await ids('q=zzz'), []);
      // Saringan yang tidak dikenal (juga nama bawaan objek JS) = semua.
      for (const status of ['ngawur', '__proto__', 'constructor', 'toString']) {
        const r = await call(`/api/gfan/orders?status=${status}`);
        assert.deepEqual([r.status, r.body.rows.map((x: { orderId: string }) => x.orderId)], [200, [ORDER]], `status=${status}`);
      }
      assert.deepEqual((await call('/api/gfan/marketplace')).body.orders, { total: 1, unmatched: 1 });

      // Tautkan manual ke percakapan, lalu lepas.
      const link = (phone: string) => putJson(`/api/gfan/orders/${ORDER}`, { phone });
      assert.deepEqual([(await link('0812 1234 0000')).status, (await link('0812 1234 0000')).body.error], [400, 'Nomor ini tidak ada di percakapan.']);
      assert.equal((await putJson('/api/gfan/orders/tidak-ada', { phone: '' })).status, 404);
      await createContact(P2, `${P2.slice(1)}@s.whatsapp.net`, Date.now());
      await updateContact(P2, { wa_name: 'Budi WA', stage: 'dihubungi' });
      const linked = await link('0812-8888-0002');
      assert.deepEqual([linked.status, linked.body.row.contactPhone, linked.body.row.contactName], [200, P2, 'Budi WA']);
      assert.deepEqual([(await getContact(P2))?.order_ref, (await getContact(P2))?.stage], [ORDER, 'payment'], 'nomor pesanan diisi, tahap naik');
      assert.deepEqual(await ids('status=belum-tertaut'), []);
      const detail = (await call(`/api/gfan/leads/${encodeURIComponent(P2)}`)).body;
      assert.deepEqual(detail.marketplace, {
        orderId: ORDER, platform: 'TOKOPEDIA', status: 'AWAITING_SHIPMENT', paidTime: (sec - 300) * 1000, total: '250000', currency: 'IDR',
        trackingNumber: null, shippingProvider: null, updateTime: sec * 1000,
      });
      const unlinked = await link('');
      assert.deepEqual([unlinked.status, unlinked.body.row.contactPhone], [200, null]);
      assert.equal((await getContact(P2))?.order_ref, null, 'nomor pesanan di percakapan ikut dilepas');
      assert.equal((await call(`/api/gfan/leads/${encodeURIComponent(P2)}`)).body.marketplace, null);

      // Pesanan hilang di tengah jalan (pemicu database membuat ubahan baris pesanan tidak mengenai apa pun): 404, bukan 500.
      await db().execute(sql.raw('CREATE FUNCTION uji_lewati() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$'));
      await db().execute(sql.raw('CREATE TRIGGER uji_lewati BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION uji_lewati()'));
      try {
        const gone = await link('0812-8888-0002');
        assert.deepEqual([gone.status, gone.body.error], [404, 'Pesanan sudah tidak ada.']);
      } finally {
        await db().execute(sql.raw('DROP TRIGGER uji_lewati ON orders'));
        await db().execute(sql.raw('DROP FUNCTION uji_lewati()'));
      }

      // Staf mengisi nomor pesanan di percakapan: pesanan yang ada langsung tertaut dan diterapkan.
      orderStatus = 'IN_TRANSIT';
      const again = JSON.stringify({ type: 1, tts_notification_id: 'w-4', shop_id: 'SHOP-UJI', data: { order_id: ORDER, order_status: 'IN_TRANSIT' } });
      assert.equal((await hook(again, createHmac('sha256', SECRET).update(KEY + again).digest('hex'))).status, 200);
      for (let i = 0; i < 100 && (await ids('status=dikirim')).length === 0; i++) await new Promise((r) => setTimeout(r, 20));
      const byRef = await putJson(`/api/gfan/leads/${encodeURIComponent(P2)}`, { order_ref: ORDER });
      assert.deepEqual([byRef.status, byRef.body.stage, byRef.body.order.ref], [200, 'dikirim', ORDER]);
      assert.equal((await call('/api/gfan/orders')).body.rows[0].contactPhone, P2);
      // Nomor pesanan dikosongkan staf: pesanan dilepas, tidak lagi mengubah percakapan ini.
      assert.equal((await putJson(`/api/gfan/leads/${encodeURIComponent(P2)}`, { order_ref: '' })).status, 200);
      assert.equal((await call('/api/gfan/orders')).body.rows[0].contactPhone, null, 'nomor pesanan kosong: pesanan dilepas');
      // Diisi lagi: tertaut lagi.
      await putJson(`/api/gfan/leads/${encodeURIComponent(P2)}`, { order_ref: ORDER });
      assert.equal((await call('/api/gfan/orders')).body.rows[0].contactPhone, P2);
      // Diganti ke nomor lain: pesanan lama dilepas.
      await putJson(`/api/gfan/leads/${encodeURIComponent(P2)}`, { order_ref: 'INV/LAIN-01' });
      assert.equal((await call('/api/gfan/orders')).body.rows[0].contactPhone, null, 'nomor pesanan diganti: pesanan lama dilepas');

      // Sinkron sekarang: dijawab langsung, sinkronnya di latar belakang; klik kedua selagi berjalan tidak memulai lagi.
      // Lalu putuskan tautan: pesanan yang sudah masuk tetap ada.
      fetched.length = 0;
      let openGate!: () => void;
      searchGate = new Promise<void>((r) => { openGate = r; });
      const synced = await post('/api/gfan/marketplace/sync');
      assert.deepEqual([synced.status, synced.body.ok, synced.body.started, synced.body.link.shopId], [200, true, true, 'SHOP-UJI'], 'dijawab sebelum sinkron selesai');
      const before = synced.body.link.lastSyncAt;
      const second = await post('/api/gfan/marketplace/sync');
      assert.deepEqual([second.status, second.body.ok, second.body.started], [200, true, false], 'sinkron masih berjalan');
      openGate();
      searchGate = null;
      for (let i = 0; i < 100 && (await call('/api/gfan/marketplace')).body.link.lastSyncAt === before; i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok((await call('/api/gfan/marketplace')).body.link.lastSyncAt > (before ?? 0), 'sinkron di latar belakang selesai');
      assert.deepEqual(fetched, ['/order/202309/orders/search'], 'satu sinkron saja');
      const cut = await post('/api/gfan/marketplace/unlink');
      assert.deepEqual([cut.status, cut.body.link], [200, null]);
      const kept = await withProject((await loadProject('gfan'))!, () => getShopLink());
      assert.deepEqual([kept?.status, kept?.shop_id, kept?.access_token], ['unlinked', 'SHOP-UJI', ''], 'baris disimpan untuk webhook pencabutan izin');
      assert.equal((await call('/api/gfan/orders')).body.rows.length, 1);
      assert.match((await post('/api/gfan/marketplace/sync')).body.error, /belum ditautkan/);

      // Kode izin yang ditempel sendiri (aplikasi seller developer, tanpa callback).
      assert.equal((await call('/api/gfan/marketplace/code', { method: 'POST', body: '{"code":"kode-izin-1"}' }, false)).status, 401, 'butuh sesi');
      for (const code of [undefined, '', '   ', 'pendek', 'x'.repeat(201), 12345678]) {
        const r = await post('/api/gfan/marketplace/code', { code });
        assert.deepEqual([r.status, r.body.error], [400, 'Isi kode izin dari Partner Center.'], `kode ${JSON.stringify(code)}`);
      }
      failToken = true;
      const badCode = await post('/api/gfan/marketplace/code', { code: 'kode-izin-lama' });
      assert.equal(badCode.status, 400);
      assert.match(badCode.body.error, /invalid auth code/, 'pesan dari Tokopedia & Shop yang bisa dibaca');
      assert.equal((await call('/api/gfan/marketplace')).body.link, null);
      failToken = false;
      fetched.length = 0;
      const byCode = await post('/api/gfan/marketplace/code', { code: '  kode-izin-1  ' });
      assert.equal(byCode.status, 200);
      assert.deepEqual([byCode.body.link.shopId, byCode.body.link.status], ['SHOP-UJI', 'active']);
      // Sinkron pertama berjalan di latar belakang: tunggu sampai selesai sebelum fetch tiruan dilepas.
      for (let i = 0; i < 100 && !(await call('/api/gfan/marketplace')).body.link.lastSyncAt; i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok((await call('/api/gfan/marketplace')).body.link.lastSyncAt > 0, 'sinkron pertama');
      assert.equal(fetched[0], '/api/v2/token/get');
      assert.equal((await post('/api/gfan/marketplace/unlink')).status, 200);
      cfg.tiktokAppKey = '';
      assert.equal((await post('/api/gfan/marketplace/code', { code: 'kode-izin-1' })).status, 400, 'fitur mati');
      cfg.tiktokAppKey = KEY;

      setTiktokFetch(null);
      cfg.tiktokAppKey = '';
      cfg.tiktokAppSecret = '';
      cfg.tiktokServiceId = '';
      await putJson(`/api/gfan/leads/${encodeURIComponent(P2)}`, { stage: 'baru', order_ref: '', awb: '', courier: '' });
    }


    // --- pertanyaan yang dioper ke staf -> pengetahuan ---
    {
      const C1 = '+6281211110001';
      const C2 = '+6281355501234';
      const t = Date.now();
      const notesBefore = biz.notes;
      assert.equal(await addHandoff(C1, 'Bisa kirim ke Papua?', t), true);
      assert.equal(await addHandoff(C1, '  bisa KIRIM ke papua?? ', t + 1), false, 'sama (setelah dinormalkan) dan belum dijawab: tidak dicatat lagi');
      assert.equal(await addHandoff(C2, 'Bisa kirim ke Papua', t + 2), true);
      assert.equal(await addHandoff(C2, 'Garansinya berapa lama?', t + 3), true);
      const open = (await call('/api/gfan/handoffs?status=open')).body.groups;
      assert.equal(open.length, 2);
      const papua = open.find((g: { question: string }) => /papua/i.test(g.question));
      assert.deepEqual([papua.count, papua.people, papua.last_at], [2, 2, t + 2], 'dikelompokkan per pertanyaan yang sama');
      const garansi = open.find((g: { question: string }) => /garansi/i.test(g.question));
      const resolve = (id: number, body: unknown) => post(`/api/gfan/handoffs/${id}/resolve`, body);
      assert.equal((await resolve(papua.id, {})).status, 400);
      assert.match((await resolve(papua.id, { resolution: 'ditambahkan' })).body.error, /jawabannya/);
      assert.equal((await resolve(999_999, { resolution: 'diabaikan' })).status, 404);
      const added = await resolve(papua.id, { resolution: 'ditambahkan', answer: 'Bisa, ongkirnya dihitung saat pesan.' });
      assert.deepEqual([added.status, added.body.resolved], [200, 2]);
      assert.equal(papua.question, 'Bisa kirim ke Papua', 'contoh = yang terbaru');
      assert.ok(biz.notes.endsWith('\n\nT: Bisa kirim ke Papua\nJ: Bisa, ongkirnya dihitung saat pesan.'), 'ditambahkan ke "Pengetahuan lain"');
      assert.ok(biz.notes.startsWith(notesBefore.trimEnd()), 'isi lama tetap');
      assert.match(knowledgeText(), /J: Bisa, ongkirnya dihitung saat pesan\./, 'bot langsung memakainya');
      assert.equal(added.body.profile.notes, biz.notes);
      assert.equal((await resolve(papua.id, { resolution: 'diabaikan' })).status, 409, 'sudah selesai');
      assert.equal((await call('/api/gfan/handoffs')).body.groups.length, 1);
      const done = (await call('/api/gfan/handoffs?status=resolved')).body.groups;
      assert.deepEqual([done.length, done[0].resolution, done[0].count], [1, 'ditambahkan', 2]);
      // Pengetahuan lain yang sudah penuh: ditolak dengan pesan yang jelas.
      assert.equal((await put({ notes: 'x'.repeat(29_990) })).status, 200);
      assert.match((await resolve(garansi.id, { resolution: 'ditambahkan', answer: 'Satu tahun untuk semua produk.' })).body.error, /terlalu panjang/);
      assert.equal((await resolve(garansi.id, { resolution: 'diabaikan' })).body.resolved, 1);
      assert.deepEqual((await call('/api/gfan/handoffs')).body.groups, []);
      assert.equal((await put({ notes: notesBefore })).status, 200);
      assert.equal((await call('/api/gfan/handoffs', {}, false)).status, 401);
    }

    // --- "Ajari bot": konteks, Bantu jelaskan, Coba lagi, simpan pelajaran ---
    {
      const C3 = '+6281211119003';
      const t0 = Date.now() - 60_000;
      const ASK = 'Biasanya berapa orang yang ada di ruangan itu?';
      const Q = 'biasa bisa sampai 10-12 orang lah';
      const REPLY = 'Dengan 10-12 orang, pakai 2 unit GFC15-18A.';
      await createContact(C3, C3, t0);
      await addMessage(C3, 'in', 'ruang karaoke 5x5x3 m', t0);
      await addMessage(C3, 'out', ASK, t0 + 1000);
      await addMessage(C3, 'in', Q, t0 + 2000);
      await addMessage(C3, 'out', REPLY, t0 + 30_000);
      await addMessage(C3, 'out', '[pdf:d0000000c] Ceiling Fan A', t0 + 31_000);
      assert.equal(await addHandoff(C3, Q, t0 + 2000), true);
      // Halaman chat: pesan yang mengutip membawa kutipannya.
      await addMessage(C3, 'in', 'yang ini ready?', t0 + 40_000, null, undefined, { text: 'Ceiling Fan A', by: 'us', media: 'dokumen' });
      const thread = (await call(`/api/gfan/leads/${encodeURIComponent(C3)}`)).body.messages;
      assert.deepEqual(thread.at(-1).quote, { text: 'Ceiling Fan A', by: 'us', media: 'dokumen' });
      assert.equal(thread.at(-2).quote, null);
      const g = (await call('/api/gfan/handoffs?status=open')).body.groups.find((x: { phone: string }) => x.phone === C3);
      assert.deepEqual(g.context, { before: ASK, reply: REPLY }, 'pesan bot sebelumnya dan balasan bot, tanpa tanda lampiran');

      // Bantu jelaskan: LLM menerima riwayat, pesannya, dan balasan bot saat itu.
      let seen: { question: string; history: { text: string }[]; reply: string } | null = null;
      setAdminExplainer(async (i) => {
        seen = i;
        return { why: 'Pesan itu jawaban atas pertanyaan bot sendiri.', lesson: 'Jumlah orang adalah jawaban atas pertanyaan pemakaian ruangan.' };
      });
      const ex = await post(`/api/gfan/handoffs/${g.id}/explain`, {});
      assert.deepEqual([ex.status, ex.body.lesson], [200, 'Jumlah orang adalah jawaban atas pertanyaan pemakaian ruangan.']);
      assert.deepEqual([seen!.question, seen!.reply, seen!.history.map((h) => h.text)], [Q, REPLY, ['ruang karaoke 5x5x3 m', ASK]]);
      assert.equal((await post('/api/gfan/handoffs/999999/explain', {})).status, 404);

      // Coba lagi: giliran yang sama, dengan pelajaran yang belum disimpan.
      let input: Parameters<Parameters<typeof setAdminBrain>[0]>[0] | null = null;
      setAdminBrain(async (i) => {
        input = i;
        return { reply: 'Untuk 10-12 orang, 2 unit GFC15-18A sudah cukup.', fields: {}, intent: 'info', photos: [], docs: [], buy: [], summary: '' };
      });
      const tr = await post(`/api/gfan/handoffs/${g.id}/retry`, { lesson: 'Jumlah orang = jawaban soal pemakaian ruangan.' });
      assert.deepEqual([tr.status, tr.body.intent, tr.body.rejected], [200, 'info', null]);
      assert.equal(input!.text, Q);
      assert.deepEqual(input!.history.map((h) => h.text), ['ruang karaoke 5x5x3 m', ASK], 'riwayat sampai sebelum pesan itu');
      assert.deepEqual(input!.lessons, [{ rule: 'Jumlah orang = jawaban soal pemakaian ruangan.', example: `Bot: "${ASK}" Pelanggan: "${Q}"` }]);
      assert.ok(!biz.lessons.length, 'Coba lagi tidak menyimpan apa pun');
      assert.match(systemPrompt(input!.lessons), /PELAJARAN DARI PERCAKAPAN NYATA[^\n]*\n- Jumlah orang = jawaban soal pemakaian ruangan\.\n  Contoh: Bot: "Biasanya berapa orang/);

      // Simpan pelajaran: masuk profil, bot membacanya di tiap balasan.
      const resolve = (body: unknown) => post(`/api/gfan/handoffs/${g.id}/resolve`, body);
      assert.match((await resolve({ resolution: 'diajarkan' })).body.error, /pelajarannya/);
      const saved = await resolve({ resolution: 'diajarkan', lesson: '  Jumlah orang adalah jawaban atas pertanyaan pemakaian ruangan.  ' });
      assert.deepEqual([saved.status, saved.body.resolved], [200, 1]);
      assert.deepEqual(biz.lessons, [{ rule: 'Jumlah orang adalah jawaban atas pertanyaan pemakaian ruangan.', example: `Bot: "${ASK}" Pelanggan: "${Q}"` }]);
      assert.deepEqual(saved.body.profile.lessons, biz.lessons);
      assert.match(systemPrompt(), /\n- Jumlah orang adalah jawaban atas pertanyaan pemakaian ruangan\.\n  Contoh: Bot: "/);
      const done = (await call('/api/gfan/handoffs?status=resolved')).body.groups.find((x: { phone: string }) => x.phone === C3);
      assert.deepEqual([done.resolution, done.answer], ['diajarkan', 'Jumlah orang adalah jawaban atas pertanyaan pemakaian ruangan.']);

      // Daftar pelajaran di "Cara bot bicara": baris kosong dibuang, yang terlalu panjang ditolak.
      assert.match((await put({ lessons: [{ rule: 'x'.repeat(601) }] })).body.error, /600/);
      assert.equal((await put({ lessons: [{ rule: '  ' }, { rule: 'Sapa dengan Kak.', example: '' }] })).status, 200);
      assert.deepEqual(biz.lessons, [{ rule: 'Sapa dengan Kak.', example: '' }]);
      assert.match(systemPrompt(), /\n- Sapa dengan Kak\.(\n\n|$)/);
      assert.equal((await put({ lessons: [] })).status, 200);
      assert.ok(!/PELAJARAN DARI PERCAKAPAN NYATA/.test(systemPrompt()), 'tanpa pelajaran, bagiannya tidak ada');
    }

    // --- empat angka Beranda (proyek sendiri supaya datanya pasti) ---
    {
      await ensureProject('metrik', 'generic', 'Uji Metrik');
      const ctx = (await loadProject('metrik'))!;
      const t = Date.now();
      await withProject(ctx, async () => {
        const A = '+6281266660001';
        const B = '+6281266660002';
        await createContact(A, A, t - 2 * 86_400_000);
        await createContact(B, B, t - 20_000);
        // Dua hari lalu: follow-up ke A, A membalas sejam kemudian, bot menjawab semenit setelahnya.
        await addMessage(A, 'out', 'Halo Pak, masih tertarik?', t - 2 * 86_400_000, null, 'followup');
        await addMessage(A, 'in', 'masih, kirim katalognya', t - 2 * 86_400_000 + 3_600_000);
        await addMessage(A, 'out', 'Ini katalognya.', t - 2 * 86_400_000 + 3_660_000);
        // Hari ini: A dijawab dalam 30 detik; B belum dijawab dan perlu staf.
        await addMessage(A, 'in', 'yang 16 inci ada?', t - 30_000);
        await addMessage(A, 'out', 'Ada, Pak.', t);
        await addMessage(B, 'in', 'bisa custom?', t - 20_000);
        await addMessage(B, 'human', 'Bisa, Pak. Saya bantu.', t - 10_000);
        await updateContact(B, { needs_sales: 1, stage: 'payment' });
      });
      const m = (await call('/api/metrik/metrics')).body;
      assert.equal(m.windowDays, 7);
      assert.equal(m.days.length, 7);
      assert.equal(m.today, 2, 'dua orang chat hari ini');
      assert.equal(m.days.reduce((a: number, d: { conversations: number }) => a + d.conversations, 0), 3);
      assert.deepEqual(m.handed, { total: 2, count: 1 }, 'satu dari dua percakapan dioper ke staf');
      assert.equal(m.replyMedianSec, 45, 'median dari 60 dan 30 detik; follow-up tidak dihitung sebagai balasan');
      assert.deepEqual(m.followup, { sent: 1, answered: 1 });
      // Pesan per hari menurut arah, terlama dulu, satu baris per hari di jendela.
      assert.equal(m.messagesByDay.length, 7);
      assert.deepEqual(m.messagesByDay.map((d: { day: string }) => d.day), m.days.map((d: { day: string }) => d.day));
      type MsgDay = { in: number; out: number; human: number };
      const total = m.messagesByDay.reduce((a: MsgDay, d: MsgDay) => ({ in: a.in + d.in, out: a.out + d.out, human: a.human + d.human }), { in: 0, out: 0, human: 0 });
      assert.deepEqual(total, { in: 3, out: 3, human: 1 }, 'follow-up ikut dihitung sebagai pesan bot');
      const { day: _today, ...todayMsgs } = m.messagesByDay[6];
      assert.deepEqual(todayMsgs, { in: 2, out: 1, human: 1 });
      // Tahap lead: semua kontak proyek, tidak dibatasi jendela.
      assert.deepEqual(m.stages, { baru: 1, menunggu: 0, dihubungi: 0, link: 0, payment: 1, dikirim: 0, selesai: 0, batal: 0 });
      // ?days=: jendela lain untuk grafik, paling banyak 90; yang tidak sah kembali ke 7.
      const m14 = (await call('/api/metrik/metrics?days=14')).body;
      assert.deepEqual([m14.windowDays, m14.days.length, m14.messagesByDay.length], [14, 14, 14]);
      assert.equal(m14.days[13].day, m.days[6].day, 'hari terakhir tetap hari ini');
      assert.equal(m14.messagesByDay.reduce((a: number, d: { in: number }) => a + d.in, 0), 3);
      assert.deepEqual(m14.stages, m.stages);
      assert.equal((await call('/api/metrik/metrics?days=500')).body.windowDays, 90);
      for (const bad of ['abc', '0', '-3', '']) assert.equal((await call('/api/metrik/metrics?days=' + bad)).body.windowDays, 7, `days=${bad}`);
      const empty = (await call('/api/toko-b/metrics')).body;
      assert.deepEqual([empty.today, empty.handed, empty.replyMedianSec, empty.followup], [0, { total: 0, count: 0 }, null, { sent: 0, answered: 0 }]);
      assert.ok(empty.messagesByDay.every((d: MsgDay) => d.in === 0 && d.out === 0 && d.human === 0));
      assert.equal((await call('/api/metrik/metrics', {}, false)).status, 401);
    }

    // --- permintaan dari situs lain ditolak ---
    const cross = await call('/api/gfan/profile', { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://situs-lain.example' }, body: '{"alias":"X"}' });
    assert.equal(cross.status, 403);
    assert.equal(biz.alias, 'Rina');

    // --- percobaan masuk dibatasi ---
    for (let i = 0; i < 5; i++) await login('tebak' + i);
    assert.equal((await login(PASSWORD)).status, 429, 'terkunci walau kata sandinya benar');

    // --- irama balasan ---
    biz.replyDelayMin = 8;
    biz.replyDelayMax = 30;
    let prev: number | null = null;
    let near = 0;
    for (let i = 0; i < 400; i++) {
      const d = pickDelayMs(60_000, prev);
      assert.ok(d >= 8000 && d <= 30000, `di luar batas: ${d}`);
      if (prev !== null && Math.abs(d - prev) < 22_000 * 0.15) near += 1;
      prev = d;
    }
    assert.ok(near < 8, `terlalu sering hampir sama berturut-turut: ${near}/400`);
    const burst = pickDelayMs(3000, 20_000);
    assert.ok(burst >= 2000 && burst <= 5000, 'pesan susulan dalam satu giliran menyusul cepat');
    // Lama mengetik mengikuti panjang pesan, dijepit 1,5–6 detik (lihat pace.test.ts).
    assert.equal(typingMs(60, 4), 6000);
    assert.ok(typingMs(10, 4) < typingMs(20, 4));
    assert.ok(typingMs(3) === 1500 && typingMs(5000) === 6000);
    biz.replyDelayMin = biz.replyDelayMax = 0;
    assert.equal(pickDelayMs(60_000, null), 0, 'jeda bisa dimatikan');

    console.log('dashboard: OK');
  } catch (e) {
    console.error('dashboard: GAGAL\n', e);
    process.exitCode = 1;
  } finally {
    await stopAdmin();
    await closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
})();
