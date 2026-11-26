/**
 * Tokopedia & Shop: tautan toko lewat aplikasi TikTok Shop Partner Center.
 *
 * Tokopedia dijalankan TikTok Shop; satu aplikasi Partner Center memberi
 * pesanan toko: sudah dibayar atau belum, waktu bayar, total, resi, dan kurir.
 * Pemilik toko menautkan tokonya sekali dari dashboard (izin OAuth). Pesanan
 * masuk lewat webhook dan sinkron berkala ke tabel `orders`, lalu dicocokkan
 * ke percakapan HANYA lewat nomor pesanan (`contacts.order_ref`): nama dan
 * nomor pembeli disamarkan marketplace, jadi tidak pernah dipakai untuk
 * mencocokkan. Pesanan yang cocok mengisi resi dan kurir percakapannya dan
 * menaikkan tahapnya (payment, dikirim, selesai); tahap tidak pernah turun,
 * dan "batal" tidak disentuh.
 *
 * Semua akses jaringan lewat satu fetch yang bisa diganti tes
 * (setTiktokFetch), jadi tes tidak pernah menyentuh internet.
 *
 * Tanpa TIKTOK_APP_KEY dan TIKTOK_APP_SECRET fitur ini mati.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { raiseAlert } from './alerts';
import { loadProject } from './business';
import { now } from './clock';
import { cfg, HOUR } from './config';
import type { OrderItem, OrderRow } from './db/schema';
import { maybeProject, withProject } from './project';
import {
  activeShopLinkByShopId, activeShopLinks, advanceStage, contactByOrderRef, deleteOrders, deleteShopEverywhere, detachOrdersExcept, failWebhookEvent, finishWebhookEvent,
  getContact, getOrder, getShopLink, getWebhookEvent, PAID_STATUSES, pendingWebhookEvents, pendingWebhookProjects, receiveWebhookEvent, saveShopLink, setOrderContact, setStageNote,
  shopLinkByShopId, STAGES, unmatchedOrdersWithRef, updateShopLink, upsertOrderRow,
  type Contact, type ShopLink, type Stage,
} from './store';

// ---------------------------------------------------------------------------
// Fungsi murni: tanda tangan, state OAuth, bentuk pesanan, kurir, tahap
// ---------------------------------------------------------------------------

/** Alamat API bisnis, token, dan halaman izin penjual (selain AS, termasuk Indonesia). */
export const API_BASE = 'https://open-api.tiktokglobalshop.com';
export const AUTH_BASE = 'https://auth.tiktok-shops.com';
export const AUTHORIZE_URL = 'https://services.tiktokshop.com/open/authorize';

const hmacHex = (key: string | Buffer, msg: string | Buffer): string => createHmac('sha256', key).update(msg).digest('hex');

/**
 * Tanda tangan satu panggilan API bisnis: semua parameter query kecuali
 * `sign` dan `access_token`, diurutkan menurut nama, digabung `{nama}{nilai}`;
 * di depannya alamat (path), di belakangnya badan JSON apa adanya (kalau
 * ada), lalu dibungkus app secret di kedua sisi. HMAC-SHA256 dengan app
 * secret sebagai kunci, hex huruf kecil.
 */
export function signRequest(secret: string, path: string, query: Record<string, string>, body?: string): string {
  const params = Object.keys(query)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join('');
  return hmacHex(secret, `${secret}${path}${params}${body ?? ''}${secret}`);
}

/** Bandingkan dua teks tanpa membocorkan letak bedanya lewat waktu. */
function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Webhook asli dari TikTok: header Authorization = hex HMAC-SHA256(kunci =
 * app secret, pesan = app key + badan mentah), tanpa awalan apa pun.
 */
export function verifyWebhook(appKey: string, secret: string, rawBody: Buffer, authorization: string | undefined): boolean {
  if (!appKey || !secret || !authorization) return false;
  const expected = hmacHex(secret, Buffer.concat([Buffer.from(appKey, 'utf8'), rawBody]));
  return sameText(authorization.trim().toLowerCase(), expected);
}

/** State OAuth berlaku sekian lama (kode izin TikTok juga hanya hidup 30 menit). */
export const STATE_TTL_MS = 30 * 60_000;

/**
 * Kunci tanda tangan state: 32 byte acak per proses, dibuat saat modul dimuat.
 * Kunci ini tidak diturunkan dari kata sandi dashboard, jadi state yang
 * terlihat orang lain tidak membuka apa pun tentang kata sandi itu.
 * Akibatnya: sesudah dashboard dimulai ulang, semua state yang belum dipakai
 * tidak berlaku lagi. Itu tidak apa-apa: pemilik cukup mengklik Tautkan toko lagi.
 */
let stateKey = randomBytes(32);

/** Tes: buat kunci state baru, sama seperti dashboard dimulai ulang. */
export function resetStateKey(): void {
  stateKey = randomBytes(32);
}

const stateMac = (project: string, at: number, nonce: string): string =>
  hmacHex(stateKey, `tiktok-state:${project}:${at}:${nonce}`).slice(0, 32);

/**
 * State untuk halaman izin: proyek, waktu, dan angka acak (jadi tiap state
 * berbeda), ditandatangani dengan kunci acak proses ini (lihat stateKey).
 */
export function makeState(project: string, at: number): string {
  const nonce = randomBytes(8).toString('hex');
  return Buffer.from(`${project}:${at}:${nonce}:${stateMac(project, at, nonce)}`, 'utf8').toString('base64url');
}

/**
 * Isi state yang sudah didekode, hanya untuk teks base64url yang persis
 * (huruf, angka, "-", "_"; tanpa "=" atau tanda lain) dan kanonis (dikodekan
 * ulang menjadi teks yang sama). Dekoder base64url Node mengabaikan tanda
 * asing dan bit sisa, jadi tanpa pemeriksaan ini satu state punya banyak
 * ejaan yang lolos tanda tangan.
 */
function decodeState(state: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(state)) return null;
  const decoded = Buffer.from(state, 'base64url').toString('utf8');
  return Buffer.from(decoded, 'utf8').toString('base64url') === state ? decoded : null;
}

/** Id proyek dari state yang sah dan belum lewat 30 menit; null kalau tidak sah atau kedaluwarsa. */
export function readState(state: string | null | undefined, at: number): string | null {
  if (!state || state.length > 300) return null;
  const decoded = decodeState(state);
  if (!decoded) return null;
  const parts = decoded.split(':');
  if (parts.length !== 4) return null;
  const [project, rawAt, nonce, mac] = parts as [string, string, string, string];
  const made = Number(rawAt);
  if (!/^[a-z0-9-]{2,32}$/.test(project) || !/^\d{1,16}$/.test(rawAt) || !Number.isSafeInteger(made) || !/^[0-9a-f]{16}$/.test(nonce)) return null;
  if (!sameText(mac, stateMac(project, made, nonce))) return null;
  // Sedikit kelonggaran untuk jam yang tidak persis sama; selebihnya 30 menit.
  if (made > at + 60_000 || at - made > STATE_TTL_MS) return null;
  return project;
}

/** Isi state yang sudah dipakai (didekode, bukan teks mentahnya) -> kapan boleh dilupakan (sesudah itu readState menolaknya karena kedaluwarsa). */
const usedStates = new Map<string, number>();

/**
 * Pakai state sekali saja: true untuk pemakaian pertama, false kalau state
 * ini sudah pernah dipakai. Hanya untuk state yang lolos readState. Kuncinya
 * isi state yang didekode, jadi ejaan lain dari state yang sama tetap
 * ditolak. Catatan yang sudah lewat masa berlakunya dibuang.
 */
export function consumeState(state: string, at: number): boolean {
  for (const [k, until] of usedStates) if (until < at) usedStates.delete(k);
  const key = decodeState(state);
  if (!key || usedStates.has(key)) return false;
  usedStates.set(key, at + STATE_TTL_MS + 2 * 60_000);
  return true;
}

