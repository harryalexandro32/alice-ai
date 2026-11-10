/**
 * Dashboard online + bot di tempat lain, lewat penyimpanan bersama tiruan:
 * yang disimpan di dashboard sampai ke bot, dan lead bot sampai ke dashboard.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { systemPrompt } from '../brain';
import { applyOverrides, biz, initBiz, mediaDir } from '../business';
import { cfg } from '../config';
import { setBlobApi } from '../remote';
import { addMessage, addUsage, createContact, openDb, updateContact } from '../store';
import { pullProfile, pushSnapshot, resetSync } from '../sync';
import { createAdminHandler } from './server';
import { blobStore } from './stores';

const PASSWORD = 'kata-sandi-uji-123';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-remote-'));
  cfg.dataRoot = dir;
  cfg.adminPassword = PASSWORD;
  openDb(':memory:');
  initBiz();

  // Penyimpanan bersama tiruan.
  const files = new Map<string, Buffer>();
  let reads = 0;
  let down = false;
  setBlobApi({
    async getBytes(path) {
      reads += 1;
      if (down) throw new Error('penyimpanan tidak terjangkau');
      return files.get(path) ?? null;
    },
    async put(path, data) {
      files.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data));
    },
    async del(path) {
      files.delete(path);
    },
  });

  // Dashboard "di Vercel": penangan yang sama, penyimpanan blob.
  const handler = createAdminHandler(blobStore());
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
  };
  const jsonInit = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  try {
    const login = await call('/admin/api/login', jsonInit('POST', { password: PASSWORD }));
    cookie = (login.res.headers.get('set-cookie') ?? '').split(';')[0] as string;

    // Sebelum bot pernah melapor.
    const first = await call('/admin/api/state');
    assert.equal(first.body.status, null);
    assert.equal(first.body.profile.alias, '');

    // --- pemilik menyimpan di dashboard online ---
    assert.equal((await call('/admin/api/profile', jsonInit('PUT', { alias: 'Alice', honorific: 'Kak' }))).status, 200);
    const up = await call(`/admin/api/files?${new URLSearchParams({ name: 'depan.png' })}`, {
      method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG,
    });
    assert.equal(up.status, 200);
    const photo = up.body.file;
    const product = { name: 'GFAF-40A', description: '', price: '', stock: '', photos: [photo.id], pdf: '' };
    assert.equal((await call('/admin/api/profile', jsonInit('PUT', { products: [product] }))).status, 200);
    assert.deepEqual([...files.keys()].sort(), [`gfan/media/${photo.file}`, 'gfan/profile.json']);
    assert.equal(JSON.parse(files.get('gfan/profile.json')!.toString()).alias, 'Alice');
    assert.equal((await fetch(`${base}/admin/media/${photo.file}`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${base}/admin/media/${photo.file}`)).status, 401);

    // Fungsi lain (instance baru) melihat hal yang sama.
    applyOverrides({});
    assert.equal((await call('/admin/api/state')).body.profile.alias, 'Alice');

    // --- bot menarik: profil dipakai, foto ada di disk lokal ---
    applyOverrides({});
    assert.equal(biz.alias, '');
    resetSync();
    await pullProfile(true);
    assert.equal(biz.alias, 'Alice');
    assert.equal(biz.honorific, 'Kak');
    assert.match(systemPrompt(), /Nama panggilanmu Alice/);
    assert.ok(existsSync(join(mediaDir(), photo.file)), 'foto terunduh sebelum profilnya dipakai');
    assert.equal(JSON.parse(readFileSync(join(dir, 'gfan', 'profile.json'), 'utf8')).alias, 'Alice');

    // Tidak menarik lebih sering dari jedanya, seramai apa pun chat.
    const before = reads;
    await pullProfile();
    await pullProfile();
    assert.equal(reads, before, 'dalam 5 detik tidak ada pembacaan baru');

    // Penyimpanan mati: bot tetap jalan dengan salinan terakhir.
    down = true;
    resetSync();
    await pullProfile(true);
    assert.equal(biz.alias, 'Alice');
    down = false;

    // Perubahan berikutnya ikut pada tarikan berikutnya.
    await call('/admin/api/profile', jsonInit('PUT', { alias: 'Rina' }));
    resetSync();
    await pullProfile(true);
    assert.equal(biz.alias, 'Rina');

    // --- bot melapor: lead + status muncul di dashboard online ---
    createContact('+6281211110001', '6281211110001', Date.now());
    addMessage('+6281211110001', 'in', 'halo', Date.now());
    updateContact('+6281211110001', { lead: { name: 'Budi', city: 'Bekasi' } });
    assert.equal((await call('/admin/api/usage')).body.usage, null, 'sebelum bot melapor belum ada pemakaian');
    addUsage({ day: '2026-11-11', calls: 4, promptTokens: 8000, cachedTokens: 6000, completionTokens: 400 });
    assert.equal(await pushSnapshot(true), true);
    assert.equal((await call('/admin/api/usage')).body.usage.days[0].calls, 4);
    assert.equal(await pushSnapshot(), false, 'tanpa perubahan tidak menulis lagi');
    const leads = await call('/admin/api/leads');
    assert.equal(leads.body.rows[0].lead.name, 'Budi');
    const st = (await call('/admin/api/state')).body.status;
    assert.equal(st.transport, 'baileys');
    assert.ok(Date.now() - st.reportedAt < 5000);

    // Foto dilepas dari produk: hilang dari penyimpanan bersama juga.
    await call('/admin/api/profile', jsonInit('PUT', { products: [{ ...product, photos: [] }] }));
    assert.ok(!files.has(`gfan/media/${photo.file}`));

    console.log('dashboard online + sinkron bot: OK');
  } catch (e) {
    console.error('dashboard online + sinkron bot: GAGAL\n', e);
    process.exitCode = 1;
  } finally {
    setBlobApi(null);
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
})();
