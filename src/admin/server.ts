/**
 * Dashboard pemilik: mengubah cara bot menjawab tanpa menyentuh kode.
 *
 * "Melatih ulang" di sini berarti menyimpan profil — bot ini tidak punya model
 * yang dilatih; perilakunya ditentukan data profil, dan perubahan berlaku pada
 * pesan berikutnya.
 *
 * Penanganannya (`createAdminHandler`) tidak tahu di mana ia jalan: server
 * lokal di samping bot, atau fungsi di Vercel. Bedanya hanya di AdminStore.
 *
 * Yang dijaga, karena halaman ini bisa mengubah apa yang dikatakan bot ke
 * semua pelanggan:
 *   - Mati kecuali ADMIN_PASSWORD diisi.
 *   - Sesi lewat cookie HttpOnly + SameSite=Strict yang ditandatangani.
 *   - Percobaan masuk yang salah dibatasi.
 *   - Unggahan: hanya JPEG/PNG/WebP, dicek dari isi berkasnya, nama berkas
 *     dibuat sendiri (tidak pernah memakai nama dari pengunggah).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { checkReply, llmBrain, type Brain } from '../brain';
import { biz, editableView, validate } from '../business';
import type { Photo } from '../business/types';
import { cfg } from '../config';
import { llmEnabled } from '../llm/provider';
import type { AdminStore } from './stores';

const SESSION_MS = 12 * 3_600_000;
/** Di bawah batas badan permintaan fungsi Vercel (4,5 MB). */
const MAX_PHOTO_BYTES = 4_000_000;
const MAX_PHOTOS = 60;
const COOKIE = 'admin_session';

let brain: Brain = llmBrain;
/** Tes: ganti otak yang dipakai tombol "Uji". */
export function setAdminBrain(fn: Brain): void {
  brain = fn;
}

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();
const sessionKey = (): Buffer => sha(`admin-session:${cfg.adminPassword}`);

function sign(expires: number): string {
  return `${expires}.${createHmac('sha256', sessionKey()).update(String(expires)).digest('base64url')}`;
}