/** Halaman izin Tokopedia & Shop untuk proyek ini. */
export function authUrl(project: string, at: number): string {
  const q = new URLSearchParams({ service_id: cfg.tiktokServiceId, state: makeState(project, at) });
  return `${AUTHORIZE_URL}?${q}`;
}

/**
 * Alamat callback izin dan webhook yang diisi pemilik di Partner Center.
 * Keduanya memakai PUBLIC_BASE_URL (alice-api), bukan domain dashboard di
 * Vercel: tanda tangan webhook dihitung atas byte mentah badannya, jadi
 * badan itu harus sampai ke server ini tanpa diteruskan atau diubah proxy lain.
 */
export const redirectUrl = (): string => `${cfg.publicBaseUrl}/tiktok/auth`;
export const webhookUrl = (): string => `${cfg.publicBaseUrl}/tiktok/webhook`;

/** Pesanan dari API (bentuk mentah), hanya bagian yang dibaca di sini. */
export type RawOrder = Record<string, unknown>;

/** Isian satu baris `orders` dari pesanan API (tanpa proyek dan tautan percakapan). */
export type OrderInput = Omit<OrderRow, 'project' | 'contact_phone'>;

/** Teks dari API, atau null kalau kosong. */
const txt = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
/** Detik Unix -> ms; null kalau kosong atau 0. */
const secToMs = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** Pesan error yang pendek (untuk log dan kolom `error`). */
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Status dari webhook memakai "CANCEL"; API pesanan memakai "CANCELLED". */
export const normStatus = (s: unknown): string => {
  const v = (txt(s) ?? 'UNKNOWN').toUpperCase();
  return v === 'CANCEL' ? 'CANCELLED' : v;
};

/**
 * Pesanan API -> baris `orders`. Detik jadi ms, "CANCEL" jadi "CANCELLED".
 * Satu line item = satu unit, jadi digabung per `sku_id` menjadi jumlah.
 * Resi dan kurir dari pesanannya, kalau kosong dari line item pertama yang punya.
 */
export function normalizeOrder(raw: RawOrder, shopId: string, at: number): OrderInput {
  const lines = (Array.isArray(raw.line_items) ? raw.line_items : []).map(obj);
  const groups = new Map<string, OrderItem>();
  for (const li of lines) {
    const key = txt(li.sku_id) ?? txt(li.seller_sku) ?? txt(li.product_name) ?? '';
    const g = groups.get(key);
    if (g) {
      g.qty += 1;
      continue;
    }
    const product = txt(li.product_name) ?? '';
    const variant = txt(li.sku_name);
    groups.set(key, {
      name: product + (variant ? ` ${variant}` : ''),
      sku: txt(li.seller_sku) ?? txt(li.sku_id) ?? '',
      qty: 1,
      price: txt(li.sale_price) ?? '',
    });
  }
  const shipped = lines.find((li) => txt(li.tracking_number));
  const payment = obj(raw.payment);
  const address = obj(raw.recipient_address);
  return {
    order_id: txt(raw.id) ?? '',
    shop_id: shopId,
    platform: txt(raw.commerce_platform),
    status: normStatus(raw.status),
    create_time: secToMs(raw.create_time),
    update_time: secToMs(raw.update_time),
    paid_time: secToMs(raw.paid_time),
    cancel_time: secToMs(raw.cancel_time),
    total_amount: txt(payment.total_amount),
    currency: txt(payment.currency) ?? txt(lines[0]?.currency),
    payment_method: txt(raw.payment_method_name),
    is_cod: raw.is_cod === true,
    buyer_user_id: txt(raw.user_id),
    recipient_name: txt(address.name),
    recipient_phone: txt(address.phone_number),
    items: [...groups.values()],
    tracking_number: txt(raw.tracking_number) ?? txt(shipped?.tracking_number),
    shipping_provider:
      txt(raw.shipping_provider) ?? txt(shipped?.shipping_provider_name) ?? txt(lines.find((li) => txt(li.shipping_provider_name))?.shipping_provider_name),
    fulfillment_type: txt(raw.fulfillment_type),
    shipping_type: txt(raw.shipping_type),
    cancel_reason: txt(raw.cancel_reason),
    synced_at: at,
  };
}

/** Nama kurir dari marketplace -> kode kurir Binderbyte (lihat COURIERS di src/tracking.ts). Urutan menentukan yang menang. */
const PROVIDERS: [RegExp, string][] = [
  [/kurir rekomendasi|tokopedia/, 'kurir_tokopedia'],
  [/j\s*&\s*t|\bjnt\b/, 'jnt'],
  [/\bjne\b/, 'jne'],
  [/si\s?cepat/, 'sicepat'],
  [/anter\s?aja/, 'anteraja'],
  [/\bid\s?express\b/, 'ide'],
  [/\bninja\b/, 'ninja'],
  [/\blion\b/, 'lion'],
  [/\bspx\b|shopee/, 'spx'],
  [/\bpos\b/, 'pos'],
  [/\btiki\b/, 'tiki'],
  [/\bsap\b/, 'sap'],
  [/\bwahana\b/, 'wahana'],
  [/\bgoto\b|\bgtl\b/, 'gtl'],
];

/** Kode kurir Binderbyte untuk nama kurir dari marketplace, atau null kalau tidak dikenal. */
export function courierFromProvider(name: string | null | undefined): string | null {
  const v = (name ?? '').toLowerCase().trim();
  if (!v) return null;
  return PROVIDERS.find(([re]) => re.test(v))?.[1] ?? null;
}

/**
 * Pesanan sudah dibayar: HANYA menurut statusnya (PAID_STATUSES), sama dengan
 * stageTargets, angka di sidebar, dan saringan "belum tertaut". Waktu bayar
 * tidak dipakai: pesanan ditahan (ON_HOLD) atau batal bisa punya waktu bayar,
 * tapi tidak dihitung dibayar.
 */
export function isPaid(status: string): boolean {
  return (PAID_STATUSES as readonly string[]).includes(status);
}

/** Tahap yang boleh naik ke "payment", "dikirim", dan "selesai". */
const BEFORE_PAYMENT: readonly Stage[] = ['baru', 'menunggu', 'dihubungi', 'link'];
const BEFORE_SHIPPED: readonly Stage[] = [...BEFORE_PAYMENT, 'payment'];
const BEFORE_DONE: readonly Stage[] = STAGES.filter((s) => s !== 'selesai' && s !== 'batal');

/**
 * Kenaikan tahap untuk status pesanan, berurutan (payment, lalu dikirim, lalu
 * selesai), masing-masing dengan tahap asal yang boleh naik. Dibayar ->
 * payment; diambil kurir atau di jalan -> juga dikirim; sampai atau selesai ->
 * juga selesai. Batal, belum bayar, ditahan, dan status lain: tidak ada.
 */
export function stageTargets(status: string): { to: Stage; from: readonly Stage[] }[] {
  if (!isPaid(status)) return [];
  const out: { to: Stage; from: readonly Stage[] }[] = [{ to: 'payment', from: BEFORE_PAYMENT }];
  if (status === 'AWAITING_COLLECTION' || status === 'IN_TRANSIT') out.push({ to: 'dikirim', from: BEFORE_SHIPPED });
  if (status === 'DELIVERED' || status === 'COMPLETED') out.push({ to: 'selesai', from: BEFORE_DONE });
  return out;
}

// ---------------------------------------------------------------------------
// Jaringan: satu fetch yang bisa diganti tes
// ---------------------------------------------------------------------------

/** Bentuk fetch yang dipakai di sini (sama dengan fetch bawaan Node). */
export type TiktokFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

const TIMEOUT_MS = 10_000;

