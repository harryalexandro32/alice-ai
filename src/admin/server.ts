/**
 * Dashboard pemilik: mengubah cara bot menjawab tanpa menyentuh kode.
 *
 * "Melatih ulang" di sini berarti menyimpan profil — bot ini tidak punya model
 * yang dilatih; perilakunya ditentukan data profil, dan perubahan berlaku pada
 * pesan berikutnya.
 *
 * Satu dashboard untuk semua proyek (satu proyek = satu bisnis = satu nomor
 * WhatsApp). Tiap menu punya alamatnya sendiri dengan id proyek di depan:
 * /gfan, /gfan/conversations, /gfan/knowledge/products, /gfan/settings/whatsapp,
 * … (daftarnya di routes.ts; alamat lama berbahasa Indonesia dialihkan 301);
 * semuanya page.html, dan router di app.js membaca alamatnya. Data lewat
 * /api/<proyek>/…: tiap permintaan dijalankan di dalam proyeknya
 * (withProject), jadi `biz`, `cfg`, dan penyimpanan otomatis memakai proyek
 * itu. Dashboard berjalan di proses sendiri; keadaan bot (WhatsApp, QR, kode
 * pairing) dibaca dari laporan berkalanya di database.
 *
 * Yang dijaga, karena halaman ini bisa mengubah apa yang dikatakan bot ke
 * semua pelanggan:
 *   - Mati kecuali ADMIN_PASSWORD diisi.
 *   - Sesi lewat cookie HttpOnly + SameSite=Strict yang ditandatangani.
 *   - Percobaan masuk yang salah dibatasi.
 *   - Unggahan: hanya JPEG/PNG/WebP/PDF, dicek dari isi berkasnya, nama berkas
 *     dibuat sendiri (tidak pernah memakai nama dari pengunggah).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { checkReply, llmBrain, type Brain } from '../brain';
import { biz, editableView, fileById, loadProject, referencedFiles, setPdfText, TEMPLATES, validate } from '../business';
import { buyMessage, isPdf } from '../business/catalog';
import type { MediaFile } from '../business/types';
import { cfg, normPhone, parseSalesNumber } from '../config';
import { ensureProject } from '../db/seed';
import { localDay } from '../clock';
import { applyHumanReply, holdReason, markHandled, switchBot } from '../flow';
import { llmEnabled } from '../llm/provider';
import { currentProject, withProject } from '../project';
import { MAX_REPLY_ATTEMPTS, type ReplyPayload } from '../sinks/outbox';
import {
  countImported, getContact, getHandoff, getProject, importContact, listHandoffs, listProjects, messagePage, metrics, normQuestion,
  outboxAdd, pendingReplies, readAllStatus, readStatus, resolveHandoffs, setPairingRequest, setStageNote, STAGES, updateProject,
  type HandoffRow, type Project, type ProjectPatch, type Stage,
} from '../store';
import { matchProducts, pdfPlain, squash } from './pdftext';
import { renamedPath, ROUTES } from './routes';
import type { AdminStore, UsageReport } from './stores';

const SESSION_MS = 12 * 3_600_000;
/** Di bawah batas badan permintaan fungsi Vercel (4,5 MB). */
const MAX_FILE_BYTES = 4_000_000;
const MAX_FILES = 400;
const COOKIE = 'admin_session';
/** Proyek yang terakhir dibuka; "/" kembali ke sana. */
const LAST_PROJECT = 'last_project';

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

