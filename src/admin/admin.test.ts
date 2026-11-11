/**
 * Dashboard: masuk, simpan profil (dan bot langsung ikut), foto, uji coba,
 * dan pagar keamanannya. Folder data sementara; tidak menyentuh data asli.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkReply, systemPrompt } from '../brain';
import { biz, initBiz, knowledgeText, mediaDir, refreshBiz } from '../business';
import { addUsage } from '../store';
import { cfg } from '../config';
import { pickDelayMs, typingMs } from '../pace';
import { openDb } from '../store';
import { setAdminBrain, startAdmin, stopAdmin } from './server';
import { localStore } from './store-local';

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
  openDb(':memory:');
  initBiz();

  let base = '';
  let cookie = '';
  const call = async (path: string, init: RequestInit = {}, withCookie = true) => {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...(withCookie && cookie ? { cookie } : {}) },
    });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, body: type.includes('json') ? ((await res.json()) as any) : await res.arrayBuffer(), res };
  };
  const put = (body: unknown) =>
    call('/admin/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  try {
    base = `http://127.0.0.1:${await startAdmin(localStore())}`;

    // --- masuk ---
    assert.equal((await call('/admin')).status, 200);
    assert.equal((await call('/admin/api/state')).status, 401, 'tanpa sesi tidak ada data');
    const login = (password: string) =>
      call('/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }, false);
    assert.equal((await login('salah')).status, 401);
    const ok = await login(PASSWORD);
    assert.equal(ok.status, 200);
    const setCookie = ok.res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly; SameSite=Strict/);
    cookie = setCookie.split(';')[0] as string;
    assert.equal((await call('/admin/api/state', { headers: { cookie: 'admin_session=9999999999999.palsu' } }, false)).status, 401);

    const state = await call('/admin/api/state');
    assert.equal(state.body.profile.brand, 'GFAN Indonesia');
    assert.equal(state.body.profile.id, undefined, 'hanya kunci yang boleh diubah yang ditampilkan');
    assert.equal(state.body.business, 'gfan');
    assert.equal(state.body.status.reportedAt, null);

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
    assert.equal(state.body.profile.catalog.length, 6, 'tabel produk bawaan tampil di dashboard');
    assert.equal(state.body.profile.products.length, 30, 'satu baris per model');
    assert.deepEqual(state.body.profile.products[0], { name: 'GFC10-12B4', description: 'Ceiling Fan GFC — Model B4 (ceiling vent-type)', price: '', stock: '', photos: [], pdf: '' });
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
    const usage = (await call('/admin/api/usage')).body.usage;
    assert.deepEqual(usage.days[1], { day: '2026-11-10', calls: 3, promptTokens: 10000, cachedTokens: 8000, completionTokens: 400 });
    assert.equal(usage.days[0].day, '2026-11-11');
    assert.equal(usage.price.out, cfg.llmPriceOut);
    assert.equal((await call('/admin/api/usage', {}, false)).status, 401);
    assert.equal(JSON.parse(readFileSync(join(dir, 'gfan', 'profile.json'), 'utf8')).alias, 'Rina');

    // --- masukan yang salah ditolak dengan pesan yang bisa dibaca ---
    assert.equal((await put({ leadFields: [] })).status, 400);
    assert.match((await put({ leadFields: [{ key: 'Nama Lengkap', label: 'nama' }] })).body.error, /huruf kecil/);
    assert.match((await put({ replyDelayMin: 40, replyDelayMax: 10 })).body.error, /Jeda/);
    assert.equal((await put({ greeting: '   ' })).status, 400);
    const fields = await put({ leadFields: [{ key: 'name', label: 'nama', hint: '', isName: true }, { key: 'tanggal', label: 'tanggal acara', hint: '' }] });
    assert.equal(fields.status, 200);
    assert.match(systemPrompt(), /"tanggal": null/);

    // --- proses lain menyimpan: bot ini ikut tanpa restart ---
    const file = join(dir, 'gfan', 'profile.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), honorific: 'Kak' }));
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    refreshBiz();
    assert.equal(biz.honorific, 'Kak');

    // --- berkas: foto dan PDF, dipasang ke baris produk ---
    const up = (data: Buffer, name = 'depan.png') =>
      call(`/admin/api/files?${new URLSearchParams({ name })}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: data });
    assert.equal((await up(Buffer.from('<script>alert(1)</script>'))).status, 400, 'bukan gambar/PDF ditolak, apa pun content-type-nya');
    const photo = (await up(PNG)).body.file;
    assert.match(photo.file, /^f[0-9a-f]{8}\.png$/);
    const pdf = (await up(Buffer.from('%PDF-1.4\n%isi'), '../../Brosur <b>GFAF</b>.pdf')).body.file;
    assert.match(pdf.file, /^d[0-9a-f]{8}\.pdf$/, 'nama berkas dibuat sendiri, bukan dari pengunggah');
    const stray = (await up(PNG, 'tidak-jadi.png')).body.file;
    assert.ok(existsSync(join(mediaDir(), photo.file)) && existsSync(join(mediaDir(), pdf.file)));
    assert.equal((await call(`/admin/media/${photo.file}`)).status, 200);
    assert.equal((await call(`/admin/media/${pdf.file}`)).res.headers.get('content-type'), 'application/pdf');
    assert.equal((await call(`/admin/media/${photo.file}`, {}, false)).status, 401);
    assert.equal((await call('/admin/media/..%2F..%2Fprofile.json')).status, 404);
    assert.equal((await call('/admin/media/f00000000.png')).status, 404);

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
    const prod2 = await put({
      products: [
        { name: 'GFAF-40A', description: 'Exhaust 16" | industri', price: 'Rp 450.000', stock: 'ada', photos: [photo.id, pdf.id, 'f99999999'], pdf: pdf.id },
        { name: 'GFAF-50A', description: '', price: '', stock: '', photos: [], pdf: photo.id },
        { name: '', description: '', price: '', stock: '', photos: [], pdf: '' },
      ],
      questions: ['Ukuran kamarnya berapa × berapa?', '  ', 'Dipakai untuk apa?'],
    });
    assert.equal(prod2.status, 200);
    assert.deepEqual(biz.products, [
      { name: 'GFAF-40A', description: 'Exhaust 16" industri', price: 'Rp 450.000', stock: 'ada', photos: [photo.id], pdf: pdf.id },
      { name: 'GFAF-50A', description: '', price: '', stock: '', photos: [], pdf: '' },
    ]);
    assert.deepEqual(biz.files.map((f) => f.id), [photo.id, pdf.id], 'foto yang tidak dipakai dihapus dari daftar');
    assert.ok(!existsSync(join(mediaDir(), stray.file)), '…dan dari disk');
    assert.match(systemPrompt(), new RegExp(`GFAF-40A \\| Exhaust 16" industri \\| Rp 450.000 \\| ada \\| ${photo.id} \\| ${pdf.id}`));
    assert.match(systemPrompt(), /GFAF-50A \| - \| - \| - \| - \| -/);
    assert.match(systemPrompt(), /PERTANYAAN KEBUTUHAN\n- Ukuran kamarnya berapa × berapa\?\n- Dipakai untuk apa\?/);

    // Logo: harus gambar yang ada; selama dipakai tidak ikut dibuang.
    const logo = (await up(PNG, 'logo.png')).body.file;
    assert.equal((await put({ logo: logo.id })).status, 200);
    assert.match((await put({ logo: pdf.id })).body.error, /Logo/);
    assert.deepEqual(biz.files.map((f) => f.id), [photo.id, pdf.id, logo.id]);

    // --- uji coba: memakai pagar yang sama dengan bot sungguhan ---
    setAdminBrain(async (i) => ({
      reply: i.text.includes('harga') ? 'Harganya Rp 500.000' : i.text.includes('40A') ? 'GFAF-40A Rp 450.000 ya' : 'Ini fotonya ya',
      fields: { name: 'Budi' }, intent: 'info', photos: [photo.id], docs: [pdf.id], summary: '',
    }));
    const test = (text: string) => call('/admin/api/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const t1 = await test('minta foto');
    assert.equal(t1.body.rejected, null);
    assert.equal(t1.body.photos[0].file, photo.file);
    assert.equal(t1.body.docs[0].file, pdf.file);
    assert.equal((await test('harga berapa')).body.rejected, 'menyebut harga', 'harga di luar daftar produk ditolak');
    assert.equal((await test('40A berapa')).body.rejected, null, 'harga yang tertulis di daftar produk boleh');

    // Foto yang dilepas dari produk ikut dihapus; PDF tetap di pustaka sampai
    // dihapus dari halaman PDF, dan saat itu lepas dari semua produk.
    assert.equal((await put({ products: [{ name: 'GFAF-40A', description: '', price: '', stock: '', photos: [], pdf: pdf.id }, { name: 'GFAF-40AB', pdf: pdf.id }] })).status, 200);
    assert.ok(!existsSync(join(mediaDir(), photo.file)) && existsSync(join(mediaDir(), pdf.file)));
    assert.deepEqual(biz.files.map((f) => f.id), [pdf.id, logo.id]);
    assert.equal((await call(`/admin/api/files/${logo.id}`, { method: 'DELETE' })).status, 404, 'hanya PDF yang dihapus lewat sini');
    const gone = await call(`/admin/api/files/${pdf.id}`, { method: 'DELETE' });
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
      assert.equal(await pdfText(Buffer.from('%PDF-1.4 rusak')), '', 'PDF yang tidak terbaca = tanpa kecocokan, bukan galat');

      const real = join(process.cwd(), 'catalog-pdf', 'Industrial Fan - GFan.pdf');
      await put({ products: [{ name: 'GFAF-40A' }, { name: 'GFAF-40AB' }, { name: 'GZ-200' }] });
      const upPdf = await call(`/admin/api/files?${new URLSearchParams({ name: 'Industrial Fan - GFan.pdf' })}`, { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: readFileSync(real) });
      assert.equal(upPdf.body.readable, true);
      assert.deepEqual(upPdf.body.matches, ['GFAF-40A']);
      await put({ products: [{ name: 'GFAF-40A' }, { name: 'GFAF-60A' }] });
      const again = await call(`/admin/api/files/${upPdf.body.file.id}/match`, { method: 'POST' });
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
      const on = await call(`/admin/api/files/${pid}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: true }) });
      assert.equal(on.status, 200);
      assert.equal(on.body.files.find((x: { id: string }) => x.id === pid).read, true);
      refreshBiz(true);
      assert.match(knowledgeText(), /ISI PDF "Industrial Fan - GFan\.pdf" — dibaca otomatis/);
      assert.match(knowledgeText(), /GFAF-60A/);
      assert.match(systemPrompt(), /ISI PDF "Industrial Fan - GFan\.pdf"/);
      await call(`/admin/api/files/${pid}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: false }) });
      assert.ok(!knowledgeText().includes('ISI PDF'), 'dimatikan = tidak lagi dibaca');
      // PDF yang tidak terbaca tidak bisa dinyalakan.
      const scan = (await up(Buffer.from('%PDF-1.4 rusak'), 'pindai.pdf')).body.file;
      assert.equal((await call(`/admin/api/files/${scan.id}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: true }) })).status, 400);

      // Tombol bot per pelanggan: hanya nomor dan perintah yang sah yang disimpan.
      const sw = await put({ botSwitch: { '+6281211110001': { mode: 'off', at: 1700000000000 }, 'DROP TABLE': { mode: 'off', at: 1 }, '+6281211110002': { mode: 'entah', at: 2 } } });
      assert.deepEqual(sw.body.profile.botSwitch, { '+6281211110001': { mode: 'off', at: 1700000000000 } });

      // Peringatan dan catatan galat tampil di dashboard.
      const { addAlert, addError } = await import('../store');
      addAlert({ at: Date.now(), kind: 'butuh-staf', key: '+6281211110001', text: 'Bot tidak bisa menjawab: Budi — "bisa custom?"' });
      addError({ at: Date.now(), level: 'galat', text: '[alur] contoh galat' });
      const al = await call('/admin/api/alerts');
      assert.equal(al.body.alerts[0].kind, 'butuh-staf');
      assert.equal(al.body.errors[0].text, '[alur] contoh galat');
      assert.equal((await call('/admin/api/state')).body.alerts.length, 1);
      assert.equal((await call('/admin/api/alerts', {}, false)).status, 401);
      const leads = await call('/admin/api/leads');
      assert.ok('reportedAt' in leads.body);

      // --- Pengaturan: penerima, rute, dan setelan yang menimpa .env ---
      const rec = await put({
        recipients: [
          { name: ' Pak Harry ', role: 'owner', phone: '0811 0000 0001', email: 'owner@contoh.com', telegram: '123456' },
          { name: 'Rina', role: 'apa saja', phone: 'self', email: '', telegram: '' },
          { name: '', role: 'staff', phone: '', email: '', telegram: '' },
        ],
        notifyRoutes: { lead: 'both', llm: 'none', 'bot-mati': 'semua', ngawur: 'owner' },
      });
      assert.equal(rec.status, 200);
      assert.deepEqual(biz.recipients, [
        { name: 'Pak Harry', role: 'owner', phone: '+6281100000001', email: 'owner@contoh.com', telegram: '123456' },
        { name: 'Rina', role: 'staff', phone: 'self', email: '', telegram: '' },
      ]);
      assert.deepEqual(biz.notifyRoutes, { lead: 'both', llm: 'none' });
      assert.match((await put({ recipients: [{ name: 'X', phone: '12' }] })).body.error, /nomor WhatsApp/);
      assert.match((await put({ recipients: [{ name: 'X', email: 'bukan-email' }] })).body.error, /email/);
      assert.match((await put({ recipients: [{ name: 'X', telegram: '@nama' }] })).body.error, /Telegram/);
      assert.match((await put({ recipients: [{ name: 'X' }] })).body.error, /minimal satu jalur/);

      const before = { after: cfg.followupAfterHours, vision: cfg.llmVision, only: [...cfg.onlyNumbers], perDay: cfg.waMaxPerDay };
      const set = await put({ settings: { followupAfterHours: 20, waMaxPerDay: '', llmPriceIn: 0.25, llmVision: false, onlyNumbers: ['0812 1111 0001'], adminPassword: 'x', dbPath: 'y' } });
      assert.equal(set.status, 200);
      assert.deepEqual(biz.settings, { followupAfterHours: 20, llmPriceIn: 0.25, llmVision: false, onlyNumbers: ['+6281211110001'] }, 'hanya setelan yang dikenal; yang kosong tidak disimpan');
      assert.equal(cfg.followupAfterHours, 20, 'langsung berlaku di bot');
      assert.equal(cfg.llmVision, false);
      assert.deepEqual(cfg.onlyNumbers, ['+6281211110001']);
      assert.equal(cfg.waMaxPerDay, before.perDay, 'yang tidak diisi tetap ikut .env');
      assert.equal(cfg.adminPassword, PASSWORD, 'kata sandi tidak bisa diubah dari sini');
      assert.equal((await call('/admin/api/state')).body.status.effective.followupAfterHours, 20);
      assert.match((await put({ settings: { followupAfterHours: 500 } })).body.error, /1–72/);
      assert.match((await put({ settings: { followupStartHour: 20, followupEndHour: 8 } })).body.error, /jam selesai/);
      assert.match((await put({ settings: { onlyNumbers: ['abc'] } })).body.error, /bukan nomor/);
      // Dikosongkan = kembali ke .env.
      assert.equal((await put({ settings: {} })).status, 200);
      assert.deepEqual([cfg.followupAfterHours, cfg.llmVision, cfg.onlyNumbers], [before.after, before.vision, before.only]);
      await put({ recipients: [], notifyRoutes: {} });
    }

    // --- permintaan dari situs lain ditolak ---
    const cross = await call('/admin/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://situs-lain.example' }, body: '{"alias":"X"}' });
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
    assert.ok(typingMs(10_000, 200) <= 10_000 && typingMs(3000, 5000) === 3000);
    biz.replyDelayMin = biz.replyDelayMax = 0;
    assert.equal(pickDelayMs(60_000, null), 0, 'jeda bisa dimatikan');

    console.log('dashboard: OK');
  } catch (e) {
    console.error('dashboard: GAGAL\n', e);
    process.exitCode = 1;
  } finally {
    await stopAdmin();
    rmSync(dir, { recursive: true, force: true });
  }
})();