/** Fetch bawaan: fetch Node dengan batas waktu 10 detik. */
const netFetch: TiktokFetch = async (url, init) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(`Tokopedia & Shop tidak menjawab dalam ${TIMEOUT_MS / 1000} detik.`);
    throw new Error(`Tokopedia & Shop tidak bisa dihubungi: ${e instanceof Error ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
};

let tiktokFetch: TiktokFetch = netFetch;

/** Tes: ganti fetch-nya; null = kembali ke fetch sungguhan. */
export function setTiktokFetch(fn: TiktokFetch | null): void {
  tiktokFetch = fn ?? netFetch;
}

/** Fitur menyala: app key dan app secret diisi (tes mengisinya di `cfg`). */
export function tiktokEnabled(): boolean {
  return Boolean(cfg.tiktokAppKey && cfg.tiktokAppSecret);
}

/** Error dari API: `code` dari amplop jawaban (0 = berhasil), `requestId` untuk dilaporkan ke TikTok. */
export class TiktokError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly requestId: string | null = null,
    readonly httpStatus: number | null = null
  ) {
    super(message);
  }
}

/** Kode error API yang ditangani sendiri. */
export const CODE_EXPIRED_TOKEN = 105002;
export const CODE_RATE_LIMIT = 36009002;

interface Envelope {
  code: number;
  message: string;
  requestId: string | null;
  data: Record<string, unknown>;
  httpStatus: number;
  retryAfter: string | null;
}

/** Baca jawaban: amplop `{ code, message, request_id, data }`. Jawaban yang bukan JSON = error. */
async function readEnvelope(res: Response): Promise<Envelope> {
  const raw = await res.text().catch(() => '');
  let body: Record<string, unknown> | null = null;
  try {
    body = obj(JSON.parse(raw));
  } catch {
    body = null;
  }
  if (!body || body.code === undefined) {
    if (res.status === 429) return { code: CODE_RATE_LIMIT, message: 'rate limit', requestId: null, data: {}, httpStatus: 429, retryAfter: res.headers.get('retry-after') };
    // Tanpa kode amplop tapi dengan status HTTP error: laporkan status HTTP-nya (dan pesannya kalau ada).
    if (res.status >= 400) {
      const msg = body ? txt(body.message) : null;
      throw new TiktokError(`Tokopedia & Shop menolak: HTTP ${res.status}${msg ? `, ${msg}` : ''}`, -1, body ? txt(body.request_id) : null, res.status);
    }
    throw new TiktokError(`Jawaban Tokopedia & Shop tidak bisa dibaca (HTTP ${res.status}).`, -1, null, res.status);
  }
  return {
    code: Number(body.code),
    message: txt(body.message) ?? '',
    requestId: txt(body.request_id),
    data: obj(body.data),
    httpStatus: res.status,
    retryAfter: res.headers.get('retry-after'),
  };
}

/** Jawaban berhasil: kode amplop 0 dan status HTTP di bawah 400. */
const succeeded = (env: Envelope): boolean => env.code === 0 && env.httpStatus < 400;

/**
 * Error dari jawaban yang gagal. Status HTTP error dengan kode amplop 0:
 * pesannya "HTTP <status>" (plus pesan amplop kalau ada), bukan "kode 0";
 * kode error-nya -1 (tidak ada kode dari API).
 */
const fail = (env: Envelope): TiktokError => {
  if (env.code === 0 && env.httpStatus >= 400) {
    const detail = `${env.message ? `, ${env.message}` : ''}${env.requestId ? ` (request ${env.requestId})` : ''}`;
    return new TiktokError(`Tokopedia & Shop menolak: HTTP ${env.httpStatus}${detail}`, -1, env.requestId, env.httpStatus);
  }
  const request = env.requestId ? `, request ${env.requestId}` : '';
  return new TiktokError(`Tokopedia & Shop menolak: ${env.message || 'tanpa pesan'} (kode ${env.code}${request})`, env.code, env.requestId, env.httpStatus);
};

/** Token dari /api/v2/token/get atau /refresh, dengan waktu kedaluwarsa dalam ms. */
export interface Tokens {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  openId: string | null;
  sellerName: string | null;
  scopes: string[];
}

async function tokenCall(path: string, params: Record<string, string>): Promise<Tokens> {
  const q = new URLSearchParams({ app_key: cfg.tiktokAppKey, app_secret: cfg.tiktokAppSecret, ...params });
  const env = await readEnvelope(await tiktokFetch(`${AUTH_BASE}${path}?${q}`, { method: 'GET', headers: { 'content-type': 'application/json' } }));
  if (!succeeded(env)) throw fail(env);
  const d = env.data;
  const access = txt(d.access_token);
  const refresh = txt(d.refresh_token);
  if (!access || !refresh) throw new TiktokError('Jawaban token Tokopedia & Shop tidak lengkap.', -1, env.requestId);
  return {
    accessToken: access,
    // *_expire_in = detik Unix (waktu mutlak), bukan lama berlaku.
    accessExpiresAt: secToMs(d.access_token_expire_in) ?? 0,
    refreshToken: refresh,
    refreshExpiresAt: secToMs(d.refresh_token_expire_in) ?? 0,
    openId: txt(d.open_id),
    sellerName: txt(d.seller_name),
    scopes: Array.isArray(d.granted_scopes) ? d.granted_scopes.map((x) => String(x)) : [],
  };
}

/** Tukar kode izin (hidup 30 menit, sekali pakai) dengan token. */
export function exchangeCode(code: string): Promise<Tokens> {
  // "authorized_code" memang ejaan dari dokumentasi TikTok.
  return tokenCall('/api/v2/token/get', { auth_code: code, grant_type: 'authorized_code' });
}

/** Perpanjangan token yang sedang berjalan, per proyek: pemanggil kedua menunggu yang pertama. */
const refreshesInFlight = new Map<string, Promise<ShopLink>>();

/**
 * Perpanjang token tautan ini dan simpan token barunya. `link` ikut diperbarui
 * (objek yang sama), jadi panggilan berikutnya memakai token baru.
 *
 * Satu perpanjangan per proyek pada satu waktu (putaran berkala dan
 * jalur 105002 di apiCall bisa bersamaan): pemanggil yang datang selagi
 * perpanjangan berjalan menunggu hasilnya, tanpa panggilan kedua ke
 * endpoint token. Sebelum memanggil endpoint token, tautannya dibaca ulang
 * dari database: kalau refresh token di sana sudah lain dari yang dipegang
 * pemanggil, token itu sudah diperpanjang, dan tautan tersimpan yang
 * dikembalikan tanpa panggilan jaringan.
 */
export function refreshToken(link: ShopLink, at = now()): Promise<ShopLink> {
  const running = refreshesInFlight.get(link.project);
  if (running) return running.then((fresh) => (fresh === link ? link : Object.assign(link, fresh)));
  const job = renewToken(link, at).finally(() => refreshesInFlight.delete(link.project));
  refreshesInFlight.set(link.project, job);
  return job;
}

async function renewToken(link: ShopLink, at: number): Promise<ShopLink> {
  const sent = link.refresh_token;
  const stored = await getShopLink();
  // Tautan diputus dari dashboard selagi ini berjalan: tokennya sudah dikosongkan, jadi tidak diperpanjang.
  if (stored?.status === 'unlinked') throw new TiktokError('Tautan toko sudah diputus dari dashboard.', -1);
  if (stored && stored.refresh_token !== sent) {
    console.log(`[toko] token sudah diperpanjang sebelumnya (${link.shop_name ?? link.shop_id}), memakai token tersimpan`);
    return Object.assign(link, stored);
  }
  let t: Tokens;
  try {
    t = await tokenCall('/api/v2/token/refresh', { refresh_token: sent, grant_type: 'refresh_token' });
  } catch (e) {
    // Ditolak, padahal refresh token tersimpan sudah lain (diperpanjang di tempat lain sementara itu):
    // itu bukan izin yang dicabut. Dilempar sebagai gangguan sementara (kode -1), dengan token tersimpan.
    const again = await getShopLink();
    if (again && again.refresh_token !== sent) {
      Object.assign(link, again);
      throw new TiktokError(`${errText(e)} (token sudah diperpanjang di tempat lain, dicoba lagi nanti)`, -1);
    }
    throw e;
  }
  const patch = {
    access_token: t.accessToken, access_expires_at: t.accessExpiresAt, refresh_token: t.refreshToken, refresh_expires_at: t.refreshExpiresAt,
    ...(t.scopes.length ? { granted_scopes: t.scopes } : {}), status: 'active', updated_at: at,
  };
  Object.assign(link, patch);
  await updateShopLink(patch);
  console.log(`[toko] token diperpanjang (${link.shop_name ?? link.shop_id})`);
  return link;
}

/** Satu panggilan API bisnis yang ditandatangani; mengembalikan amplop jawabannya. */
async function signedFetch(method: 'GET' | 'POST' | 'PUT', path: string, accessToken: string, query: Record<string, string>, body?: string): Promise<Envelope> {
  const q: Record<string, string> = { ...query, app_key: cfg.tiktokAppKey, timestamp: String(Math.floor(now() / 1000)) };
  q.sign = signRequest(cfg.tiktokAppSecret, path, q, body);
  const res = await tiktokFetch(`${API_BASE}${path}?${new URLSearchParams(q)}`, {
    method,
    headers: { 'x-tts-access-token': accessToken, 'content-type': 'application/json' },
    ...(body !== undefined ? { body } : {}),
  });
  return readEnvelope(res);
}

/** Jeda sebelum mencoba lagi sesudah rate limit: Retry-After (detik), atau 2 detik; paling lama 10 detik. */
function retryDelay(env: Envelope): number {
  const n = Number(env.retryAfter);
  return env.retryAfter !== null && env.retryAfter !== '' && Number.isFinite(n) && n >= 0 ? Math.min(10_000, n * 1000) : 2000;
}

/**
 * Panggilan API pesanan untuk toko yang ditautkan: menambah app_key,
 * timestamp, dan shop_cipher, menandatangani, mengirim token di header.
 * Token kedaluwarsa (105002): diperpanjang sekali lalu dicoba lagi. Rate limit
 * (HTTP 429 atau 36009002): menunggu lalu dicoba lagi sekali. Error lain
 * dilempar sebagai TiktokError. `body` diserialisasi sekali; byte yang sama
 * ditandatangani dan dikirim.
 */
export async function apiCall(
  link: ShopLink, method: 'GET' | 'POST' | 'PUT', path: string, opts: { query?: Record<string, string>; body?: unknown } = {}
): Promise<Record<string, unknown>> {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const query = { ...(opts.query ?? {}), shop_cipher: link.shop_cipher };
  let refreshed = false;
  let waited = false;
  for (;;) {
    const env = await signedFetch(method, path, link.access_token, query, body);
    if (succeeded(env)) return env.data;
    if (env.code === CODE_EXPIRED_TOKEN && !refreshed) {
      refreshed = true;
      await refreshToken(link);
      continue;
    }
    if ((env.httpStatus === 429 || env.code === CODE_RATE_LIMIT) && !waited) {
      waited = true;
      await new Promise((r) => setTimeout(r, retryDelay(env)));
      continue;
    }
    throw fail(env);
  }
}

/** Toko yang memberi izin ke aplikasi ini (dengan cipher untuk API pesanan). */
export interface AuthorizedShop {
  id: string;
  name: string | null;
  region: string | null;
  cipher: string;
}

export async function authorizedShops(accessToken: string): Promise<AuthorizedShop[]> {
  const env = await signedFetch('GET', '/authorization/202309/shops', accessToken, {});
  if (!succeeded(env)) throw fail(env);
  const shops = Array.isArray(env.data.shops) ? env.data.shops.map(obj) : [];
  return shops
    .map((x) => ({ id: txt(x.id) ?? '', name: txt(x.name), region: txt(x.region), cipher: txt(x.cipher) ?? '' }))
    .filter((x) => x.id && x.cipher);
}

/** Detail pesanan per id, 50 per panggilan. */
export async function fetchOrders(link: ShopLink, ids: string[]): Promise<RawOrder[]> {
  const out: RawOrder[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const data = await apiCall(link, 'GET', '/order/202507/orders', { query: { ids: unique.slice(i, i + 50).join(',') } });
    if (Array.isArray(data.orders)) out.push(...data.orders.map(obj));
  }
  return out;
}

/** Batas halaman per sinkron (50 pesanan per halaman), supaya tidak berputar tanpa akhir. */
export const MAX_PAGES = 200;

/** Hasil searchOrders: pesanannya, dan `truncated` = berhenti di MAX_PAGES padahal masih ada halaman berikutnya. */
export interface OrderSearch {
  orders: RawOrder[];
  truncated: boolean;
  pages: number;
}

/** Semua pesanan yang berubah sejak `updateTimeGeMs`, terlama dulu, halaman demi halaman (paling banyak MAX_PAGES halaman). */
export async function searchOrders(link: ShopLink, updateTimeGeMs: number): Promise<OrderSearch> {
  const out: RawOrder[] = [];
  const body = { update_time_ge: Math.max(0, Math.floor(updateTimeGeMs / 1000)) };
  let token = '';
  let pages = 0;
  while (pages < MAX_PAGES) {
    const query: Record<string, string> = { page_size: '50', sort_field: 'update_time', sort_order: 'ASC', ...(token ? { page_token: token } : {}) };
    const data = await apiCall(link, 'POST', '/order/202309/orders/search', { query, body });
    pages += 1;
    if (Array.isArray(data.orders)) out.push(...data.orders.map(obj));
    token = txt(data.next_page_token) ?? '';
    if (!token) break;
  }
  return { orders: out, truncated: Boolean(token), pages };
}

// ---------------------------------------------------------------------------
// Tautan toko, pesanan, dan percakapan
// ---------------------------------------------------------------------------

/** Jalankan `fn` di proyek ini (memuat proyeknya kalau belum yang sedang dilayani). */
async function inProject<T>(project: string, fn: () => Promise<T>): Promise<T> {
  if (maybeProject()?.id === project) return fn();
  const ctx = await loadProject(project);
  if (!ctx) throw new Error(`proyek ${project} tidak ditemukan`);
  return withProject(ctx, fn);
}

/**
 * Tautkan toko dari kode izin: tukar dengan token, baca toko yang memberi
 * izin (toko Indonesia dulu, selain itu yang pertama), simpan sebagai tautan
 * aktif proyek ini. Toko lain yang tadinya tertaut ke proyek ini diganti, dan
 * pesanan toko lama itu dihapus.
 */
export function linkShop(project: string, code: string, at = now()): Promise<ShopLink> {
  return inProject(project, async () => {
    const t = await exchangeCode(code);
    const shops = await authorizedShops(t.accessToken);
    const shop = shops.find((x) => x.region === 'ID') ?? shops[0];
    if (!shop) throw new Error('Akun ini belum punya toko yang memberi izin ke aplikasi.');
    // Satu toko hanya untuk satu proyek: webhook toko itu dicari lewat shop_id. Hanya tautan aktif yang
    // menghalangi; tautan kedaluwarsa atau dicabut di proyek lain tidak, dan baris itu dibiarkan apa adanya.
    const taken = await activeShopLinkByShopId(shop.id, project);
    if (taken) throw new TiktokError(`Toko ini sudah tertaut ke proyek ${taken.project}. Putuskan tautannya di sana dulu.`, -1);
    // Proyek ini tadinya tertaut ke toko lain (status apa pun): pesanan toko lama dihapus, karena webhook
    // pencabutan izin toko lama tidak lagi sampai ke sini sesudah barisnya ditimpa.
    const old = await getShopLink();
    if (old && old.shop_id !== shop.id) {
      const n = await deleteOrders(old.shop_id);
      console.log(`[toko] ${project}: toko ${old.shop_id} diganti ${shop.id}, ${n} pesanan toko lama dihapus`);
    }
    const link = await saveShopLink({
      shop_id: shop.id, shop_cipher: shop.cipher, shop_name: shop.name, region: shop.region, seller_name: t.sellerName, open_id: t.openId,
      access_token: t.accessToken, access_expires_at: t.accessExpiresAt, refresh_token: t.refreshToken, refresh_expires_at: t.refreshExpiresAt,
      granted_scopes: t.scopes, linked_at: at, last_sync_at: null, status: 'active', error: null, updated_at: at,
    });
    console.log(`[toko] ${project}: toko ${shop.name ?? shop.id} (${shop.region ?? '-'}) ditautkan`);
    return link;
  });
}

/**
 * Putuskan tautan toko proyek ini dari dashboard. Pesanan yang sudah masuk
 * tetap disimpan. Barisnya tidak dihapus: statusnya menjadi `unlinked`, dan
 * token serta cipher dikosongkan. Jadi webhook pencabutan izin (jenis 6)
 * dari toko ini tetap sampai ke proyek ini dan menghapus pesanan yang
 * disimpan itu. Halaman Pengaturan menganggapnya belum ditautkan; menautkan
 * lagi menimpa baris ini.
 */
export function unlinkShop(project: string, at = now()): Promise<void> {
  return inProject(project, async () => {
    const cut = await updateShopLink({ status: 'unlinked', access_token: '', refresh_token: '', shop_cipher: '', error: null, updated_at: at });
    if (cut) console.log(`[toko] ${project}: tautan toko diputus`);
  });
}

/** Token diperpanjang kalau berakhir dalam sekian lama. */
const REFRESH_AHEAD_MS = 24 * HOUR;

/**
 * Error perpanjangan yang berarti izinnya sendiri sudah tidak berlaku: kode
 * error dari endpoint token (mis. 36004004, refresh token salah atau
 * kedaluwarsa), selain rate limit dan selain HTTP 5xx. Jaringan putus, batas
 * waktu, HTTP 5xx, rate limit, dan jawaban yang tidak bisa dibaca hanya
 * gangguan sementara.
 */
function refreshRejected(e: unknown): boolean {
  if (!(e instanceof TiktokError) || e.code <= 0 || e.code === CODE_RATE_LIMIT) return false;
  return e.httpStatus === null || e.httpStatus < 500;
}

/**
 * Perpanjang token tautan aktif proyek ini kalau berakhir dalam 24 jam.
 * Izin ditolak endpoint token (atau masa izinnya sudah lewat): tautan
 * ditandai `expired` dengan pesan error-nya, dan pemilik diberi warning.
 * Gangguan sementara: tautan tetap `active`, error-nya dicatat, dan
 * putaran berikutnya mencoba lagi. True kalau tokennya diperpanjang.
 */
export async function refreshDueTokens(at = now()): Promise<boolean> {
  const link = await getShopLink();
  if (!link || link.status !== 'active' || link.access_expires_at >= at + REFRESH_AHEAD_MS) return false;
  try {
    await refreshToken(link, at);
    await updateShopLink({ error: null, updated_at: at });
    return true;
  } catch (e) {
    const msg = errText(e);
    if (!refreshRejected(e) && at <= link.refresh_expires_at) {
      await updateShopLink({ error: msg, updated_at: at });
      console.error(`[toko] perpanjangan token gagal sementara, dicoba lagi nanti: ${msg}`);
      return false;
    }
    await updateShopLink({ status: 'expired', error: msg, updated_at: at });
    console.error(`[toko] perpanjangan token gagal: ${msg}`);
    await raiseAlert('marketplace', `Token toko ${link.shop_name ?? link.shop_id} tidak bisa diperpanjang: ${msg}. Tautkan lagi dari Pengaturan > Tokopedia & Shop.`, { key: 'token' });
    return false;
  }
}

/**
 * Terapkan pesanan ke percakapannya. Resi: hanya dari pesanan yang sudah
 * dibayar (isPaid; pesanan batal, belum bayar, atau ditahan tidak mengisi
 * resi), dan diisi kalau percakapan belum punya resi, atau kalau nomor
 * pesanannya sama dan resinya berbeda; kurir dari nama kurir marketplace
 * (kurir lama tetap kalau namanya tidak dikenal). Tahap: naik menurut
 * stageTargets, hanya ke atas, "batal" tidak disentuh.
 */
export async function applyOrderToContact(order: OrderRow, contact: Contact, at = now()): Promise<Contact> {
  const phone = contact.phone;
  const awb = order.tracking_number;
  if (awb && isPaid(order.status) && (!contact.awb || (contact.order_ref === order.order_id && contact.awb !== awb))) {
    const courier = courierFromProvider(order.shipping_provider) ?? contact.courier;
    await setStageNote(phone, { awb, courier }, at);
    console.log(`[toko] ${phone}: resi ${awb} dari pesanan ${order.order_id}`);
  }
  let stage = ((await getContact(phone)) ?? contact).stage;
  for (const t of stageTargets(order.status)) {
    if (await advanceStage(phone, t.from, t.to)) {
      console.log(`[toko] ${phone}: tahap ${stage} -> ${t.to} (${order.status})`);
      stage = t.to;
    }
  }
  return (await getContact(phone)) ?? contact;
}

/**
 * Cocokkan pesanan ke percakapan: yang sudah ditautkan tetap; yang belum,
 * dicari lewat nomor pesanan (`order_ref`). Lalu terapkan. Mengembalikan
 * baris pesanannya sesudahnya, atau null kalau pesanannya sudah dihapus
 * sementara itu (mis. izin toko dicabut).
 */
export async function matchOrder(row: OrderRow, at = now()): Promise<OrderRow | null> {
  let contact = row.contact_phone ? await getContact(row.contact_phone) : undefined;
  if (!contact) {
    contact = await contactByOrderRef(row.order_id);
    if (!contact) return row;
    const linked = await setOrderContact(row.order_id, contact.phone);
    // Pesanannya sudah dihapus: tidak ada yang diterapkan ke percakapan.
    if (!linked) return null;
    row = linked;
  }
  await applyOrderToContact(row, contact, at);
  return row;
}

/** Simpan satu pesanan dari API lalu cocokkan ke percakapannya. Null kalau tidak ada yang disimpan. */
export async function upsertOrder(raw: RawOrder, shopId: string, at = now()): Promise<OrderRow | null> {
  const input = normalizeOrder(raw, shopId, at);
  if (!input.order_id) return null;
  const row = await upsertOrderRow(input);
  // Data lama yang tidak menimpa, dan baris tersimpannya sudah dihapus sementara itu: tidak ada yang disimpan.
  return row ? matchOrder(row, at) : null;
}

/**
 * Tautan pesanan oleh staf dari halaman Pesanan: percakapan `phone` mendapat
 * nomor pesanan ini (boleh menimpa), lalu pesanannya diterapkan. `phone` null
 * = lepas: nomor pesanan di percakapan lama ikut dikosongkan, supaya sinkron
 * berikutnya tidak menautkannya lagi. Undefined kalau pesanannya tidak ada
 * (juga kalau hilang di tengah jalan) atau percakapannya tidak ada.
 */
export async function linkOrderToContact(orderId: string, phone: string | null, at = now()): Promise<OrderRow | undefined> {
  const order = await getOrder(orderId);
  if (!order) return undefined;
  const prev = order.contact_phone;
  if (prev && prev !== phone) {
    const old = await getContact(prev);
    if (old?.order_ref === orderId) await setStageNote(prev, { order_ref: null }, at);
  }
  if (!phone) return setOrderContact(orderId, null);
  const contact = await getContact(phone);
  if (!contact) return undefined;
  // Nomor pesanan percakapan ini diganti: pesanan lain yang tertaut ke sini dilepas.
  await detachOrdersExcept(phone, orderId);
  const row = await setOrderContact(orderId, phone);
  // Pesanannya hilang sementara itu (mis. izin toko dicabut): tidak ada yang diterapkan.
  if (!row) return undefined;
  const updated = (await setStageNote(phone, { order_ref: orderId }, at)) ?? contact;
  await applyOrderToContact(row, updated, at);
  console.log(`[toko] ${phone}: pesanan ${orderId} ditautkan staf`);
  return row;
}

/**
 * Nomor pesanan diisi, diganti, atau dikosongkan di percakapan (oleh staf,
 * atau ditangkap bot dari chat). Pesanan lain yang tertaut ke percakapan ini
 * dilepas dulu, supaya pesanan lama tidak lagi mengubah resi dan tahapnya.
 * Lalu, kalau pesanan dengan nomor ini sudah ada, tautkan dan terapkan.
 *
 * Pesanan yang tadinya tertaut ke percakapan lain: dari staf (`byStaff`,
 * bawaan) pesanannya pindah ke sini dan nomor pesanan di percakapan lain itu
 * dikosongkan, supaya dua percakapan tidak memegang nomor yang sama. Dari
 * chat (`byStaff: false`) tidak: nomor yang diketik pelanggan tidak boleh
 * merebut pesanan percakapan lain, jadi diabaikan. Null kalau tidak ada yang
 * ditautkan (nomor kosong, pesanannya belum ada, atau diabaikan).
 */
export async function onOrderRefChanged(
  phone: string, orderRef: string | null, at = now(), opts: { byStaff?: boolean } = {}
): Promise<OrderRow | null> {
  const ref = orderRef?.trim() || null;
  const detached = await detachOrdersExcept(phone, ref);
  if (detached) console.log(`[toko] ${phone}: ${detached} pesanan lama dilepas (nomor pesanan ${ref ? `diganti ke ${ref}` : 'dikosongkan'})`);
  if (!ref) return null;
  const order = await getOrder(ref);
  if (!order) return null;
  const contact = await getContact(phone);
  if (!contact) return null;
  const prev = order.contact_phone;
  if (prev && prev !== phone) {
    if (opts.byStaff === false) {
      console.log(`[toko] ${phone}: pesanan ${ref} sudah tertaut ke percakapan lain, diabaikan`);
      return null;
    }
    const old = await getContact(prev);
    if (old?.order_ref === ref) await setStageNote(prev, { order_ref: null }, at);
  }
  const row = order.contact_phone === phone ? order : await setOrderContact(ref, phone);
  // Pesanannya hilang sementara itu (mis. izin toko dicabut): tidak ada yang diterapkan.
  if (!row) return null;
  await applyOrderToContact(row, contact, at);
  return row;
}

/** Webhook dari TikTok (badannya sudah diperiksa tanda tangannya). */
export interface WebhookEvent {
  type?: unknown;
  tts_notification_id?: unknown;
  shop_id?: unknown;
  timestamp?: unknown;
  data?: unknown;
}

/**
 * Tautan yang dibaca ulang sesudah menunggu jawaban API masih tautan toko
 * yang sama: ada, tidak dicabut (`revoked`), tidak diputus dari dashboard
 * (`unlinked`), dan shop_id-nya sama. Kalau tidak, pesanan dari jawaban itu
 * tidak disimpan.
 */
function sameShop(current: ShopLink | undefined, shopId: string): boolean {
  return Boolean(current && current.status !== 'revoked' && current.status !== 'unlinked' && current.shop_id === shopId);
}

/**
 * Pencabutan izin (jenis 6) ini mengenai tautan sekarang: shop_id-nya sama,
 * dan pencabutannya tidak lebih tua dari tautan itu. Pencabutan yang
 * dikirim ulang sesudah pemilik menautkan toko lagi sudah basi. Dibandingkan
 * per detik (timestamp webhook dalam detik). Tanpa timestamp: waktu
 * webhook ini pertama masuk (`receivedAt`, ms, dari catatan
 * `webhook_events`) dipakai sebagai waktunya, jadi pencabutan yang masuk
 * sebelum toko ditautkan lagi tetap basi.
 */
function revokesLink(link: ShopLink, shopId: string | null, timestamp: unknown, receivedAt: number): boolean {
  if (!shopId || link.shop_id !== shopId) return false;
  const given = Number(timestamp);
  const known = timestamp !== undefined && timestamp !== null && timestamp !== '' && Number.isFinite(given);
  const sec = known ? given : Math.floor(receivedAt / 1000);
  return sec >= Math.floor(link.linked_at / 1000);
}

/** Proyek pemilik toko ini, dari tautan tokonya (juga yang diputus dari dashboard); null kalau tidak dikenal. */
export async function webhookProject(shopId: unknown): Promise<string | null> {
  const id = txt(shopId);
  return id ? ((await shopLinkByShopId(id))?.project ?? null) : null;
}

/**
 * 'menunggu' = pesanannya belum terbaca dari API: webhook-nya disimpan dan
 * dicoba lagi oleh putaran berkala (lihat retryWebhooks).
 */
export type WebhookResult = 'ganda' | 'pesanan' | 'menunggu' | 'diputus' | 'akan-berakhir' | 'diabaikan';

const DAY = 24 * HOUR;

/** Webhook yang gagal dicoba lagi paling banyak sekian kali; pencabutan izin (jenis 6) dicoba terus sampai berhasil. */
export const MAX_WEBHOOK_TRIES = 10;
/** Webhook yang dicoba lagi per proyek per putaran. */
const RETRY_PER_ROUND = 20;

/** Id webhook yang sedang diproses di proses ini: kiriman kedua yang datang bersamaan dilewati. */
const webhooksInFlight = new Set<string>();

/**
 * Pencabutan izin per proyek, dihitung naik di proses ini. syncOrders dan
 * webhook jenis 1 membandingkan angkanya sebelum dan sesudah menyimpan pesanan, supaya
 * pesanan yang disimpan selagi izin dicabut dihapus lagi (pemutusan manual
 * dari dashboard tidak dihitung: pesanannya memang disimpan).
 */
const deauthCount = new Map<string, number>();

/**
 * Sesudah pesanan dari API disimpan: izin toko ini dicabut selagi itu, jadi
 * pesanannya harus dihapus lagi. Benar kalau ada pencabutan izin yang
 * dihitung sejak `deauthBefore`, atau tautannya hilang, dicabut (`revoked`),
 * atau sudah untuk toko lain. Diputus dari dashboard (`unlinked`) saja tidak:
 * pemutusan manual menyimpan pesanannya, dan pencabutan izin sesudahnya tetap
 * sampai ke proyek ini.
 */
async function revokedDuringSave(project: string, shopId: string, deauthBefore: number): Promise<boolean> {
  if ((deauthCount.get(project) ?? 0) !== deauthBefore) return true;
  const current = await getShopLink();
  return !current || current.status === 'revoked' || current.shop_id !== shopId;
}

/** Hanya untuk tes: dijalankan sesudah pesanan disimpan, sebelum pemeriksaan pencabutan izin. */
let afterSave: (() => Promise<void>) | null = null;
export function setAfterSaveHook(fn: (() => Promise<void>) | null): void {
  afterSave = fn;
}

/**
 * Id webhook: `tts_notification_id`; kalau tidak ada, sha256 dari isinya
 * (jenis, toko, waktu, data), supaya kiriman ulang yang sama mendapat id yang
 * sama. Tidak pernah dari jam sekarang.
 */
export function webhookId(event: WebhookEvent): string {
  const id = txt(event.tts_notification_id);
  if (id) return id;
  const raw = JSON.stringify([event.type ?? null, event.shop_id ?? null, event.timestamp ?? null, event.data ?? null]);
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}

/**
 * Tangani satu webhook untuk proyek ini (tes dan pemanggil tanpa catatan
 * lebih dulu). Sama dengan processWebhook dengan id dari webhookId.
 * Jenis 1 (status pesanan berubah): detail pesanan diambil lalu disimpan dan
 * dicocokkan; tidak disimpan kalau tautannya tidak aktif, atau dicabut atau
 * diputus selagi pesanan diambil, dan dihapus lagi kalau izin dicabut
 * selagi disimpan. Jenis 6 (toko mencabut izin): semua pesanan toko ini dan
 * semua tautannya dihapus di semua proyek (syarat developer TikTok), juga
 * sesudah tautan diputus dari dashboard; pemilik proyek ini diberi warning.
 * Pencabutan untuk toko lain, atau yang lebih tua dari tautan sekarang,
 * diabaikan. Jenis 7 (izin akan berakhir): warning, kecuali tautannya sudah
 * diputus dari dashboard. Jenis lain hanya dicatat di log.
 */
export function handleWebhook(project: string, event: WebhookEvent, at = now()): Promise<WebhookResult> {
  return processWebhook(project, event, webhookId(event), at);
}

/**
 * Simpan webhook yang baru masuk sebagai menunggu, SEBELUM server menjawab
 * 200 (lihat receiveWebhookEvent). `state` 'baru' = server memprosesnya
 * sesudah menjawab (processWebhook); 'selesai' = kiriman ganda dari webhook
 * yang sudah selesai, dilewati; 'menunggu' = id ini sudah menunggu (sedang
 * diproses atau menunggu putaran berkala), jadi tidak diproses dua kali.
 */
export async function receiveWebhook(
  project: string, event: WebhookEvent, at = now()
): Promise<{ id: string; state: 'baru' | 'selesai' | 'menunggu' }> {
  const id = webhookId(event);
  const type = Number(event.type);
  const state = await receiveWebhookEvent(project, id, Number.isFinite(type) ? type : 0, event as Record<string, unknown>, at);
  return { id, state };
}

/**
 * Proses satu webhook dengan id-nya: jalur server sesudah menjawab 200
 * (receiveWebhook), jalur putaran berkala (retryWebhooks), dan handleWebhook
 * memakai fungsi ini. Kiriman ganda (id yang sudah selesai diproses, atau
 * yang sedang diproses di proses ini) dilewati. Kalau gagal (atau
 * pesanannya belum terbaca), isi webhook tetap disimpan di
 * `webhook_events.pending` dan putaran berkala mencobanya lagi; berhasil =
 * `pending` dikosongkan.
 */
export function processWebhook(project: string, event: WebhookEvent, eventId: string, at = now()): Promise<WebhookResult> {
  // Dicatat sedang diproses sebelum menunggu apa pun, supaya pemrosesan kedua yang datang bersamaan tidak ikut lolos.
  if (webhooksInFlight.has(eventId)) return Promise.resolve('ganda');
  webhooksInFlight.add(eventId);
  return inProject(project, () => runWebhook(project, eventId, event, at)).finally(() => webhooksInFlight.delete(eventId));
}

async function runWebhook(project: string, id: string, event: WebhookEvent, at: number): Promise<WebhookResult> {
  const type = Number(event.type);
  const kind = Number.isFinite(type) ? type : 0;
  const stored = await getWebhookEvent(id);
  if (stored && stored.pending === null) return 'ganda';
  // Waktu webhook ini pertama masuk: dari catatannya kalau ada, selain itu sekarang.
  const receivedAt = stored?.at ?? at;
  let result: WebhookResult;
  try {
    result = await applyWebhook(project, kind, event, at, receivedAt);
  } catch (e) {
    await rememberFailure(project, id, kind, event, errText(e), at);
    throw e;
  }
  if (result === 'menunggu') await rememberFailure(project, id, kind, event, 'Pesanan belum terbaca dari Tokopedia & Shop.', at);
  else await finishWebhookEvent(id, kind, at);
  return result;
}

/** Simpan webhook yang gagal untuk dicoba lagi. Gagal menyimpan pun hanya dicatat di log (error aslinya yang dilempar). */
async function rememberFailure(project: string, id: string, type: number, event: WebhookEvent, msg: string, at: number): Promise<void> {
  try {
    const tries = await failWebhookEvent(id, type, event as Record<string, unknown>, msg, at);
    if (tries >= MAX_WEBHOOK_TRIES && type !== 6) {
      console.error(`[toko] ${project}: webhook ${id} (jenis ${type}) menyerah sesudah ${tries} percobaan: ${msg}`);
    }
  } catch (e) {
    console.error(`[toko] ${project}: webhook ${id} gagal dicatat untuk dicoba lagi: ${errText(e)}`);
  }
}

/**
 * Coba lagi webhook proyek ini yang tadinya gagal (atau pesanannya belum
 * terbaca): terlama dulu, paling banyak 20 per putaran. Sesudah 10
 * percobaan webhook itu tidak dicoba lagi, kecuali pencabutan izin (jenis 6),
 * yang dicoba terus sampai berhasil. Mengembalikan jumlah yang berhasil.
 */
export function retryWebhooks(project: string, at = now()): Promise<number> {
  return inProject(project, async () => {
    let done = 0;
    for (const row of await pendingWebhookEvents(RETRY_PER_ROUND, MAX_WEBHOOK_TRIES)) {
      try {
        const result = await processWebhook(project, row.pending as WebhookEvent, row.id, at);
        if (result !== 'menunggu' && result !== 'ganda') done += 1;
        console.log(`[toko] ${project}: webhook ${row.id} dicoba lagi (percobaan ${row.tries + 1}): ${result}`);
      } catch (e) {
        console.error(`[toko] ${project}: webhook ${row.id} gagal lagi: ${errText(e)}`);
      }
    }
    return done;
  });
}

/** Isi satu webhook (sesudah pemeriksaan kiriman ganda), di proyeknya. */
async function applyWebhook(project: string, type: number, event: WebhookEvent, at: number, receivedAt: number): Promise<WebhookResult> {
  const data = obj(event.data);
  if (type === 1) {
    const orderId = txt(data.order_id);
    const link = await getShopLink();
    if (!orderId || !link) return 'diabaikan';
    // Tautan kedaluwarsa atau dicabut: token tidak berlaku, jadi API tidak dipanggil. Sinkron sesudah ditautkan lagi mengejarnya.
    if (link.status !== 'active') {
      console.log(`[toko] ${project}: pesanan ${orderId} berubah, tapi tautan toko ${link.status}; diabaikan`);
      return 'diabaikan';
    }
    const deauthBefore = deauthCount.get(project) ?? 0;
    const raws = await fetchOrders(link, [orderId]);
    // Izin dicabut atau tautan diputus selagi pesanan diambil: jangan simpan pesanan toko itu.
    if (!sameShop(await getShopLink(), link.shop_id)) {
      console.log(`[toko] ${project}: tautan toko diputus selagi pesanan ${orderId} diambil, pesanan tidak disimpan`);
      return 'diabaikan';
    }
    // Pesanannya belum ada di jawaban API: disimpan sebagai menunggu, putaran berikutnya mencoba lagi.
    if (!raws.some((raw) => txt(raw.id) === orderId)) {
      console.log(`[toko] pesanan ${orderId} belum terbaca, dicoba lagi putaran berikutnya`);
      return 'menunggu';
    }
    for (const raw of raws) await upsertOrder(raw, link.shop_id, at);
    await afterSave?.();
    // Izin dicabut (atau toko diganti) selagi pesanan disimpan: hapus lagi pesanan toko itu (yang baru saja disimpan ikut terhapus).
    if (await revokedDuringSave(project, link.shop_id, deauthBefore)) {
      const removed = await deleteOrders(link.shop_id);
      console.log(`[toko] ${project}: izin toko ${link.shop_id} dicabut atau tokonya diganti selagi pesanan ${orderId} disimpan, ${removed} pesanan dihapus lagi`);
      return 'diabaikan';
    }
    console.log(`[toko] ${project}: pesanan ${orderId} berubah (${data.order_status ? normStatus(data.order_status) : '-'})`);
    return 'pesanan';
  }
  if (type === 6) {
    const link = await getShopLink();
    const shopId = txt(event.shop_id);
    if (!link || !revokesLink(link, shopId, event.timestamp, receivedAt)) {
      console.log(`[toko] ${project}: pencabutan izin untuk toko ${shopId ?? '-'} tidak cocok dengan tautan sekarang, diabaikan`);
      return 'diabaikan';
    }
    // Izinnya untuk toko, bukan untuk proyek: pesanan dan tautan toko ini dihapus di semua proyek (juga tautan
    // yang diputus dari dashboard di proyek lain), dalam satu transaksi. Gagal = tidak ada yang terhapus, dicoba lagi.
    const gone = await deleteShopEverywhere(link.shop_id);
    // Sinkron dan webhook jenis 1 yang sedang berjalan di proyek-proyek itu menghapus lagi pesanan yang mereka simpan.
    for (const p of new Set([project, ...gone.projects])) deauthCount.set(p, (deauthCount.get(p) ?? 0) + 1);
    const n = gone.orders;
    console.log(`[toko] ${project}: toko ${link.shop_id} mencabut izin, ${n} pesanan dihapus di proyek ${gone.projects.join(', ') || '-'}`);
    await raiseAlert(
      'marketplace',
      `Toko ${link.shop_name ?? link.shop_id} memutus tautan dengan Alice di Tokopedia & Shop. ${n} pesanan toko ini dihapus. Tautkan lagi dari Pengaturan > Tokopedia & Shop kalau masih dipakai.`,
      { key: 'revoked' }
    );
    return 'diputus';
  }
  if (type === 7) {
    // Tautan sudah diputus dari dashboard (atau tidak ada lagi): tidak ada yang perlu ditautkan lagi.
    const link = await getShopLink();
    if (!link || link.status === 'unlinked') {
      console.log(`[toko] ${project}: izin akan berakhir, tapi tautan toko sudah diputus; diabaikan`);
      return 'diabaikan';
    }
    const until = secToMs(data.expiration_time);
    const days = until ? Math.max(0, Math.ceil((until - at) / DAY)) : null;
    await raiseAlert(
      'marketplace',
      `Tautan toko berakhir dalam ${days ?? 'beberapa'} hari. Minta pemilik toko menautkan lagi dari Pengaturan > Tokopedia & Shop.`,
      { key: 'expiring' }
    );
    return 'akan-berakhir';
  }
  console.log(`[toko] ${project}: webhook jenis ${String(event.type)} diabaikan`);
  return 'diabaikan';
}

/** Sinkron pertama mengambil pesanan sekian hari ke belakang. */
const FIRST_SYNC_MS = 30 * DAY;

/** Hasil syncOrders. `skipped` = sinkron lain untuk proyek ini masih berjalan, jadi yang ini tidak dijalankan. */
export interface SyncResult {
  synced: number;
  error: string | null;
  skipped?: boolean;
}

/** Proyek yang sinkron pesanannya sedang berjalan di proses ini. */
const syncsInFlight = new Set<string>();

/** Sinkron pesanan proyek ini sedang berjalan. */
export const syncRunning = (project: string): boolean => syncsInFlight.has(project);

/**
 * Ambil pesanan yang berubah sejak sinkron terakhir (dikurangi 1 jam untuk
 * jaga-jaga; sinkron pertama 30 hari ke belakang), simpan, dan cocokkan.
 * Kalau terpotong di MAX_PAGES, `last_sync_at` = waktu ubah terbaru yang
 * terbaca dikurangi 1 ms, jadi putaran berikutnya melanjutkan. Error dicatat
 * di tautan (`error`), bukan dilempar; berhasil = error dikosongkan.
 *
 * Satu sinkron per proyek pada satu waktu (sinkron pertama sesudah
 * menautkan, tombol "Sinkron sekarang", dan putaran berkala): pemanggil
 * kedua langsung mendapat `{ synced: 0, skipped: true }`.
 */
export function syncOrders(project: string, at = now()): Promise<SyncResult> {
  if (syncsInFlight.has(project)) {
    console.log(`[toko] ${project}: sinkron masih berjalan, yang ini dilewati`);
    return Promise.resolve({ synced: 0, error: null, skipped: true });
  }
  syncsInFlight.add(project);
  return inProject(project, () => runSync(project, at)).finally(() => syncsInFlight.delete(project));
}

async function runSync(project: string, at: number): Promise<SyncResult> {
  const link = await getShopLink();
  if (!link || link.status !== 'active') return { synced: 0, error: 'Toko belum ditautkan.' };
  const deauthBefore = deauthCount.get(project) ?? 0;
  try {
    const found = await searchOrders(link, (link.last_sync_at ?? at - FIRST_SYNC_MS) - HOUR);
    // Izin dicabut (atau tautan diputus) selagi pesanan diambil: jangan simpan pesanan toko itu lagi.
    if (!sameShop(await getShopLink(), link.shop_id)) {
      console.log(`[toko] ${project}: tautan toko diputus selagi sinkron, pesanan tidak disimpan`);
      return { synced: 0, error: null };
    }
    let n = 0;
    for (const raw of found.orders) if (await upsertOrder(raw, link.shop_id, at)) n += 1;
    await afterSave?.();
    // Izin dicabut (atau toko diganti) selagi pesanan disimpan: hapus lagi pesanan toko itu (yang baru saja disimpan ikut terhapus).
    if (await revokedDuringSave(project, link.shop_id, deauthBefore)) {
      const removed = await deleteOrders(link.shop_id);
      console.log(`[toko] ${project}: izin toko ${link.shop_id} dicabut atau tokonya diganti selagi sinkron, ${removed} pesanan dihapus lagi`);
      return { synced: 0, error: null };
    }
    // Nomor pesanan yang dicatat sebelum pesanannya masuk: cocokkan sekarang.
    const late = await unmatchedOrdersWithRef(500);
    for (const row of late) await matchOrder(row, at);
    if (late.length) console.log(`[toko] ${project}: ${late.length} pesanan lama dicocokkan ke percakapan`);
    // Terpotong di MAX_PAGES: putaran berikutnya mulai dari pesanan terbaru yang sudah terbaca (dikurangi 1 ms),
    // bukan dari sekarang, supaya pesanan di halaman yang belum terbaca tidak terlewat.
    let syncedTo: number | null = at;
    if (found.truncated) {
      const latest = Math.max(0, ...found.orders.map((raw) => secToMs(raw.update_time) ?? 0));
      syncedTo = latest > 0 ? latest - 1 : link.last_sync_at;
      console.warn(`[toko] sinkron terpotong di ${found.pages} halaman, dilanjutkan putaran berikutnya`);
    }
    await updateShopLink({ last_sync_at: syncedTo, error: null, updated_at: at });
    if (n) console.log(`[toko] ${project}: ${n} pesanan disinkronkan`);
    return { synced: n, error: null };
  } catch (e) {
    const msg = errText(e);
    await updateShopLink({ error: msg, updated_at: at });
    console.error(`[toko] ${project}: sinkron gagal: ${msg}`);
    return { synced: 0, error: msg };
  }
}

/** Satu putaran sedang berjalan: putaran berikutnya dilewati. */
let roundBusy = false;

/**
 * Putaran berkala dashboard (tiap 15 menit, lihat startAdmin): untuk tiap
 * proyek dengan tautan toko yang aktif, perpanjang token yang hampir
 * berakhir, coba lagi webhook yang tadinya gagal, lalu sinkronkan pesanan.
 * Proyek yang hanya punya webhook yang menunggu (mis. pencabutan izin yang
 * gagal di tengah jalan) juga diproses, tanpa sinkron. Mati tanpa app key dan
 * secret. Hanya satu putaran berjalan pada satu waktu. Mengembalikan jumlah
 * proyek yang diproses.
 */
export async function shopRound(at = now()): Promise<number> {
  if (!tiktokEnabled() || roundBusy) return 0;
  roundBusy = true;
  let n = 0;
  try {
    const active = new Set((await activeShopLinks()).map((l) => l.project));
    const projects = [...new Set([...active, ...(await pendingWebhookProjects(MAX_WEBHOOK_TRIES))])].sort();
    for (const project of projects) {
      try {
        await inProject(project, async () => {
          if (active.has(project)) await refreshDueTokens(at);
          await retryWebhooks(project, at);
          if (active.has(project)) await syncOrders(project, at);
        });
        n += 1;
      } catch (e) {
        console.error(`[toko] putaran gagal: ${project}: ${errText(e)}`);
      }
    }
  } catch (e) {
    console.error(`[toko] putaran gagal: ${errText(e)}`);
  } finally {
    roundBusy = false;
  }
  return n;
}