function cookieOf(req: IncomingMessage, name: string): string {
  const raw = (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return raw?.slice(name.length + 1) ?? '';
}

function authed(req: IncomingMessage): boolean {
  const token = cookieOf(req, COOKIE);
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

function fileExt(b: Buffer): 'jpg' | 'png' | 'webp' | 'pdf' | null {
  if (b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
  svg: 'image/svg+xml', ico: 'image/x-icon',
};

/** Berkas halaman: di samping file ini (lokal) atau di akar proyek (Vercel). */
function asset(name: string): Buffer {
  const here = join(__dirname, name);
  return readFileSync(existsSync(here) ? here : join(process.cwd(), 'src', 'admin', name));
}

const label = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Berkas halaman yang dilayani apa adanya: alamat -> [nama berkas, jenis]. */
const ASSETS: Record<string, [string, string]> = {
  '/assets/app.js': ['app.js', 'js'],
  '/assets/app.css': ['app.css', 'css'],
  '/assets/qrcode.js': ['qrcode.js', 'js'],
};

/**
 * Berkas merek (ikon tab, ikon layar utama, wordmark, ikon marketplace) dari folder brand/: alamat -> [nama berkas, jenis].
 * Jarang berganti, jadi peramban boleh menyimpannya sehari tanpa bertanya.
 */
const BRAND: Record<string, [string, string]> = {
  '/favicon.ico': ['brand/favicon.ico', 'ico'],
  '/assets/favicon.svg': ['brand/favicon.svg', 'svg'],
  '/assets/favicon-32.png': ['brand/favicon-32.png', 'png'],
  '/assets/favicon-192.png': ['brand/favicon-192.png', 'png'],
  '/assets/apple-touch-icon.png': ['brand/apple-touch-icon.png', 'png'],
  '/assets/wordmark.svg': ['brand/wordmark.svg', 'svg'],
  '/assets/wordmark.png': ['brand/wordmark.png', 'png'],
  '/assets/tokopedia.png': ['brand/tokopedia.png', 'png'],
  '/assets/shopee.svg': ['brand/shopee.svg', 'svg'],
};

/**
 * Id proyek: huruf kecil, angka, tanda minus. Kata-kata ini dipakai alamat
 * dashboard (atau dialihkan Caddy ke bot) dan tidak pernah sah sebagai id.
 */
const PROJECT_ID = /^[a-z0-9-]{2,32}$/;
export const RESERVED = new Set([
  'api', 'login', 'logout', 'assets', 'admin', 'health', 'webhook', 'robots.txt', 'favicon.ico',
  // Nama bagian halaman, yang baru dan yang lama: tidak boleh tertukar dengan id proyek.
  'conversations', 'knowledge', 'settings', 'percakapan', 'pengetahuan', 'pengaturan',
]);
/** Nomor pelanggan di alamat: "+62…" atau "lid:…". */
const CONTACT = /^(\+\d{8,15}|lid:\d{5,20})$/;

/** Halaman di bawah /<proyek>/ (tanpa garis miring di depan); percakapan per nomor diperiksa terpisah. */
const PAGE_PATHS = new Set(Object.values(ROUTES));

function validContactPath(rest: string): boolean {
  const m = rest.match(/^conversations\/([^/]+)$/);
  if (!m) return false;
  try {
    return CONTACT.test(decodeURIComponent(m[1] as string));
  } catch {
    return false;
  }
}

/** Tujuan setelah masuk: hanya alamat di situs ini sendiri. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

/** Baris proyek yang boleh dilihat dashboard (tanpa permintaan internal untuk bot). */
const projectView = (p: Project) => ({
  id: p.id, name: p.name, template: p.template, enabled: p.enabled, paused: p.paused, transport: p.transport,
  wa_number: p.wa_number, sales_number: p.sales_number,
});

/** Periksa perubahan baris proyek dari dashboard. */
function projectPatch(body: Record<string, unknown>): ProjectPatch {
  const out: ProjectPatch = {};
  if ('name' in body) {
    const name = label(body.name, 80);
    if (!name) throw new Error('Nama proyek tidak boleh kosong');
    out.name = name;
  }
  if ('wa_number' in body) {
    const raw = String(body.wa_number ?? '').trim();
    const n = raw ? normPhone(raw) : null;
    if (raw && !n) throw new Error(`Nomor WA bot "${raw}" tidak sah`);
    out.wa_number = n;
  }
  if ('sales_number' in body) {
    const raw = String(body.sales_number ?? '').trim();
    const n = parseSalesNumber(raw);
    if (raw && !n) throw new Error(`Nomor sales "${raw}" tidak sah (isi nomor, atau "self" untuk nomor bot sendiri)`);
    out.sales_number = n;
  }
  if ('transport' in body) {
    if (body.transport !== 'baileys' && body.transport !== 'cloud') throw new Error('Jalur WhatsApp: baileys atau cloud');
    out.transport = body.transport;
  }
  if ('enabled' in body) out.enabled = Boolean(body.enabled);
  if ('paused' in body) out.paused = Boolean(body.paused);
  return out;
}

/** Balasan dari dashboard paling panjang sekian karakter. */
const MAX_REPLY = 4000;
const DAY = 86_400_000;
const METRIC_DAYS = 7;
const MAX_METRIC_DAYS = 90;

/** Perkiraan biaya LLM bulan ini (bulan menurut zona waktu bot), dalam USD dan Rupiah. */
function monthCost(u: UsageReport | null): { usd: number; idr: number } {
  if (!u) return { usd: 0, idr: 0 };
  const month = localDay(Date.now()).slice(0, 7);
  const usd = u.days
    .filter((d) => d.day.startsWith(month))
    .reduce((a, d) => a + ((d.promptTokens - d.cachedTokens) * u.price.in + d.cachedTokens * u.price.cached + d.completionTokens * u.price.out) / 1e6, 0);
  return { usd, idr: Math.round(usd * u.usdIdr) };
}

/** Kelompokkan pertanyaan yang sama (setelah dinormalkan); baris masuk terbaru dulu. */
function groupHandoffs(rows: HandoffRow[]) {
  const groups = new Map<string, { id: number; question: string; count: number; last_at: number; phone: string; phones: Set<string>; answer: string | null; resolution: string | null; resolved_at: number | null }>();
  for (const r of rows) {
    const key = normQuestion(r.question);
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.phones.add(r.phone);
    } else {
      groups.set(key, {
        id: r.id, question: r.question, count: 1, last_at: r.at, phone: r.phone, phones: new Set([r.phone]),
        answer: r.answer, resolution: r.resolution, resolved_at: r.resolved_at,
      });
    }
  }
  return [...groups.values()].map(({ phones, ...g }) => ({ ...g, people: phones.size }));
}

export function createAdminHandler(store: AdminStore) {
  /**
   * Teks sebuah PDF. Dibaca sekali lalu disimpan di samping PDF-nya sebagai
   * <id>.txt, supaya mencocokkan produk baru dan "bot membaca PDF" tidak perlu
   * membuka PDF-nya berulang-ulang (dan supaya bot bisa menarik teksnya).
   */
  async function textOfPdf(f: MediaFile, fresh?: Buffer): Promise<string> {
    const name = `${f.id}.txt`;
    if (!fresh) {
      const cached = await store.getPhoto(name);
      if (cached) return cached.toString('utf8');
    }
    const data = fresh ?? (await store.getPhoto(f.file));
    const text = data ? (await pdfPlain(data)).slice(0, 200_000) : '';
    if (text) await store.putPhoto(name, Buffer.from(text, 'utf8'), 'text/plain; charset=utf-8');
    return text;
  }
  const namesIn = async (f: MediaFile, names: string[], fresh?: Buffer) => {
    const text = squash(await textOfPdf(f, fresh));
    return { readable: Boolean(text), matches: matchProducts(text, names) };
  };

  /** Satu pelanggan untuk halaman percakapan: data, riwayat pesan (per halaman), balasan yang belum terkirim. */
  async function leadDetail(phone: string, url: URL, json: (code: number, body: unknown) => void): Promise<void> {
    const c = await getContact(phone);
    if (!c) return json(404, { error: 'Kontak tidak ditemukan.' });
    const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('limit'))) || 100));
    const before = Math.floor(Number(url.searchParams.get('before')));
    const [messages, pending] = await Promise.all([messagePage(phone, limit, before > 0 ? before : undefined), pendingReplies(phone)]);
    const hold = c.opted_out_at ? 'berhenti' : c.pending_off ? 'tombol' : c.address ? await holdReason(c.address, Date.now()) : null;
    return json(200, {
      contact: {
        phone: c.phone, waName: c.wa_name, lead: c.lead, needsSales: Boolean(c.needs_sales), complete: Boolean(c.lead_sent_at),
        lastAt: c.last_inbound_at, lastDir: c.last_dir, summary: c.summary ?? '', hold, stage: c.stage, note: c.note ?? '',
        imported: Boolean(c.imported), handledAt: c.handled_at, canReply: Boolean(c.address),
      },
      fields: biz.leadFields.map((f) => ({ key: f.key, label: f.label })),
      messages,
      more: messages.length === limit,
      // Balasan dari dashboard yang belum terkirim; yang hilang dari sini sudah terkirim.
      pending_replies: pending.map((r) => {
        const p = r.payload as ReplyPayload;
        return { id: r.id, message_id: p.message_id ?? null, text: p.text, at: r.created_at, attempts: r.attempts, failed: r.attempts >= MAX_REPLY_ATTEMPTS };
      }),
    });
  }

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
    const file = (name: string, ext: string, code = 200, headers: Record<string, string> = {}) => {
      res.writeHead(code, {
        'content-type': TYPES[ext] as string,
        // Berkas halaman berganti tiap deploy: peramban boleh menyimpan, tapi harus bertanya dulu.
        ...(ext === 'html' ? {} : { 'cache-control': 'no-cache' }),
        'content-security-policy':
          "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src https://fonts.gstatic.com; img-src 'self' blob: data:; frame-ancestors 'none'",
        ...headers,
      });
      res.end(asset(name));
    };
    const redirect = (code: 301 | 302, location: string) => {
      res.writeHead(code, { location });
      res.end();
    };
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';

    // --- berkas halaman ---
    if (method === 'GET' && ASSETS[path]) return file(...(ASSETS[path] as [string, string]));
    if (method === 'GET' && BRAND[path]) {
      const [name, ext] = BRAND[path] as [string, string];
      return file(name, ext, 200, { 'cache-control': 'public, max-age=86400' });
    }

    // Alamat lama (/admin, /admin/#gfan, /admin/gfan/api/…) -> beranda baru.
    if (path === '/admin' || path.startsWith('/admin/')) return redirect(301, '/');

    if (path.startsWith('/api/')) return handleApi(req, res, path, url, method, json, secure);

    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'Tidak ada.' });

    // --- halaman: semuanya page.html; alamatnya dibaca router di app.js ---
    if (path === '/') {
      // Tanpa sesi: ke halaman masuk (daftar proyek tidak dibuka ke orang yang belum masuk).
      if (!authed(req)) return redirect(302, '/login');
      const last = cookieOf(req, LAST_PROJECT);
      const rows = await listProjects();
      const target = rows.find((p) => p.id === last) ?? rows.find((p) => p.enabled) ?? rows[0];
      return redirect(302, target ? `/${target.id}` : '/login');
    }
    if (path === '/login') {
      // Sudah masuk tapi belum ada proyek sama sekali: halaman ini menampilkan
      // formulir "Proyek baru" (kalau dialihkan ke "/", "/" mengembalikan ke sini).
      if (authed(req) && (url.searchParams.has('next') || (await listProjects()).length)) {
        return redirect(302, safeNext(url.searchParams.get('next')));
      }
      return file('page.html', 'html');
    }
    const m = path.match(/^\/([a-z0-9-]{2,32})(?:\/(.*?))?\/?$/);
    if (!m || RESERVED.has(m[1] as string)) return file('page.html', 'html', 404);
    const id = m[1] as string;
    const rest = m[2] ?? '';
    // Alamat lama berbahasa Indonesia -> alamat baru (301), hanya untuk halaman yang memang ada.
    const moved = renamedPath(rest);
    if (moved !== null) {
      const ok = moved === 'knowledge' || PAGE_PATHS.has(moved) || validContactPath(moved);
      if (!ok || !(await getProject(id))) return file('page.html', 'html', 404);
      return redirect(301, `/${id}/${moved}${url.search}`);
    }
    if (rest === 'knowledge') return redirect(302, `/${id}/knowledge/behavior`);
    const known = PAGE_PATHS.has(rest) || validContactPath(rest);
    if (!known || !(await getProject(id))) return file('page.html', 'html', 404);
    // Proyek terakhir yang dibuka: "/" kembali ke sini.
    return file('page.html', 'html', 200, {
      'set-cookie': `${LAST_PROJECT}=${id}; SameSite=Strict; Path=/; Max-Age=${365 * 86400}${secure}`,
    });
  }

  /** /api/…: masuk, keluar, daftar proyek, dan /api/<proyek>/… untuk satu proyek. */
  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    url: URL,
    method: string,
    json: (code: number, body: unknown) => void,
    secure: string
  ): Promise<void> {
    if (!cfg.adminPassword || cfg.adminPassword.length < 8) {
      return json(503, { error: 'Dashboard belum diatur: ADMIN_PASSWORD kosong atau kurang dari 8 karakter.' });
    }

    // Permintaan yang mengubah sesuatu harus datang dari halaman ini sendiri:
    // host yang sama, atau alamat proxy yang didaftarkan di ADMIN_ORIGINS.
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host && !cfg.adminOrigins.includes(origin)) {
        return json(403, { error: 'asal tidak dikenal' });
      }
    }

    if (path === '/api/login' && method === 'POST') {
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
      res.setHeader(
        'set-cookie',
        `${COOKIE}=${sign(Date.now() + SESSION_MS)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`
      );
      return json(200, { ok: true });
    }

    if (!authed(req)) return json(401, { error: 'Belum masuk.' });

    if (path === '/api/logout' && method === 'POST') {
      res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
      return json(200, { ok: true });
    }

    if (path === '/api/projects' && method === 'GET') {
      const [rows, statuses] = await Promise.all([listProjects(), readAllStatus()]);
      const byId = new Map(statuses.map((x) => [x.project, x]));
      return json(200, {
        templates: TEMPLATES,
        projects: rows.map((p) => {
          const st = byId.get(p.id);
          return { ...projectView(p), status: st ? { state: st.state, self_phone: st.self_phone, last_seen_at: st.last_seen_at } : null };
        }),
      });
    }

    // Proyek baru = bisnis baru dengan nomor WhatsApp-nya sendiri. Bot-nya
    // dinyalakan server (alice-reconcile.timer) begitu barisnya ada.
    if (path === '/api/projects' && method === 'POST') {
      const body = JSON.parse((await readBody(req, 4000)).toString('utf8') || '{}') as Record<string, unknown>;
      const id = String(body.id ?? '').trim().toLowerCase();
      if (!PROJECT_ID.test(id) || RESERVED.has(id)) {
        return json(400, { error: 'Id proyek: 2–32 huruf kecil, angka, atau tanda minus (mis. toko-budi), dan bukan kata yang dipakai alamat dashboard (api, login, assets, …).' });
      }
      const template = String(body.template ?? 'generic');
      if (!TEMPLATES.includes(template)) return json(400, { error: `Bibit profil tidak dikenal. Pilih: ${TEMPLATES.join(', ')}` });
      let patch: ProjectPatch;
      try {
        patch = projectPatch({ name: body.name, wa_number: body.wa_number, sales_number: body.sales_number });
      } catch (e) {
        return json(400, { error: (e as Error).message });
      }
      const created = await ensureProject(id, template, patch.name as string, { wa_number: patch.wa_number, sales_number: patch.sales_number });
      if (!created) return json(409, { error: `Id proyek "${id}" sudah dipakai.` });
      console.log(`[dashboard] proyek baru: ${id} (${template})`);
      return json(200, { ok: true, project: projectView((await getProject(id)) as Project) });
    }

    // Semua yang lain milik satu proyek: /api/<proyek>/….
    const scoped = path.match(/^\/api\/([a-z0-9-]{2,32})(\/.*)$/);
    if (!scoped || RESERVED.has(scoped[1] as string)) return json(404, { error: 'Tidak ada.' });
    const ctx = await loadProject(scoped[1] as string);
    if (!ctx) return json(404, { error: 'Proyek tidak ditemukan.' });
    return withProject(ctx, () => handleProject(req, res, scoped[2] as string, url, method, json));
  }

  /** Permintaan untuk satu proyek; `path` sudah tanpa /api/<proyek> (mis. /state). */
  async function handleProject(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    url: URL,
    method: string,
    json: (code: number, body: unknown) => void
  ): Promise<void> {
    const project = currentProject();

    if (path === '/state' && method === 'GET') {
      return json(200, {
        profile: editableView(),
        business: biz.id,
        project: projectView(project.row),
        testReady: llmEnabled() || brain !== llmBrain,
        status: await store.status(),
        alerts: await store.alerts(),
        month: monthCost(await store.usage()),
      });
    }

    if (path === '/profile' && method === 'PUT') {
      const body = JSON.parse((await readBody(req, 400_000)).toString('utf8')) as Record<string, unknown>;
      let changes;
      try {
        changes = validate(body);
      } catch (e) {
        return json(400, { error: e instanceof Error ? e.message : 'Masukan tidak sah.' });
      }
      // Produk yang baru ditambahkan dan belum punya PDF: cari di PDF yang sudah
      // diunggah. Produk lama tidak disentuh — PDF yang sengaja dilepas tetap lepas.
      let autoPdf = 0;
      if (changes.products) {
        const before = new Set(biz.products.map((x) => x.name));
        const fresh = changes.products.filter((x) => !x.pdf && !before.has(x.name));
        if (fresh.length) {
          const names = changes.products.map((x) => x.name);
          for (const f of biz.files.filter(isPdf)) {
            const found = new Set((await namesIn(f, names)).matches);
            for (const x of fresh) {
              if (!x.pdf && found.has(x.name)) {
                x.pdf = f.id;
                autoPdf += 1;
              }
            }
          }
        }
      }
      await store.save(changes);
      console.log(`[dashboard] profil disimpan: ${Object.keys(changes).join(', ')}${autoPdf ? ` (${autoPdf} produk baru dipasangi PDF)` : ''}`);
      // Foto yang tidak lagi dipakai produk mana pun (atau logo) dibuang. PDF
      // tidak: ia punya halamannya sendiri dan dihapus dari sana.
      if ('products' in changes || 'logo' in changes) {
        const used = referencedFiles();
        const orphans = biz.files.filter((f) => !isPdf(f) && !used.has(f.id));
        if (orphans.length) {
          await store.save({ files: biz.files.filter((f) => !orphans.includes(f)) });
          for (const f of orphans) await store.delPhoto(f.file).catch(() => {});
          console.log(`[dashboard] ${orphans.length} berkas tak terpakai dihapus`);
        }
      }
      return json(200, { ok: true, profile: editableView(), autoPdf });
    }

    if (path === '/leads' && method === 'GET') {
      return json(200, {
        fields: biz.leadFields.map((f) => ({ key: f.key, label: f.label })),
        rows: await store.leads(),
        // Kapan bot terakhir melapor (laporan berkalanya).
        reportedAt: (await store.status())?.reportedAt ?? null,
      });
    }

    // Satu pelanggan: percakapannya, tahap pipeline + catatan, balasan dari
    // web, dan tombol bot / sudah ditangani. Ditulis langsung ke database; bot
    // membaca penahan chat di tiap giliran, jadi berlaku seketika.
    const lead = path.match(/^\/leads\/([^/]+)(?:\/(bot|handled|reply))?$/);
    if (lead) {
      let phone = '';
      try {
        phone = decodeURIComponent(lead[1] as string);
      } catch {
        // alamat rusak: dianggap nomor tidak sah di bawah
      }
      if (!CONTACT.test(phone)) return json(400, { error: 'Nomor tidak sah.' });
      if (!lead[2] && method === 'GET') return leadDetail(phone, url, json);
      if (!lead[2] && method === 'PUT') {
        const body = JSON.parse((await readBody(req, 8000)).toString('utf8') || '{}') as Record<string, unknown>;
        const patch: { stage?: Stage; note?: string | null } = {};
        if ('stage' in body) {
          if (!STAGES.includes(body.stage as Stage)) return json(400, { error: `Tahap harus salah satu dari: ${STAGES.join(', ')}.` });
          patch.stage = body.stage as Stage;
        }
        if ('note' in body) {
          const note = String(body.note ?? '').replace(/\r\n/g, '\n').trim();
          if (note.length > 2000) return json(400, { error: 'Catatan terlalu panjang (maksimal 2.000 karakter).' });
          patch.note = note || null;
        }
        if (!Object.keys(patch).length) return json(400, { error: 'Isi stage atau note.' });
        const c = await setStageNote(phone, patch);
        if (!c) return json(404, { error: 'Kontak tidak ditemukan.' });
        return json(200, { ok: true, stage: c.stage, note: c.note });
      }
      if (lead[2] === 'reply' && method === 'POST') {
        const body = JSON.parse((await readBody(req, 20_000)).toString('utf8') || '{}') as { text?: unknown };
        const text = String(body.text ?? '').replace(/\r\n/g, '\n').trim();
        if (!text) return json(400, { error: 'Balasan kosong.' });
        if (text.length > MAX_REPLY) return json(400, { error: `Balasan terlalu panjang (maksimal ${MAX_REPLY.toLocaleString('id-ID')} karakter).` });
        const c = await getContact(phone);
        if (!c) return json(404, { error: 'Kontak tidak ditemukan.' });
        if (!c.address) return json(400, { error: 'Pelanggan ini belum pernah chat ke nomor bot, jadi belum bisa dibalas dari sini. Balas dari aplikasi WhatsApp.' });
        // Sama persis dengan admin yang membalas dari HP: bot mundur di chat ini.
        const at = Date.now();
        const taken = await applyHumanReply(c.address, text, at, 'dashboard');
        const payload: ReplyPayload = { phone, address: c.address, text, by: 'dashboard', message_id: taken?.messageId ?? null };
        const outboxId = await outboxAdd('reply', payload, at);
        console.log(`[dashboard] ${currentProject().id}: balasan ke ${phone} diantre (#${outboxId})`);
        return json(200, {
          ok: true,
          outbox_id: outboxId,
          message: { id: taken?.messageId ?? null, dir: 'human', text, at, kind: 'dashboard' },
          stage: taken?.contact.stage ?? c.stage,
        });
      }
      if (lead[2] && lead[2] !== 'reply' && method === 'POST') {
        if (lead[2] === 'bot') {
          const body = JSON.parse((await readBody(req, 200)).toString('utf8') || '{}') as { mode?: string };
          if (body.mode !== 'on' && body.mode !== 'off') return json(400, { error: 'mode harus "on" atau "off".' });
          if (!(await switchBot(phone, body.mode, Date.now()))) return json(404, { error: 'Kontak tidak ditemukan.' });
        } else if (!(await markHandled(phone, Date.now()))) {
          return json(404, { error: 'Kontak tidak ditemukan.' });
        }
        return json(200, { ok: true });
      }
    }

    // Pertanyaan yang dioper ke staf, dikelompokkan per pertanyaan yang sama.
    if (path === '/handoffs' && method === 'GET') {
      const resolved = url.searchParams.get('status') === 'resolved';
      return json(200, { groups: groupHandoffs(await listHandoffs(resolved, resolved ? 500 : 2000)) });
    }

    // Jawab satu pertanyaan (masuk ke "Pengetahuan lain") atau abaikan; semua
    // pertanyaan yang sama di kelompoknya ikut selesai.
    const resolve = path.match(/^\/handoffs\/(\d{1,10})\/resolve$/);
    if (resolve && method === 'POST') {
      const body = JSON.parse((await readBody(req, 20_000)).toString('utf8') || '{}') as { answer?: unknown; resolution?: unknown };
      if (body.resolution !== 'ditambahkan' && body.resolution !== 'diabaikan') {
        return json(400, { error: 'resolution harus "ditambahkan" atau "diabaikan".' });
      }
      const row = await getHandoff(Number(resolve[1]));
      if (!row) return json(404, { error: 'Pertanyaan tidak ditemukan.' });
      if (row.resolved_at) return json(409, { error: 'Pertanyaan ini sudah diselesaikan.' });
      const norm = normQuestion(row.question);
      const ids = (await listHandoffs(false)).filter((r) => normQuestion(r.question) === norm).map((r) => r.id);
      const at = Date.now();
      if (body.resolution === 'diabaikan') {
        await resolveHandoffs(ids, 'diabaikan', null, at);
        return json(200, { ok: true, resolved: ids.length });
      }
      const answer = String(body.answer ?? '').replace(/\r\n/g, '\n').trim();
      if (!answer) return json(400, { error: 'Tulis jawabannya dulu.' });
      if (answer.length > 4000) return json(400, { error: 'Jawaban terlalu panjang (maksimal 4.000 karakter).' });
      const block = `T: ${row.question.replace(/\s+/g, ' ').trim()}\nJ: ${answer}`;
      const notes = biz.notes.trim() ? `${biz.notes.trimEnd()}\n\n${block}` : block;
      let changes;
      try {
        changes = validate({ notes });
      } catch {
        return json(400, { error: 'Pengetahuan lain sudah terlalu panjang untuk ditambah jawaban ini (maksimal 30.000 karakter). Rapikan dulu di Pengetahuan bot > Produk.' });
      }
      await store.save(changes);
      await resolveHandoffs(ids, 'ditambahkan', answer, at);
      console.log(`[dashboard] ${currentProject().id}: jawaban untuk "${row.question.slice(0, 60)}" ditambahkan ke pengetahuan (${ids.length} pertanyaan)`);
      return json(200, { ok: true, resolved: ids.length, profile: editableView() });
    }

    // Angka dan grafik Beranda: 7 hari terakhir menurut zona waktu bot, atau
    // ?days=N (paling banyak 90) untuk grafik yang lebih panjang.
    if (path === '/metrics' && method === 'GET') {
      const t = Date.now();
      const asked = Math.floor(Number(url.searchParams.get('days')));
      const n = Number.isFinite(asked) && asked >= 1 ? Math.min(MAX_METRIC_DAYS, asked) : METRIC_DAYS;
      const days = Array.from({ length: n }, (_, i) => localDay(t - (n - 1 - i) * DAY));
      const m = await metrics(days, t - (n + 1) * DAY, cfg.tz);
      return json(200, { windowDays: n, ...m, today: m.days[m.days.length - 1]?.conversations ?? 0 });
    }

    // Pelanggan lama: daftar nomor (dan nama) yang sudah dikenal bisnis ini,
    // dicatat langsung sebagai kontak. Impor baru digabung dengan yang lama;
    // kontak yang sudah ada tidak ditimpa.
    if (path === '/known' && method === 'POST') {
      const body = JSON.parse((await readBody(req, 400_000)).toString('utf8') || '{}') as { text?: string; off?: boolean };
      const list = new Map<string, string>();
      let invalid = 0;
      for (const line of String(body.text ?? '').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [first, ...rest] = line.split(/[,;\t]/);
        const phone = normPhone(first ?? '');
        if (!phone) {
          invalid += 1;
          continue;
        }
        list.set(phone, label(rest.join(' '), 60));
      }
      if (!list.size && !invalid) return json(400, { error: 'Tidak ada nomor di daftar itu.' });
      if (list.size > 5000) return json(400, { error: 'Maksimal 5.000 pelanggan lama sekali impor.' });
      const at = Date.now();
      const nameKey = biz.leadFields.find((f) => f.isName)?.key;
      let added = 0;
      for (const [phone, name] of list) {
        if (await importContact(phone, nameKey && name ? { [nameKey]: name } : {}, Boolean(body.off), at)) added += 1;
      }
      const total = await countImported();
      await store.save({ knownAt: at, knownCount: total });
      console.log(`[dashboard] pelanggan lama: ${added} ditambahkan, total ${total}`);
      return json(200, { ok: true, added, invalid, total, profile: editableView() });
    }

    // --- WhatsApp proyek ini: keadaan, kode pairing, tautkan ulang ---
    if (path === '/wa' && method === 'GET') {
      const st = await readStatus(project.id);
      return json(200, {
        wa: st
          ? {
              state: st.state, qr: st.qr, pairing_code: st.pairing_code, self_phone: st.self_phone, detail: st.detail,
              last_seen_at: st.last_seen_at, started_at: st.started_at, version: st.version, transport: st.transport,
            }
          : null,
        project: projectView(project.row),
        // Permintaan yang belum diambil bot (bot memeriksanya tiap beberapa detik).
        pending: project.row.pairing_request ? (project.row.pairing_request.reset ? 'reset' : 'pair') : null,
      });
    }

    if (path === '/wa/pair' && method === 'POST') {
      if (project.row.transport !== 'baileys') return json(400, { error: 'Jalur Cloud API tidak memakai kode pairing.' });
      const body = JSON.parse((await readBody(req, 500)).toString('utf8') || '{}') as { number?: string };
      const raw = String(body.number ?? project.row.wa_number ?? '').trim();
      const number = normPhone(raw);
      if (!number) return json(400, { error: raw ? `Nomor "${raw}" tidak sah.` : 'Isi nomor WhatsApp bot dulu.' });
      await setPairingRequest(project.id, { number: number.slice(1), at: Date.now() });
      console.log(`[dashboard] ${project.id}: kode pairing diminta untuk ${number}`);
      return json(200, { ok: true });
    }

    if (path === '/wa/reset' && method === 'POST') {
      await setPairingRequest(project.id, { reset: true, at: Date.now() });
      console.log(`[dashboard] ${project.id}: sesi WhatsApp diputus untuk ditautkan ulang`);
      return json(200, { ok: true });
    }

    // Baris proyek: nama, nomor bot, nomor sales, jalur, aktif, dan jeda semua chat.
    if (path === '/project' && method === 'PUT') {
      const body = JSON.parse((await readBody(req, 4000)).toString('utf8') || '{}') as Record<string, unknown>;
      let patch: ProjectPatch;
      try {
        patch = projectPatch(body);
      } catch (e) {
        return json(400, { error: (e as Error).message });
      }
      const row = await updateProject(project.id, patch);
      if (!row) return json(404, { error: 'Proyek tidak ditemukan.' });
      console.log(`[dashboard] ${project.id}: proyek diubah (${Object.keys(patch).join(', ') || '-'})`);
      return json(200, { ok: true, project: projectView(row) });
    }

    if (path === '/alerts' && method === 'GET') {
      return json(200, { alerts: await store.alerts(), errors: await store.errors(), status: await store.status() });
    }

    if (path === '/usage' && method === 'GET') {
      return json(200, { usage: await store.usage() });
    }

    if (path === '/test' && method === 'POST') {
      const body = JSON.parse((await readBody(req, 20_000)).toString('utf8')) as {
        text?: string;
        history?: { dir: 'in' | 'out'; text: string }[];
        known?: Record<string, string>;
      };
      const text = label(body.text, 800);
      if (!text) return json(400, { error: 'Pesan kosong.' });
      if (!llmEnabled() && brain === llmBrain) return json(400, { error: 'LLM belum diatur (LLM_API_KEY kosong).' });
      const history = (body.history ?? []).slice(-10).map((h) => ({ dir: h.dir === 'out' ? ('out' as const) : ('in' as const), text: label(h.text, 1500) }));
      for (const f of biz.files) if (isPdf(f) && f.read) setPdfText(f.id, await textOfPdf(f));
      const result = await brain({ text, known: body.known ?? {}, history, justGreeted: false });
      if (!result) return json(502, { error: 'LLM tidak menjawab. Coba lagi.' });
      const asked = [text, ...history.filter((h) => h.dir === 'in').map((h) => h.text)].join('\n');
      return json(200, {
        ...result,
        photos: result.photos.map(fileById).filter(Boolean),
        docs: result.docs.map(fileById).filter(Boolean),
        // Pesan tautan beli yang akan dikirim bot sesudah balasannya.
        buy: result.buy.map((name) => biz.products.find((p) => p.name === name)).map((p) => p && buyMessage(p)).filter(Boolean),
        rejected: checkReply(result.reply, asked),
      });
    }

    // Unggah foto atau PDF. Berkasnya baru "dipakai" setelah daftar produk (atau
    // logo) yang merujuknya disimpan; yang tidak pernah dirujuk dibuang saat itu.
    if (path === '/files' && method === 'POST') {
      if (biz.files.length >= MAX_FILES) return json(400, { error: `Maksimal ${MAX_FILES} berkas.` });
      let data: Buffer;
      try {
        data = await readBody(req, MAX_FILE_BYTES);
      } catch {
        return json(413, { error: 'Berkas terlalu besar (maksimal 4 MB).' });
      }
      const ext = fileExt(data);
      if (!ext) return json(400, { error: 'Hanya JPG, PNG, WebP, atau PDF.' });
      const id = `${ext === 'pdf' ? 'd' : 'f'}${randomBytes(4).toString('hex')}`;
      const file: MediaFile = { id, file: `${id}.${ext}`, name: label(url.searchParams.get('name'), 120) || `berkas.${ext}` };
      await store.putPhoto(file.file, data, TYPES[ext] as string);
      await store.save({ files: [...biz.files, file] });
      console.log(`[dashboard] berkas ditambah: ${file.name}`);
      // Satu PDF sering memuat banyak produk: beri tahu dashboard produk mana
      // yang disebut di dalamnya, supaya bisa langsung dipasangkan.
      return json(200, {
        ok: true, file, files: biz.files,
        ...(ext === 'pdf' ? await namesIn(file, biz.products.map((x) => x.name), data) : {}),
      });
    }

    const one = path.match(/^\/files\/(d[0-9a-f]{8})(\/match|\/read)?$/);
    if (one) {
      const f = fileById(one[1] as string);
      if (!f) return json(404, { error: 'PDF tidak ditemukan.' });
      // Cocokkan ulang dengan daftar produk yang sekarang (mis. setelah produk ditambah).
      if (one[2] === '/match' && method === 'POST') {
        return json(200, { ok: true, ...(await namesIn(f, biz.products.map((x) => x.name))) });
      }
      // Boleh/tidaknya bot membaca isi PDF ini sebagai pengetahuan.
      if (one[2] === '/read' && method === 'POST') {
        const body = JSON.parse((await readBody(req, 200)).toString('utf8') || '{}') as { read?: boolean };
        const read = Boolean(body.read);
        if (read && !(await textOfPdf(f))) {
          return json(400, { error: 'PDF ini tidak bisa dibaca (hasil pindai?), jadi bot tidak bisa memakai isinya.' });
        }
        await store.save({ files: biz.files.map((x) => (x.id === f.id ? { ...x, read } : x)) });
        console.log(`[dashboard] isi PDF "${f.name}" ${read ? 'sekarang dibaca bot' : 'tidak lagi dibaca bot'}`);
        return json(200, { ok: true, files: biz.files });
      }
      if (!one[2] && method === 'DELETE') {
        await store.save({
          files: biz.files.filter((x) => x.id !== f.id),
          products: biz.products.map((x) => (x.pdf === f.id ? { ...x, pdf: '' } : x)),
        });
        await store.delPhoto(f.file).catch(() => {});
        await store.delPhoto(`${f.id}.txt`).catch(() => {});
        console.log(`[dashboard] PDF dihapus: ${f.name}`);
        return json(200, { ok: true, profile: editableView() });
      }
    }

    // Berkas unggahan: hanya yang terdaftar di profil, jadi tidak ada jalan keluar folder.
    const media = path.match(/^\/media\/([fd][0-9a-f]{8}\.(jpg|png|webp|pdf))$/);
    if (media && method === 'GET') {
      const f = biz.files.find((x) => x.file === media[1]);
      const data = f ? await store.getPhoto(f.file) : null;
      if (!data) return json(404, { error: 'Tidak ada.' });
      // Nama berkas unik per unggahan, jadi aman disimpan peramban (tidak di perantara).
      res.writeHead(200, {
        'content-type': TYPES[media[2] as string] as string,
        'cache-control': 'private, max-age=86400',
        ...(media[2] === 'pdf' ? { 'content-disposition': 'inline; filename="dokumen.pdf"' } : {}),
      });
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
  console.log(`[dashboard] http://${cfg.adminHost === '0.0.0.0' ? 'localhost' : cfg.adminHost}:${port}/`);
  if (cfg.adminHost !== '127.0.0.1' && cfg.adminHost !== 'localhost') {
    console.log('[dashboard] WARNING: terbuka ke jaringan. Taruh di belakang HTTPS.');
  }
  return port;
}

export async function stopAdmin(): Promise<void> {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
}
