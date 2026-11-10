/**
 * Dashboard: masuk, simpan profil (dan bot langsung ikut), foto, uji coba,
 * dan pagar keamanannya. Folder data sementara; tidak menyentuh data asli.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkReply, systemPrompt } from '../brain';
import { biz, initBiz, mediaDir, refreshBiz } from '../business';
import { cfg } from '../config';
import { pickDelayMs, typingMs } from '../pace';
import { openDb } from '../store';
import { setAdminBrain, startAdmin, stopAdmin } from './server';

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
    base = `http://127.0.0.1:${await startAdmin()}`;

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

    // --- simpan profil: bot langsung ikut ---
    assert.ok(checkReply('GFAF-70A tersedia'), 'sebelum ditambah, GFAF-70A dianggap karangan');
    const saved = await put({
      alias: 'Rina',
      replyDelayMin: 5,
      replyDelayMax: 12,
      knowledge: biz.knowledge + '\nGFAF-70A | 28" | 220/380 | 50 | 400 | 9000',
      id: 'diretas',
      evalCases: [],
    });
    assert.equal(saved.status, 200);
    assert.equal(biz.alias, 'Rina');
    assert.equal(biz.id, 'gfan', 'kunci di luar daftar dibuang');
    assert.match(systemPrompt(), /Nama panggilanmu Rina/);
    assert.equal(checkReply('GFAF-70A tersedia'), null, 'pagar kode mengikuti data produk yang baru');
    assert.ok(checkReply('GFAF-99A tersedia'));
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

    // --- foto ---
    const up = (data: Buffer, label = 'GFAF-40A tampak depan') =>
      call(`/admin/api/photos?${new URLSearchParams({ label, tags: 'GFAF-40A' })}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: data });
    assert.equal((await up(Buffer.from('<script>alert(1)</script>'))).status, 400, 'bukan gambar ditolak, apa pun content-type-nya');
    assert.equal((await up(PNG, '')).status, 400);
    const added = await up(PNG);
    assert.equal(added.status, 200);
    const photo = added.body.photos[0];
    assert.match(photo.file, /^f[0-9a-f]{8}\.png$/);
    assert.ok(existsSync(join(mediaDir(), photo.file)));
    assert.match(systemPrompt(), new RegExp(`\\[${photo.id}\\] GFAF-40A tampak depan \\(terkait: GFAF-40A\\)`));
    assert.equal((await call(`/admin/media/${photo.file}`)).status, 200);
    assert.equal((await call(`/admin/media/${photo.file}`, {}, false)).status, 401);
    assert.equal((await call('/admin/media/..%2F..%2Fprofile.json')).status, 404);
    assert.equal((await call('/admin/media/f00000000.png')).status, 404);
    const patched = await call(`/admin/api/photos/${photo.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Exhaust 16 inci', tags: '' }) });
    assert.equal(patched.body.photos[0].label, 'Exhaust 16 inci');

    // --- uji coba: memakai pagar yang sama dengan bot sungguhan ---
    setAdminBrain(async (i) => ({ reply: i.text.includes('harga') ? 'Harganya Rp 500.000' : 'Ini fotonya ya', fields: { name: 'Budi' }, intent: 'info', photos: [photo.id] }));
    const test = (text: string) => call('/admin/api/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const t1 = await test('minta foto');
    assert.equal(t1.body.rejected, null);
    assert.equal(t1.body.photos[0].file, photo.file);
    assert.equal((await test('harga berapa')).body.rejected, 'menyebut harga');

    assert.equal((await call(`/admin/api/photos/${photo.id}`, { method: 'DELETE' })).status, 200);
    assert.ok(!existsSync(join(mediaDir(), photo.file)));
    assert.equal(biz.photos.length, 0);

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
