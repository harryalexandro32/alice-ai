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

import { checkReply, explainHandoff, llmBrain, type Brain, type Explainer } from '../brain';
import { biz, editableView, fileById, LESSON_LIMITS, loadProject, referencedFiles, setPdfText, TEMPLATES, validate, validateLessons } from '../business';
import { buyMessage, isPdf } from '../business/catalog';
import type { MediaFile } from '../business/types';
import { cfg, normPhone, parseSalesNumber } from '../config';
import { ensureProject } from '../db/seed';
import { localDay } from '../clock';
import { applyHumanReply, contactName, holdReason, markHandled, switchBot } from '../flow';
import { llmEnabled } from '../llm/provider';
import { recipientsFor } from '../notify';
import { currentProject, withProject } from '../project';
import { MAX_REPLY_ATTEMPTS, type ReplyPayload } from '../sinks/outbox';
import {
  countImported, getContact, getHandoff, getOrder, getProject, getShopLink, importContact, listHandoffs, listOrders, listProjects, messagePage,
  messagesAround, metrics, normQuestion, orderCounts, orderForContact, outboxAdd, outboxState, pendingReplies, readAllStatus, readStatus,
  resolveHandoffs, setPairingRequest, setStageNote, STAGES, updateProject,
  type Contact, type HandoffRow, type OrderRow, type Project, type ProjectPatch, type StaffPatch, type Stage,
} from '../store';
import {
  authUrl, consumeState, isPaid, linkOrderToContact, linkShop, onOrderRefChanged, processWebhook, readState, receiveWebhook, redirectUrl, shopRound, syncOrders,
  syncRunning, tiktokEnabled, unlinkShop, verifyWebhook, webhookProject, webhookUrl, type WebhookEvent,
} from '../tiktok';
import { COURIERS, isCourier, phaseOf, trackContact, trackingEnabled, trackingLinks } from '../tracking';
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

let explainer: Explainer = explainHandoff;
/** Tes: ganti penjelas yang dipakai "Bantu jelaskan" di Pertanyaan yang belum terjawab. */
export function setAdminExplainer(fn: Explainer): void {
  explainer = fn;
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
  // Callback izin dan webhook Tokopedia & Shop (/tiktok/…), dan halaman Pesanan.
  'tiktok', 'orders',
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
    if (!name) throw new Error('Nama proyek masih kosong. Isi namanya dulu.');
    out.name = name;
  }
  if ('wa_number' in body) {
    const raw = String(body.wa_number ?? '').trim();
    const n = raw ? normPhone(raw) : null;
    if (raw && !n) throw new Error(`Nomor WhatsApp bot “${raw}” tidak sah. Periksa lagi nomornya.`);
    out.wa_number = n;
  }
  if ('sales_number' in body) {
    const raw = String(body.sales_number ?? '').trim();
    const n = parseSalesNumber(raw);
    if (raw && !n) throw new Error(`Nomor sales “${raw}” tidak sah. Isi nomor, atau “self” untuk nomor bot sendiri.`);
    out.sales_number = n;
  }
  if ('transport' in body) {
    if (body.transport !== 'baileys' && body.transport !== 'cloud') throw new Error('Jalur WhatsApp harus baileys atau cloud.');
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

/**
 * Perkiraan biaya bulan ini (bulan menurut zona waktu bot). `usd` dan `llm` =
 * biaya LLM (USD dan Rupiah), `resi` = cek resi (otomatis + manual) × tarif
 * dalam Rupiah, `idr` = jumlah keduanya.
 */
function monthCost(u: UsageReport | null): { usd: number; idr: number; llm: number; resi: number } {
  if (!u) return { usd: 0, idr: 0, llm: 0, resi: 0 };
  const month = localDay(Date.now()).slice(0, 7);
  const usd = u.days
    .filter((d) => d.day.startsWith(month))
    .reduce((a, d) => a + ((d.promptTokens - d.cachedTokens) * u.price.in + d.cachedTokens * u.price.cached + d.completionTokens * u.price.out) / 1e6, 0);
  const llm = Math.round(usd * u.usdIdr);
  const resi = Math.round(
    u.resi.days.filter((d) => d.day.startsWith(month)).reduce((a, d) => a + d.auto + d.manual, 0) * u.resi.price
  );
  return { usd, idr: llm + resi, llm, resi };
}

/** Pesan yang dicatat dengan tanda di awal (berkas, tautan beli, kiriman yang tidak bisa dibaca), bukan teks balasan. */
const isMark = (t: string): boolean => /^\[[a-z ,]+(:[^\]]*)?\]/i.test(t);
const oneLine = (t: string, max: number): string => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

/**
 * Konteks satu pertanyaan yang dioper ke tim: pesan bot (atau admin) tepat
 * sebelumnya, balasan bot sesudahnya, dan riwayat sebelumnya untuk "Coba lagi".
 */
async function questionContext(row: { phone: string; at: number }) {
  const m = await messagesAround(row.phone, row.at);
  const before = [...m.before].reverse().find((x) => x.dir !== 'in' && !isMark(x.text))?.text ?? '';
  const reply = m.after.find((x) => x.dir === 'out' && !isMark(x.text))?.text ?? '';
  return { before, reply, history: m.before.map((x) => ({ dir: x.dir, text: x.text })) };
}