function authed(req: IncomingMessage): boolean {
  const raw = (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  const token = raw?.slice(COOKIE.length + 1) ?? '';
  const [exp, mac] = token.split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(Number(exp)));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Pembatas percobaan masuk: 5 kali salah -> terkunci, makin lama tiap kali.
// (Di Vercel hitungannya per instance fungsi, jadi kata sandi yang kuat tetap
// pertahanan utamanya.)
let fails = 0;
let lockedUntil = 0;

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  // Vercel sudah membaca badan permintaan sebelum memanggil kita.
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) {
    const buf = Buffer.isBuffer(pre) ? pre : Buffer.from(typeof pre === 'string' ? pre : JSON.stringify(pre));
    return buf.length > limit ? Promise.reject(new Error('terlalu besar')) : Promise.resolve(buf);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('terlalu besar'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function imageExt(b: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

/** Berkas halaman: di samping file ini (lokal) atau di akar proyek (Vercel). */
function asset(name: string): Buffer {
  const here = join(__dirname, name);
  return readFileSync(existsSync(here) ? here : join(process.cwd(), 'src', 'admin', name));
}

const label = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function createAdminHandler(store: AdminStore) {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-robots-tag', 'noindex, nofollow');
    res.setHeader('cache-control', 'no-store');

    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const page = (name: string, ext: string) => {
      res.writeHead(200, {
        'content-type': TYPES[ext] as string,
        'content-security-policy':
          "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src https://fonts.gstatic.com; img-src 'self' blob: data:; frame-ancestors 'none'",
      });
      res.end(asset(name));
    };

    if (path === '/') {
      res.writeHead(302, { location: '/admin' });
      return void res.end();
    }
    if (path === '/admin') return page('page.html', 'html');
    if (path === '/admin/app.js') return page('app.js', 'js');

    if (!cfg.adminPassword || cfg.adminPassword.length < 8) {
      return json(503, { error: 'Dashboard belum diatur: ADMIN_PASSWORD kosong atau kurang dari 8 karakter.' });
    }

    // Permintaan yang mengubah sesuatu harus datang dari halaman ini sendiri.
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(403, { error: 'asal tidak dikenal' });
    }

    if (path === '/admin/api/login' && method === 'POST') {
      if (Date.now() < lockedUntil) {
        return json(429, { error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((lockedUntil - Date.now()) / 1000)} detik.` });
      }
      const body = JSON.parse((await readBody(req, 2000)).toString('utf8') || '{}') as { password?: string };
      const ok = timingSafeEqual(sha(String(body.password ?? '')), sha(cfg.adminPassword));
      if (!ok) {
        fails += 1;
        if (fails >= 5) lockedUntil = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (fails - 5));
        return json(401, { error: 'Kata sandi salah.' });
      }
      fails = 0;
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.setHeader(
        'set-cookie',
        `${COOKIE}=${sign(Date.now() + SESSION_MS)}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${SESSION_MS / 1000}${secure}`
      );
      return json(200, { ok: true });
    }

    if (!authed(req)) return json(401, { error: 'Belum masuk.' });

    if (path === '/admin/api/logout' && method === 'POST') {
      res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`);
      return json(200, { ok: true });
    }

    await store.refresh();

    if (path === '/admin/api/state' && method === 'GET') {
      return json(200, {
        profile: editableView(),
        business: biz.id,
        testReady: llmEnabled() || brain !== llmBrain,
        status: await store.status(),
      });
    }

    if (path === '/admin/api/profile' && method === 'PUT') {
      const body = JSON.parse((await readBody(req, 400_000)).toString('utf8')) as Record<string, unknown>;
      let changes;
      try {
        changes = validate(body);
      } catch (e) {
        return json(400, { error: e instanceof Error ? e.message : 'Masukan tidak sah.' });
      }
      await store.save(changes);
      console.log(`[dashboard] profil disimpan: ${Object.keys(changes).join(', ')}`);
      return json(200, { ok: true, profile: editableView() });
    }

    if (path === '/admin/api/leads' && method === 'GET') {
      return json(200, { fields: biz.leadFields.map((f) => ({ key: f.key, label: f.label })), rows: await store.leads() });
    }

    if (path === '/admin/api/usage' && method === 'GET') {
      return json(200, { usage: await store.usage() });
    }

    if (path === '/admin/api/test' && method === 'POST') {
      const body = JSON.parse((await readBody(req, 20_000)).toString('utf8')) as {
        text?: string;
        history?: { dir: 'in' | 'out'; text: string }[];
        known?: Record<string, string>;
      };
      const text = label(body.text, 800);
      if (!text) return json(400, { error: 'Pesan kosong.' });
      if (!llmEnabled() && brain === llmBrain) return json(400, { error: 'LLM belum diatur (LLM_API_KEY kosong).' });
      const history = (body.history ?? []).slice(-10).map((h) => ({ dir: h.dir === 'out' ? ('out' as const) : ('in' as const), text: label(h.text, 1500) }));
      const result = await brain({ text, known: body.known ?? {}, history, justGreeted: false });
      if (!result) return json(502, { error: 'LLM tidak menjawab. Coba lagi.' });
      const asked = [text, ...history.filter((h) => h.dir === 'in').map((h) => h.text)].join('\n');
      return json(200, {
        ...result,
        photos: result.photos.map((id) => biz.photos.find((p) => p.id === id)).filter(Boolean),
        rejected: checkReply(result.reply, asked),
      });
    }

    if (path === '/admin/api/photos' && method === 'POST') {
      if (biz.photos.length >= MAX_PHOTOS) return json(400, { error: `Maksimal ${MAX_PHOTOS} foto.` });
      let data: Buffer;
      try {
        data = await readBody(req, MAX_PHOTO_BYTES);
      } catch {
        return json(413, { error: 'Foto terlalu besar (maksimal 4 MB).' });
      }
      const ext = imageExt(data);
      if (!ext) return json(400, { error: 'Hanya JPG, PNG, atau WebP.' });
      const text = label(url.searchParams.get('label'), 120);
      if (!text) return json(400, { error: 'Isi keterangan fotonya dulu.' });
      const id = `f${randomBytes(4).toString('hex')}`;
      const photo: Photo = { id, file: `${id}.${ext}`, label: text, tags: label(url.searchParams.get('tags'), 160) };
      await store.putPhoto(photo.file, data, TYPES[ext] as string);
      await store.save({ photos: [...biz.photos, photo] });
      console.log(`[dashboard] foto ditambah: ${photo.label}`);
      return json(200, { ok: true, photos: biz.photos });
    }

    const one = path.match(/^\/admin\/api\/photos\/(f[0-9a-f]{8})$/);
    if (one) {
      const photo = biz.photos.find((p) => p.id === one[1]);
      if (!photo) return json(404, { error: 'Foto tidak ditemukan.' });
      if (method === 'PATCH') {
        const body = JSON.parse((await readBody(req, 2000)).toString('utf8')) as { label?: string; tags?: string };
        const text = label(body.label, 120);
        if (!text) return json(400, { error: 'Keterangan tidak boleh kosong.' });
        await store.save({ photos: biz.photos.map((p) => (p.id === photo.id ? { ...p, label: text, tags: label(body.tags, 160) } : p)) });
        return json(200, { ok: true, photos: biz.photos });
      }
      if (method === 'DELETE') {
        await store.save({ photos: biz.photos.filter((p) => p.id !== photo.id) });
        await store.delPhoto(photo.file).catch(() => {});
        return json(200, { ok: true, photos: biz.photos });
      }
    }

    // Berkas foto: hanya yang terdaftar di profil, jadi tidak ada jalan keluar folder.
    const media = path.match(/^\/admin\/media\/(f[0-9a-f]{8}\.(jpg|png|webp))$/);
    if (media && method === 'GET') {
      const photo = biz.photos.find((p) => p.file === media[1]);
      const data = photo ? await store.getPhoto(photo.file) : null;
      if (!data) return json(404, { error: 'Tidak ada.' });
      // Nama berkas unik per foto, jadi aman disimpan peramban (tidak di perantara).
      res.writeHead(200, { 'content-type': TYPES[media[2] as string] as string, 'cache-control': 'private, max-age=86400' });
      return void res.end(data);
    }

    json(404, { error: 'Tidak ada.' });
  }

  return (req: IncomingMessage, res: ServerResponse): Promise<void> =>
    handle(req, res).catch((e) => {
      console.error('[dashboard]', e instanceof Error ? e.message : e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ada gangguan. Coba lagi.' }));
    });
}

// ---------------------------------------------------------------------------
// Server lokal (di samping bot, atau `npm run admin`)
// ---------------------------------------------------------------------------

let server: Server | null = null;

export function adminPort(): number | null {
  const a = server?.address();
  return a && typeof a === 'object' ? (a as AddressInfo).port : null;
}

export async function startAdmin(store: AdminStore): Promise<number> {
  if (!cfg.adminPassword) throw new Error('ADMIN_PASSWORD belum diisi');
  if (cfg.adminPassword.length < 8) throw new Error('ADMIN_PASSWORD minimal 8 karakter');

  const handler = createAdminHandler(store);
  const s = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject);
    s.listen(cfg.adminPort, cfg.adminHost, () => resolve());
  });
  server = s;
  const port = adminPort() as number;
  console.log(`[dashboard] http://${cfg.adminHost === '0.0.0.0' ? 'localhost' : cfg.adminHost}:${port}/admin`);
  if (cfg.adminHost !== '127.0.0.1' && cfg.adminHost !== 'localhost') {
    console.log('[dashboard] PERINGATAN: terbuka ke jaringan. Taruh di belakang HTTPS.');
  }
  return port;
}

export async function stopAdmin(): Promise<void> {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
}
