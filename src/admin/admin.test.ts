/**
 * Dashboard: masuk, proyek, simpan profil (dan bot ikut memuat ulang), foto,
 * uji coba, tombol per chat, WhatsApp, dan pagar keamanannya. Database di
 * memori dan folder data sementara; tidak menyentuh data asli.
 *
 * Tes ini sekaligus memerankan proses bot proyek gfan (proyek bawaan proses):
 * setelah dashboard menyimpan, "bot" memuat ulang seperti sebelum gilirannya.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkReply, systemPrompt } from '../brain';
import { biz, initBiz, knowledgeText, loadProject, mediaDir, refreshBiz } from '../business';
import { cfg } from '../config';
import { closeDb, openDb } from '../db';
import { ensureProject } from '../db/seed';
import { humanHolds } from '../flow';
import { handlePairingRequest, reportState, resetWaNumberCheck, startHeartbeat } from '../heartbeat';
import { pickDelayMs, typingMs } from '../pace';
import { withProject } from '../project';
import { deliverOutbox, MAX_REPLY_ATTEMPTS, setReplySender } from '../sinks/outbox';
import {
  addHandoff, addMessage, addUsage, createContact, getContact, getProfile, getProject, humanSeenAt, pendingReplies, readStatus, recentAlerts,
  recentMessages, saveProfile, updateContact, updateProject,
} from '../store';
import type { Transport, TransportState } from '../transport/types';
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
    const usage = (await call('/api/gfan/usage')).body.usage;
    assert.deepEqual(usage.days[1], { day: '2026-11-10', calls: 3, promptTokens: 10000, cachedTokens: 8000, completionTokens: 400 });
    assert.equal(usage.days[0].day, '2026-11-11');
    assert.equal(usage.price.out, cfg.llmPriceOut);
    assert.equal((await call('/api/gfan/usage', {}, false)).status, 401);
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
    const test = (text: string) => call('/api/gfan/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
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
      assert.match((await make({ id: 'toko-b', name: 'X', template: 'entah' })).body.error, /Bibit/);
      assert.match((await make({ id: 'toko-b', name: '', template: 'generic' })).body.error, /Nama/);
      assert.match((await make({ id: 'toko-b', name: 'Toko B', template: 'generic', wa_number: '12' })).body.error, /WA bot/);
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
      assert.equal(cfg.salesNumber, '+6281299990001', 'bot memakai nomor sales yang baru');
      assert.equal((await call('/api/projects')).body.projects[0].paused, true);
      assert.equal((await pp('gfan', { paused: false, sales_number: '' })).body.project.paused, false);
      assert.equal(cfg.salesNumber, null);
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
      for (const path of ['/gfan', '/gfan/percakapan', '/gfan/percakapan/%2B6281211110001', '/gfan/pengetahuan/identitas', '/gfan/pengetahuan/produk',
        '/gfan/pengetahuan/rekomendasi', '/gfan/pengetahuan/brosur', '/gfan/pengetahuan/lainnya', '/gfan/pengaturan', '/gfan/pengaturan/whatsapp',
        '/gfan/pengaturan/notifikasi', '/gfan/pengaturan/lanjutan', '/gfan/percakapan/']) {
        const r = await page(path, false);
        assert.equal(r.status, 200, path);
        assert.match(r.headers.get('content-type') ?? '', /text\/html/);
        assert.match(await r.text(), /<script src="\/assets\/app\.js"><\/script>/, `${path}: halaman yang sama untuk semua menu`);
      }
      const last = await page('/toko-b/pengaturan');
      assert.match(last.headers.get('set-cookie') ?? '', /^last_project=toko-b; SameSite=Strict; Path=\/; Max-Age=31536000/);
      const r2 = await page('/', false, { cookie: `${cookie}; last_project=toko-b` });
      assert.equal(r2.headers.get('location'), '/toko-b', '"/" kembali ke proyek yang terakhir dibuka');
      const r3 = await page('/', false, { cookie: `${cookie}; last_project=tidak-ada` });
      assert.equal(r3.headers.get('location'), '/gfan');
      const kn = await page('/gfan/pengetahuan');
      assert.deepEqual([kn.status, kn.headers.get('location')], [302, '/gfan/pengetahuan/identitas']);
      for (const path of ['/gfan/entah', '/gfan/pengetahuan/entah', '/gfan/percakapan/bukan-nomor', '/tidak-ada', '/tidak-ada/percakapan', '/assets', '/api']) {
        assert.equal((await page(path)).status, 404, path);
      }
      for (const path of ['/admin', '/admin/', '/admin/gfan/api/state']) {
        const r = await page(path);
        assert.deepEqual([r.status, r.headers.get('location')], [301, '/'], `alamat lama ${path}`);
      }
      const li = await page('/login');
      assert.deepEqual([li.status, li.headers.get('location')], [302, '/'], 'sudah masuk: tidak perlu halaman masuk');
      assert.equal((await page('/login?next=%2Fgfan%2Fpengaturan')).headers.get('location'), '/gfan/pengaturan');
      assert.equal((await page('/login?next=%2F%2Fsitus-lain.example')).headers.get('location'), '/', 'hanya alamat di situs ini');
      for (const [path, type] of [['/assets/app.js', /javascript/], ['/assets/app.css', /text\/css/], ['/assets/qrcode.js', /javascript/]] as const) {
        const r = await page(path, false);
        assert.equal(r.status, 200, path);
        assert.match(r.headers.get('content-type') ?? '', type);
        assert.equal(r.headers.get('cache-control'), 'no-cache');
      }
      // Teks dashboard tanpa tanda pisah panjang (em dash): pakai koma, titik dua, atau titik.
      for (const name of ['page.html', 'app.js', 'app.css']) {
        const text = readFileSync(join(__dirname, name), 'utf8');
        const at = text.indexOf('\u2014');
        assert.equal(at, -1, `${name} masih memuat tanda pisah panjang: "${text.slice(Math.max(0, at - 40), at + 40)}"`);
      }
      for (const id of ['login', 'assets', 'health', 'webhook', 'admin', 'logout']) {
        assert.equal((await post('/api/projects', { id, name: 'X', template: 'generic' })).status, 400, `id "${id}" dipakai alamat dashboard`);
      }
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
      assert.equal((await putLead({})).status, 400);
      assert.match((await putLead({ note: 'x'.repeat(2001) })).body.error, /terlalu panjang/);
      const st = await putLead({ stage: 'closing', note: '  minta penawaran Senin  ' });
      assert.deepEqual([st.status, st.body.stage, st.body.note], [200, 'closing', 'minta penawaran Senin']);
      assert.deepEqual([(await getContact(P))?.stage, (await getContact(P))?.note], ['closing', 'minta penawaran Senin']);
      const row = (await call('/api/gfan/leads')).body.rows.find((r: { phone: string }) => r.phone === P);
      assert.deepEqual([row.stage, row.note], ['closing', 'minta penawaran Senin'], 'tahap dan catatan tampil di daftar');
      assert.equal((await putLead({ note: '' })).body.note, null, 'catatan bisa dikosongkan');
      await putLead({ stage: 'baru' });

      // Balas dari web: masuk antrean bot dan bot mundur, sama seperti membalas dari HP.
      assert.match((await reply('   ')).body.error, /kosong/);
      assert.match((await reply('x'.repeat(4001))).body.error, /terlalu panjang/);
      assert.equal((await post(`/api/gfan/leads/${encodeURIComponent('+6281299998888')}/reply`, { text: 'halo' })).status, 404);
      assert.match((await post(`/api/gfan/leads/${encodeURIComponent('+6281700000009')}/reply`, { text: 'halo' })).body.error, /belum pernah chat/, 'pelanggan lama yang belum pernah chat');
      const sentAt = Date.now();
      const r = await reply('  Halo Pak, saya Rina dari GFAN.\r\nAda yang bisa dibantu?  ');
      assert.equal(r.status, 200);
      assert.deepEqual([r.body.message.dir, r.body.message.text, r.body.message.kind, r.body.stage], ['human', 'Halo Pak, saya Rina dari GFAN.\nAda yang bisa dibantu?', 'dashboard', 'dihubungi']);
      const c = await getContact(P);
      assert.deepEqual([c?.last_dir, c?.followup_state, c?.stage], ['human', 'idle', 'dihubungi'], 'tahap "baru" pindah ke "dihubungi"');
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
      await deliverOutbox('reply');
      assert.deepEqual(out, [`${c?.address}: Halo Pak, saya Rina dari GFAN.\nAda yang bisa dibantu?`]);
      assert.deepEqual((await lead()).body.pending_replies, []);
      // Yang terus gagal: tampil "gagal" di percakapan dan jadi warning.
      setReplySender(async () => { throw new Error('tidak tersambung'); });
      await reply('yang ini gagal');
      for (let i = 0; i < MAX_REPLY_ATTEMPTS; i++) await deliverOutbox('reply');
      assert.equal((await lead()).body.pending_replies[0].failed, true);
      assert.ok((await recentAlerts(20)).some((a) => a.kind === 'kiriman-gagal'));
      setReplySender(null);
      // Balasan manusia tidak memindahkan tahap selain "baru".
      await putLead({ stage: 'batal' });
      await reply('terima kasih');
      assert.equal((await getContact(P))?.stage, 'batal');
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
        await updateContact(B, { needs_sales: 1, stage: 'closing' });
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
      assert.deepEqual(m.stages, { baru: 1, dihubungi: 0, closing: 1, batal: 0 });
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
    // Lama mengetik mengikuti panjang pesan, dijepit 1,5–40 detik (lihat pace.test.ts).
    assert.equal(typingMs(60, 4), 15_000);
    assert.ok(typingMs(40, 4) < typingMs(80, 4));
    assert.ok(typingMs(3) === 1500 && typingMs(5000) === 40_000);
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