/** Contoh nyata untuk sebuah pelajaran: pesan bot sebelumnya dan pesan pelanggan. */
const lessonExample = (before: string, question: string): string =>
  (before ? `Bot: "${oneLine(before, 160)}" ` : '') + `Pelanggan: "${oneLine(question, 160)}"`;

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

/** Saringan halaman Pesanan: id saringan -> status pesanan yang masuk (ejaan API). */
const ORDER_GROUPS: Record<string, (o: OrderRow) => boolean> = {
  semua: () => true,
  'belum-bayar': (o) => o.status === 'UNPAID' || o.status === 'ON_HOLD',
  'perlu-kirim': (o) => o.status === 'AWAITING_SHIPMENT' || o.status === 'PARTIALLY_SHIPPING',
  dikirim: (o) => o.status === 'AWAITING_COLLECTION' || o.status === 'IN_TRANSIT',
  selesai: (o) => o.status === 'DELIVERED' || o.status === 'COMPLETED',
  batal: (o) => o.status === 'CANCELLED',
  'belum-tertaut': (o) => isPaid(o.status) && !o.contact_phone,
};

/** Alamat dashboard untuk kembali dari halaman izin: ADMIN_ORIGINS yang pertama, kalau tidak ada alamat relatif. */
const dashboardOrigin = (): string => cfg.adminOrigins[0] ?? '';

const escHtml = (v: string): string => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Halaman kecil untuk state izin yang tidak sah, kedaluwarsa, atau sudah dipakai. */
function badStatePage(): string {
  const home = escHtml(`${dashboardOrigin()}/`);
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Tautan tidak sah</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;background:#fff;color:#1a1a1a}` +
    `main{max-width:32rem;margin:0 auto}a{color:#0b57d0}</style></head><body><main>` +
    `<p>Tautan kedaluwarsa atau tidak sah, misalnya setelah dashboard dimulai ulang. Buka dashboard lalu klik Tautkan toko lagi.</p>` +
    `<p><a href="${home}">Buka dashboard</a></p></main></body></html>`;
}

/** Id pesanan di alamat: huruf, angka, garis bawah, tanda minus. */
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Satu pesanan untuk dashboard. `contactName` = nama di percakapan yang tertaut (atau nama WhatsApp-nya). */
function shopOrderView(o: OrderRow, contact?: Contact) {
  return {
    orderId: o.order_id, platform: o.platform, status: o.status, createTime: o.create_time, updateTime: o.update_time, paidTime: o.paid_time,
    total: o.total_amount, currency: o.currency, paymentMethod: o.payment_method, isCod: o.is_cod, recipientName: o.recipient_name,
    recipientPhone: o.recipient_phone, items: o.items ?? [], trackingNumber: o.tracking_number, shippingProvider: o.shipping_provider,
    cancelReason: o.cancel_reason, contactPhone: o.contact_phone,
    contactName: contact ? (contactName(contact) ?? contact.wa_name ?? null) : null,
  };
}

/** Pesanan beserta nama percakapannya (satu kueri per nomor yang berbeda). */
async function shopOrderViews(rows: OrderRow[]) {
  const phones = [...new Set(rows.map((o) => o.contact_phone).filter((p): p is string => Boolean(p)))];
  const contacts = new Map((await Promise.all(phones.map((p) => getContact(p)))).filter((c): c is Contact => Boolean(c)).map((c) => [c.phone, c]));
  return rows.map((o) => shopOrderView(o, o.contact_phone ? contacts.get(o.contact_phone) : undefined));
}

/**
 * Mulai sinkron pesanan proyek ini di latar belakang. False kalau sinkron
 * untuk proyek ini masih berjalan (dari tombol, sinkron pertama, atau putaran
 * berkala; penjaganya ada di syncOrders), jadi tidak dimulai dua kali.
 */
function startSync(project: string): boolean {
  if (syncRunning(project)) return false;
  void syncOrders(project).catch((e) => console.error(`[toko] ${project}: sinkron gagal: ${e instanceof Error ? e.message : e}`));
  return true;
}

/** Halaman izin bisa dibuka: fitur menyala dan TIKTOK_SERVICE_ID diisi. */
const canAuth = (): boolean => tiktokEnabled() && Boolean(cfg.tiktokServiceId);

/**
 * Halaman Pengaturan > Tokopedia & Shop: menyala atau belum, alamat untuk
 * Partner Center, tautan toko, dan jumlah pesanan 30 hari. Alamat halaman
 * izin tidak ada di sini: dibuat baru tiap klik (POST /marketplace/auth-url).
 */
async function marketplaceView() {
  const at = Date.now();
  const enabled = tiktokEnabled();
  const [link, orders] = await Promise.all([getShopLink(), orderCounts(at - 30 * DAY)]);
  return {
    enabled,
    webhookUrl: webhookUrl(),
    redirectUrl: redirectUrl(),
    canAuth: canAuth(),
    // Diputus dari dashboard (`unlinked`): barisnya masih ada untuk webhook pencabutan izin, tapi halamannya tampil belum ditautkan.
    link: link && link.status !== 'unlinked'
      ? {
          shopId: link.shop_id, shopName: link.shop_name, region: link.region, sellerName: link.seller_name, status: link.status, error: link.error,
          linkedAt: link.linked_at, accessExpiresAt: link.access_expires_at, refreshExpiresAt: link.refresh_expires_at, lastSyncAt: link.last_sync_at,
          scopes: link.granted_scopes ?? [],
        }
      : null,
    orders,
  };
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

  /** Data pesanan satu kontak untuk dashboard: nomor pesanan, resi, kurir, dan hasil pelacakan terakhir. */
  function orderView(c: Contact) {
    return {
      ref: c.order_ref ?? '', awb: c.awb ?? '', courier: c.courier ?? '',
      status: c.ship_status ?? null, phase: phaseOf(c.ship_status), history: c.ship_history ?? [],
      checkedAt: c.ship_checked_at, error: c.ship_error ?? null,
      links: c.awb ? trackingLinks(c.awb, c.courier ?? '') : [],
      trackingEnabled: trackingEnabled(),
    };
  }

  /** Satu pelanggan untuk halaman percakapan: data, riwayat pesan (per halaman), balasan yang belum terkirim. */
  async function leadDetail(phone: string, url: URL, json: (code: number, body: unknown) => void): Promise<void> {
    const c = await getContact(phone);
    if (!c) return json(404, { error: 'Kontak tidak ditemukan.' });
    const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('limit'))) || 100));
    const before = Math.floor(Number(url.searchParams.get('before')));
    const [messages, pending, shop] = await Promise.all([
      messagePage(phone, limit, before > 0 ? before : undefined), pendingReplies(phone), orderForContact(phone, c.order_ref),
    ]);
    const hold = c.opted_out_at ? 'berhenti' : c.pending_off ? 'tombol' : c.address ? await holdReason(c.address, Date.now()) : null;
    return json(200, {
      contact: {
        phone: c.phone, waName: c.wa_name, lead: c.lead, needsSales: Boolean(c.needs_sales), complete: Boolean(c.lead_sent_at),
        lastAt: c.last_inbound_at, lastDir: c.last_dir, summary: c.summary ?? '', hold, stage: c.stage, note: c.note ?? '',
        imported: Boolean(c.imported), handledAt: c.handled_at, canReply: Boolean(c.address),
      },
      fields: biz.leadFields.map((f) => ({ key: f.key, label: f.label })),
      order: orderView(c),
      // Pesanan Tokopedia & Shop yang tertaut ke percakapan ini (atau bernomor sama), atau null.
      marketplace: shop
        ? {
            orderId: shop.order_id, platform: shop.platform, status: shop.status, paidTime: shop.paid_time, total: shop.total_amount,
            currency: shop.currency, trackingNumber: shop.tracking_number, shippingProvider: shop.shipping_provider, updateTime: shop.update_time,
          }
        : null,
      couriers: COURIERS,
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

    // --- Tokopedia & Shop: callback izin dan webhook, tanpa sesi (dilindungi state dan tanda tangan) ---
    if (path === '/tiktok/auth' && method === 'GET') {
      const badState = () => {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
        res.end(badStatePage());
      };
      return tiktokAuth(url, redirect, badState, () => file('page.html', 'html', 404));
    }
    if (path === '/tiktok/webhook' && method === 'POST') return tiktokWebhook(req, json);

    if (path.startsWith('/api/')) return handleApi(req, res, path, url, method, json, secure);

    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'Alamat ini tidak ditemukan.' });

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

  /**
   * Kembali dari halaman izin Tokopedia & Shop: `state` menunjuk proyeknya
   * (ditandatangani, 30 menit, sekali pakai). Tautkan tokonya, mulai sinkron
   * pertama di latar belakang, lalu kembali ke halaman pengaturannya di
   * dashboard (ADMIN_ORIGINS yang pertama). State yang tidak sah: halaman
   * kecil 400 dengan tautan ke dashboard.
   */
  async function tiktokAuth(
    url: URL, redirect: (code: 301 | 302, location: string) => void, badState: () => void, notFound: () => void
  ): Promise<void> {
    if (!tiktokEnabled()) return notFound();
    const state = url.searchParams.get('state') ?? '';
    const at = Date.now();
    const project = readState(state, at);
    const ctx = project ? await loadProject(project) : undefined;
    if (!project || !ctx || !consumeState(state, at)) return badState();
    const back = (query: string) => redirect(302, `${dashboardOrigin()}/${project}/settings/marketplace?${query}`);
    const code = url.searchParams.get('code') ?? '';
    const denied = url.searchParams.get('error');
    if (denied && denied !== 'auth_denied') return back(`linked=0&error=${encodeURIComponent(denied.slice(0, 200))}`);
    if (denied || !code || code === 'null') return back('linked=0');
    try {
      await withProject(ctx, () => linkShop(project, code));
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      console.error(`[toko] ${project}: tautan toko gagal: ${msg}`);
      return back(`linked=0&error=${encodeURIComponent(msg)}`);
    }
    // Sinkron pertama tidak ditunggu: pemilik langsung kembali ke dashboard.
    void withProject(ctx, () => syncOrders(project)).catch((e) => console.error(`[toko] ${project}: sinkron pertama gagal: ${e instanceof Error ? e.message : e}`));
    return back('linked=1');
  }

  /**
   * Webhook Tokopedia & Shop. Tanda tangan salah = 401 (satu-satunya
   * penolakan; 500 hanya kalau database tidak bisa menyimpannya). Webhook
   * disimpan sebagai menunggu di `webhook_events`, lalu langsung 200 (TikTok
   * menunggu paling lama 3 detik), lalu isinya ditangani sesudahnya.
   */
  async function tiktokWebhook(req: IncomingMessage, json: (code: number, body: unknown) => void): Promise<void> {
    if (!tiktokEnabled()) return json(404, { error: 'Alamat ini tidak ditemukan.' });
    let raw: Buffer;
    try {
      raw = await readBody(req, 64 * 1024);
    } catch {
      return json(413, { error: 'Badan webhook terlalu besar.' });
    }
    const auth = req.headers.authorization;
    if (!verifyWebhook(cfg.tiktokAppKey, cfg.tiktokAppSecret, raw, typeof auth === 'string' ? auth : undefined)) {
      console.error('[toko] webhook ditolak: tanda tangan tidak sah');
      return json(401, { error: 'Tanda tangan webhook tidak sah.' });
    }
    let event: WebhookEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as WebhookEvent;
    } catch {
      console.error('[toko] webhook diabaikan: isinya bukan JSON');
      return json(200, { ok: true });
    }
    const project = await webhookProject(event?.shop_id);
    if (!project) {
      console.log(`[toko] webhook untuk toko yang tidak dikenal (${String(event?.shop_id)}) diabaikan`);
      return json(200, { ok: true });
    }
    // Disimpan dulu sebagai menunggu, baru dijawab 200: kalau proses berhenti sebelum selesai, putaran berkala
    // memprosesnya. Gagal menyimpan = 500, jadi TikTok mengirim ulang.
    let received: Awaited<ReturnType<typeof receiveWebhook>>;
    try {
      received = await receiveWebhook(project, event);
    } catch (e) {
      console.error(`[toko] webhook gagal disimpan: ${e instanceof Error ? e.message : e}`);
      return json(500, { error: 'Webhook belum bisa disimpan. Coba lagi nanti.' });
    }
    json(200, { ok: true });
    // Sudah selesai: kiriman ganda. Masih menunggu: sedang diproses atau menunggu putaran berkala, tidak diproses dua kali.
    if (received.state !== 'baru') {
      console.log(`[toko] webhook ${received.id} sudah ${received.state === 'selesai' ? 'selesai' : 'menunggu'}, dilewati`);
      return;
    }
    void processWebhook(project, event, received.id).catch((e) => console.error(`[toko] webhook gagal: ${e instanceof Error ? e.message : e}`));
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
      return json(503, { error: 'Dashboard belum diatur. ADMIN_PASSWORD masih kosong atau kurang dari 8 karakter.' });
    }

    // Permintaan yang mengubah sesuatu harus datang dari halaman ini sendiri:
    // host yang sama, atau alamat proxy yang didaftarkan di ADMIN_ORIGINS.
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host && !cfg.adminOrigins.includes(origin)) {
        return json(403, { error: 'Permintaan ditolak karena asalnya tidak dikenal.' });
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
        return json(401, { error: 'Kata sandi tidak cocok. Coba lagi.' });
      }
      fails = 0;
      res.setHeader(
        'set-cookie',
        `${COOKIE}=${sign(Date.now() + SESSION_MS)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`
      );
      return json(200, { ok: true });
    }

    if (!authed(req)) return json(401, { error: 'Anda belum masuk. Silakan masuk dulu.' });

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
        return json(400, { error: 'Id proyek harus 2 hingga 32 karakter: huruf kecil, angka, atau tanda minus, misalnya toko-budi. Id juga tidak boleh sama dengan kata yang dipakai alamat dashboard, seperti api, login, dan assets.' });
      }
      const template = String(body.template ?? 'generic');
      if (!TEMPLATES.includes(template)) return json(400, { error: `Profil awal tidak dikenal. Pilih salah satu: ${TEMPLATES.join(', ')}.` });
      let patch: ProjectPatch;
      try {
        patch = projectPatch({ name: body.name, wa_number: body.wa_number, sales_number: body.sales_number });
      } catch (e) {
        return json(400, { error: (e as Error).message });
      }
      const created = await ensureProject(id, template, patch.name as string, { wa_number: patch.wa_number, sales_number: patch.sales_number });
      if (!created) return json(409, { error: `Id proyek “${id}” sudah dipakai. Pilih id lain.` });
      console.log(`[dashboard] proyek baru: ${id} (${template})`);
      return json(200, { ok: true, project: projectView((await getProject(id)) as Project) });
    }

    // Semua yang lain milik satu proyek: /api/<proyek>/….
    const scoped = path.match(/^\/api\/([a-z0-9-]{2,32})(\/.*)$/);
    if (!scoped || RESERVED.has(scoped[1] as string)) return json(404, { error: 'Alamat ini tidak ditemukan.' });
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
        return json(400, { error: e instanceof Error ? e.message : 'Ada isian yang tidak sesuai. Periksa lagi, lalu simpan.' });
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

    // "Kirim tes" di Pengaturan > Notifikasi: satu pesan tes per nomor penerima, dikirim bot
    // lewat antrean (seperti balasan dari dashboard). Isinya menyebut kabar apa saja yang diterima nomor itu.
    if (path === '/notify/test' && method === 'POST') {
      const phones = [...new Set(biz.recipients.map((r) => r.phone).filter(Boolean))];
      if (!phones.length) return json(400, { error: 'Belum ada penerima. Tambahkan penerima, simpan, lalu kirim tes lagi.' });
      const KINDS = [['lead', 'lead baru'], ['butuh-staf', 'pelanggan butuh staf'], ['llm', 'LLM bermasalah'], ['resi', 'saldo atau batas cek resi'], ['marketplace', 'tautan toko Tokopedia & Shop']] as const;
      const at = Date.now();
      const ids: number[] = [];
      for (const phone of phones) {
        const gets = KINDS.filter(([k]) => recipientsFor(k).some((r) => r.phone === phone)).map(([, label]) => label);
        const text =
          `🔔 *Tes notifikasi* | ${biz.brand}\n` +
          'Ini pesan tes dari dashboard. ' +
          (gets.length ? `Kalau pesan ini sampai, nomor ini akan menerima kabar: ${gets.join(', ')}.` : 'Nomor ini belum menerima kabar apa pun; atur di Pengaturan > Notifikasi.');
        ids.push(await outboxAdd('test', { phone, text }, at));
      }
      console.log(`[dashboard] ${currentProject().id}: pesan tes notifikasi diantre untuk ${phones.join(', ')}`);
      return json(200, { ids, phones });
    }
    if (path === '/notify/test' && method === 'GET') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 40);
      const rows = await outboxState(ids);
      // Baris yang ditutup sesudah MAX_REPLY_ATTEMPTS kali gagal (lihat src/sinks/outbox.ts) tidak dihitung terkirim.
      return json(200, { items: rows.map((r) => ({ id: r.id, done: r.done_at !== null && r.attempts < MAX_REPLY_ATTEMPTS, attempts: r.attempts })) });
    }

    if (path === '/leads' && method === 'GET') {
      return json(200, {
        fields: biz.leadFields.map((f) => ({ key: f.key, label: f.label })),
        rows: await store.leads(),
        // Kapan bot terakhir melapor (laporan berkalanya).
        reportedAt: (await store.status())?.reportedAt ?? null,
      });
    }

    // Satu pelanggan: percakapannya, tahap pipeline + catatan, data pesanan dan
    // resi, balasan dari web, dan tombol bot / sudah ditangani. Ditulis langsung
    // ke database; bot membaca penahan chat di tiap giliran, jadi berlaku seketika.
    const lead = path.match(/^\/leads\/([^/]+)(?:\/(bot|handled|reply|track))?$/);
    if (lead) {
      let phone = '';
      try {
        phone = decodeURIComponent(lead[1] as string);
      } catch {
        // alamat rusak: dianggap nomor tidak sah di bawah
      }
      if (!CONTACT.test(phone)) return json(400, { error: 'Nomor ini tidak sah. Periksa lagi nomornya.' });
      if (!lead[2] && method === 'GET') return leadDetail(phone, url, json);
      if (!lead[2] && method === 'PUT') {
        const body = JSON.parse((await readBody(req, 8000)).toString('utf8') || '{}') as Record<string, unknown>;
        const patch: StaffPatch = {};
        if ('stage' in body) {
          if (!STAGES.includes(body.stage as Stage)) return json(400, { error: `Tahap harus salah satu dari: ${STAGES.join(', ')}.` });
          patch.stage = body.stage as Stage;
        }
        if ('note' in body) {
          const note = String(body.note ?? '').replace(/\r\n/g, '\n').trim();
          if (note.length > 2000) return json(400, { error: 'Catatan terlalu panjang. Maksimal 2.000 karakter.' });
          patch.note = note || null;
        }
        // Data pesanan: string kosong = kosongkan kolomnya.
        if ('order_ref' in body) {
          const ref = String(body.order_ref ?? '').trim();
          if (ref.length > 60) return json(400, { error: 'Nomor pesanan terlalu panjang. Maksimal 60 karakter.' });
          patch.order_ref = ref || null;
        }
        if ('awb' in body) {
          const awb = String(body.awb ?? '').trim().toUpperCase();
          if (!/^[A-Z0-9-]{0,40}$/.test(awb)) return json(400, { error: 'Nomor resi hanya boleh huruf, angka, dan tanda minus.' });
          patch.awb = awb || null;
        }
        if ('courier' in body) {
          const courier = String(body.courier ?? '').trim();
          if (courier && !isCourier(courier)) return json(400, { error: 'Kurir tidak dikenal.' });
          patch.courier = courier || null;
        }
        if (!Object.keys(patch).length) return json(400, { error: 'Isi tahap, catatan, atau data pesanan.' });
        let c = await setStageNote(phone, patch);
        if (!c) return json(404, { error: 'Kontak tidak ditemukan.' });
        // Nomor pesanan diganti atau dikosongkan: pesanan Tokopedia & Shop lama dilepas. Nomor yang sudah ada
        // di pesanan Tokopedia & Shop: tautkan, isi resi, naikkan tahap.
        if ('order_ref' in patch && (await onOrderRefChanged(phone, patch.order_ref ?? null))) c = (await getContact(phone)) ?? c;
        return json(200, { ok: true, stage: c.stage, note: c.note, order: orderView(c) });
      }
      // "Cek resi": tanya status kurir sekarang. Pelacak yang gagal bukan 500:
      // pesannya ikut di order.error dan ditampilkan di dashboard.
      if (lead[2] === 'track' && method === 'POST') {
        const c = await getContact(phone);
        if (!c) return json(404, { error: 'Kontak tidak ditemukan.' });
        if (!trackingEnabled()) return json(503, { error: 'Pelacakan resi belum diatur. Isi BINDERBYTE_API_KEY di .env server.' });
        if (!c.awb || !isCourier(c.courier)) return json(400, { error: 'Isi nomor resi dan kurir dulu.' });
        const t = (await trackContact(phone)) ?? c;
        return json(200, { ok: true, stage: t.stage, order: orderView(t) });
      }
      if (lead[2] === 'reply' && method === 'POST') {
        const body = JSON.parse((await readBody(req, 20_000)).toString('utf8') || '{}') as { text?: unknown };
        const text = String(body.text ?? '').replace(/\r\n/g, '\n').trim();
        if (!text) return json(400, { error: 'Balasan masih kosong. Tulis balasannya dulu.' });
        if (text.length > MAX_REPLY) return json(400, { error: `Balasan terlalu panjang. Maksimal ${MAX_REPLY.toLocaleString('id-ID')} karakter.` });
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
      if ((lead[2] === 'bot' || lead[2] === 'handled') && method === 'POST') {
        if (lead[2] === 'bot') {
          const body = JSON.parse((await readBody(req, 200)).toString('utf8') || '{}') as { mode?: string };
          if (body.mode !== 'on' && body.mode !== 'off') return json(400, { error: 'Mode harus "on" atau "off".' });
          if (!(await switchBot(phone, body.mode, Date.now()))) return json(404, { error: 'Kontak tidak ditemukan.' });
        } else if (!(await markHandled(phone, Date.now()))) {
          return json(404, { error: 'Kontak tidak ditemukan.' });
        }
        return json(200, { ok: true });
      }
    }

    // --- Tokopedia & Shop: tautan toko dan pesanan ---
    if (path === '/marketplace' && method === 'GET') return json(200, await marketplaceView());
    // Alamat halaman izin dengan state baru (sekali pakai, 30 menit), dibuat saat pemilik mengeklik "Tautkan toko".
    if (path === '/marketplace/auth-url' && method === 'POST') {
      if (!canAuth()) return json(400, { error: 'Fitur Tokopedia & Shop belum menyala, atau TIKTOK_SERVICE_ID masih kosong.' });
      return json(200, { url: authUrl(project.id, Date.now()) });
    }
    // Kode izin yang ditempel pemilik (aplikasi "seller developer" di Partner Center bisa menampilkan kodenya
    // langsung, tanpa kembali ke /tiktok/auth). Sama dengan callback: tautkan, lalu sinkron pertama di latar belakang.
    if (path === '/marketplace/code' && method === 'POST') {
      if (!tiktokEnabled()) return json(400, { error: 'Fitur Tokopedia & Shop belum menyala. Isi TIKTOK_APP_KEY dan TIKTOK_APP_SECRET di server.' });
      const body = JSON.parse((await readBody(req, 2000)).toString('utf8') || '{}') as { code?: unknown };
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (code.length < 8 || code.length > 200) return json(400, { error: 'Isi kode izin dari Partner Center.' });
      try {
        await linkShop(project.id, code);
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        console.error(`[toko] ${project.id}: tautan toko dengan kode gagal: ${msg}`);
        return json(400, { error: msg });
      }
      console.log(`[dashboard] ${project.id}: toko ditautkan dengan kode izin`);
      void syncOrders(project.id).catch((e) => console.error(`[toko] ${project.id}: sinkron pertama gagal: ${e instanceof Error ? e.message : e}`));
      return json(200, await marketplaceView());
    }
    if (path === '/marketplace/unlink' && method === 'POST') {
      await unlinkShop(project.id);
      return json(200, await marketplaceView());
    }
    if (path === '/marketplace/sync' && method === 'POST') {
      const link = await getShopLink();
      if (!link || link.status !== 'active' || !tiktokEnabled()) return json(400, { error: 'Toko belum ditautkan. Tautkan toko dulu.' });
      // Sinkron bisa lama (banyak halaman): dijawab sekarang, sinkronnya jalan di latar belakang.
      const started = startSync(project.id);
      return json(200, { ok: true, started, ...(await marketplaceView()) });
    }
    if (path === '/orders' && method === 'GET') {
      const key = url.searchParams.get('status') ?? 'semua';
      const group = Object.hasOwn(ORDER_GROUPS, key) ? ORDER_GROUPS[key] : ORDER_GROUPS.semua;
      const text = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 100);
      const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('limit'))) || 200));
      // Disaring di JS atas pesanan terbaru (cukup untuk satu toko); 2.000 baris paling banyak.
      const rows = (await listOrders(2000))
        .filter(group as (o: OrderRow) => boolean)
        .filter((o) => !text || [o.order_id, o.recipient_name ?? '', ...(o.items ?? []).map((x) => x.name)].some((v) => v.toLowerCase().includes(text)))
        .slice(0, limit);
      return json(200, { rows: await shopOrderViews(rows) });
    }
    const shopOrder = path.match(/^\/orders\/([^/]+)$/);
    if (shopOrder && method === 'PUT') {
      let id = '';
      try {
        id = decodeURIComponent(shopOrder[1] as string);
      } catch {
        // alamat rusak: dianggap id tidak sah di bawah
      }
      if (!ORDER_ID.test(id)) return json(400, { error: 'Nomor pesanan tidak sah.' });
      const body = JSON.parse((await readBody(req, 2000)).toString('utf8') || '{}') as { phone?: unknown };
      const raw = String(body.phone ?? '').trim();
      if (!(await getOrder(id))) return json(404, { error: 'Pesanan tidak ditemukan.' });
      let phone: string | null = null;
      if (raw) {
        phone = CONTACT.test(raw) ? raw : normPhone(raw);
        if (!phone || !(await getContact(phone))) return json(400, { error: 'Nomor ini tidak ada di percakapan.' });
      }
      const row = await linkOrderToContact(id, phone);
      // Pesanannya hilang di tengah jalan (mis. izin toko dicabut): 404, bukan 500.
      if (!row) return json(404, { error: 'Pesanan sudah tidak ada.' });
      console.log(`[dashboard] ${project.id}: pesanan ${id} ${phone ? `ditautkan ke ${phone}` : 'dilepas dari percakapan'}`);
      return json(200, { ok: true, row: (await shopOrderViews([row]))[0] });
    }

    // Pertanyaan yang dioper ke staf, dikelompokkan per pertanyaan yang sama.
    if (path === '/handoffs' && method === 'GET') {
      const resolved = url.searchParams.get('status') === 'resolved';
      const groups = groupHandoffs(await listHandoffs(resolved, resolved ? 500 : 2000));
      if (resolved) return json(200, { groups });
      // Pertanyaan yang masih terbuka: dengan pesan bot sebelumnya dan balasan bot sesudahnya.
      const withContext = await Promise.all(groups.map(async (g, i) => {
        if (i >= 50) return g;
        const { before, reply } = await questionContext({ phone: g.phone, at: g.last_at });
        return { ...g, context: { before, reply } };
      }));
      return json(200, { groups: withContext });
    }

    // "Coba lagi": jalankan ulang giliran itu dengan profil sekarang, ditambah pelajaran yang belum disimpan.
    const retry = path.match(/^\/handoffs\/(\d{1,10})\/retry$/);
    if (retry && method === 'POST') {
      const body = JSON.parse((await readBody(req, 20_000)).toString('utf8') || '{}') as { lesson?: unknown };
      if (!llmEnabled() && brain === llmBrain) return json(400, { error: 'LLM belum diatur: LLM_API_KEY di .env masih kosong.' });
      const row = await getHandoff(Number(retry[1]));
      if (!row) return json(404, { error: 'Pertanyaan tidak ditemukan.' });
      const ctx = await questionContext(row);
      const rule = String(body.lesson ?? '').trim().slice(0, LESSON_LIMITS.rule);
      for (const f of biz.files) if (isPdf(f) && f.read) setPdfText(f.id, await textOfPdf(f));
      const result = await brain({
        text: row.question, known: (await getContact(row.phone))?.lead ?? {}, history: ctx.history, justGreeted: false,
        ...(rule ? { lessons: [{ rule, example: lessonExample(ctx.before, row.question) }] } : {}),
      });
      if (!result) return json(502, { error: 'LLM tidak menjawab. Coba lagi.' });
      return json(200, {
        reply: result.reply,
        intent: result.intent,
        photos: result.photos.map(fileById).filter(Boolean),
        docs: result.docs.map(fileById).filter(Boolean),
        buy: result.buy.map((name) => biz.products.find((p) => p.name === name)).map((p) => p && buyMessage(p)).filter(Boolean),
        rejected: checkReply(result.reply, row.question),
      });
    }

    // "Bantu jelaskan": kenapa bot menyerahkan pesan ini ke tim, dan usulan pelajarannya.
    const explain = path.match(/^\/handoffs\/(\d{1,10})\/explain$/);
    if (explain && method === 'POST') {
      if (!llmEnabled() && explainer === explainHandoff) return json(400, { error: 'LLM belum diatur: LLM_API_KEY di .env masih kosong.' });
      const row = await getHandoff(Number(explain[1]));
      if (!row) return json(404, { error: 'Pertanyaan tidak ditemukan.' });
      const ctx = await questionContext(row);
      const r = await explainer({ question: row.question, history: ctx.history, reply: ctx.reply });
      if (!r) return json(502, { error: 'LLM tidak menjawab. Coba lagi.' });
      return json(200, r);
    }

    // Jawab satu pertanyaan (masuk ke "Pengetahuan lain"), ajari bot (jadi
    // pelajaran), atau abaikan; semua pertanyaan yang sama di kelompoknya ikut selesai.
    const resolve = path.match(/^\/handoffs\/(\d{1,10})\/resolve$/);
    if (resolve && method === 'POST') {
      const body = JSON.parse((await readBody(req, 20_000)).toString('utf8') || '{}') as { answer?: unknown; resolution?: unknown; lesson?: unknown };
      if (body.resolution !== 'ditambahkan' && body.resolution !== 'diajarkan' && body.resolution !== 'diabaikan') {
        return json(400, { error: 'resolution harus "ditambahkan", "diajarkan", atau "diabaikan".' });
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
      if (body.resolution === 'diajarkan') {
        const rule = String(body.lesson ?? '').replace(/\r\n/g, '\n').trim();
        if (!rule) return json(400, { error: 'Tulis pelajarannya dulu.' });
        const ctx = await questionContext(row);
        let lessons;
        try {
          lessons = validateLessons([...biz.lessons, { rule, example: lessonExample(ctx.before, row.question) }]);
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : 'Pelajaran tidak sah.' });
        }
        await store.save({ lessons });
        await resolveHandoffs(ids, 'diajarkan', rule, at);
        console.log(`[dashboard] ${currentProject().id}: pelajaran dari "${row.question.slice(0, 60)}" ditambahkan (${ids.length} pertanyaan)`);
        return json(200, { ok: true, resolved: ids.length, profile: editableView() });
      }
      const answer = String(body.answer ?? '').replace(/\r\n/g, '\n').trim();
      if (!answer) return json(400, { error: 'Tulis jawabannya dulu.' });
      if (answer.length > 4000) return json(400, { error: 'Jawaban terlalu panjang. Maksimal 4.000 karakter.' });
      const block = `T: ${row.question.replace(/\s+/g, ' ').trim()}\nJ: ${answer}`;
      const notes = biz.notes.trim() ? `${biz.notes.trimEnd()}\n\n${block}` : block;
      let changes;
      try {
        changes = validate({ notes });
      } catch {
        return json(400, { error: '“Pengetahuan lain” sudah terlalu panjang untuk ditambah jawaban ini. Maksimalnya 30.000 karakter. Ringkas dulu isinya di Pengetahuan bot › Produk.' });
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
      if (!list.size && !invalid) return json(400, { error: 'Tidak ada nomor yang bisa dibaca di daftar itu. Tulis satu nomor per baris.' });
      if (list.size > 5000) return json(400, { error: 'Maksimal 5.000 pelanggan lama per impor. Bagi daftarnya menjadi beberapa kali impor.' });
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
      const raw = String(body.number || project.row.wa_number || '').trim();
      const number = normPhone(raw);
      if (!number) return json(400, { error: raw ? `Nomor “${raw}” tidak sah. Periksa lagi nomornya.` : 'Isi nomor WhatsApp bot dulu.' });
      // Nomor bot hanya diatur di halaman WhatsApp: nomor yang dipakai untuk pairing ikut disimpan.
      if (number !== project.row.wa_number) await updateProject(project.id, { wa_number: number });
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
      return json(200, { usage: await store.usage({ waitAccount: true }) });
    }

    if (path === '/test' && method === 'POST') {
      const body = JSON.parse((await readBody(req, 20_000)).toString('utf8')) as {
        text?: string;
        history?: { dir: 'in' | 'out'; text: string }[];
        known?: Record<string, string>;
      };
      const text = label(body.text, 800);
      if (!text) return json(400, { error: 'Pesan masih kosong. Tulis pesannya dulu.' });
      if (!llmEnabled() && brain === llmBrain) return json(400, { error: 'LLM belum diatur: LLM_API_KEY di .env masih kosong.' });
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
      if (biz.files.length >= MAX_FILES) return json(400, { error: `Maksimal ${MAX_FILES} berkas. Hapus dulu berkas yang tidak dipakai.` });
      let data: Buffer;
      try {
        data = await readBody(req, MAX_FILE_BYTES);
      } catch {
        return json(413, { error: 'Berkas lebih dari 4 MB. Pilih berkas yang lebih kecil.' });
      }
      const ext = fileExt(data);
      if (!ext) return json(400, { error: 'Jenis berkas ini tidak bisa dipakai. Pilih JPG, PNG, WebP, atau PDF.' });
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
          return json(400, { error: 'PDF ini tidak bisa dibaca, mungkin hasil pindai. Bot tidak bisa memakai isinya.' });
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
      if (!data) return json(404, { error: 'Berkas tidak ditemukan.' });
      // Nama berkas unik per unggahan, jadi aman disimpan peramban (tidak di perantara).
      res.writeHead(200, {
        'content-type': TYPES[media[2] as string] as string,
        'cache-control': 'private, max-age=86400',
        ...(media[2] === 'pdf' ? { 'content-disposition': 'inline; filename="dokumen.pdf"' } : {}),
      });
      return void res.end(data);
    }

    json(404, { error: 'Alamat ini tidak ditemukan.' });
  }

  return (req: IncomingMessage, res: ServerResponse): Promise<void> =>
    handle(req, res).catch((e) => {
      console.error('[dashboard]', e instanceof Error ? e.message : e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ada gangguan di server. Coba lagi.' }));
    });
}

// ---------------------------------------------------------------------------
// Server lokal (di samping bot, atau `npm run admin`)
// ---------------------------------------------------------------------------

let server: Server | null = null;
/** Putaran Tokopedia & Shop (token dan sinkron pesanan) tiap 15 menit. */
let shopTimer: NodeJS.Timeout | null = null;
const SHOP_EVERY_MS = 15 * 60_000;

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
  // Tanpa TIKTOK_APP_KEY dan TIKTOK_APP_SECRET putarannya langsung selesai (lihat shopRound).
  shopTimer = setInterval(() => void shopRound(), SHOP_EVERY_MS);
  shopTimer.unref();
  const port = adminPort() as number;
  console.log(`[dashboard] http://${cfg.adminHost === '0.0.0.0' ? 'localhost' : cfg.adminHost}:${port}/`);
  if (cfg.adminHost !== '127.0.0.1' && cfg.adminHost !== 'localhost') {
    console.log('[dashboard] WARNING: terbuka ke jaringan. Taruh di belakang HTTPS.');
  }
  return port;
}

export async function stopAdmin(): Promise<void> {
  if (shopTimer) clearInterval(shopTimer);
  shopTimer = null;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
}
