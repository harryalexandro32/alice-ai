/**
 * Pesanan dan resi per percakapan.
 *
 * - `parseOrderHints`: menangkap nomor pesanan (Tokopedia / TikTok Shop,
 *   invoice) dan nomor resi yang ditempel pelanggan di chat.
 * - `trackContact` / `runTracking`: menanyakan status kurir ke Binderbyte
 *   (https://docs.binderbyte.com/docs/resi), menyimpan hasilnya, dan menaikkan
 *   tahap lead ke "dikirim" atau "selesai". Tahap tidak pernah turun, dan
 *   "batal" tidak pernah disentuh.
 *
 * - `quotaState`: tarif, kuota gratis, dan saldo akun Binderbyte, untuk kartu
 *   biaya cek resi di dashboard dan warning saldo menipis.
 *
 * Tanpa BINDERBYTE_API_KEY, kolom pesanan tetap bisa dipakai; yang mati hanya
 * pengecekan status otomatis.
 */

import { raiseAlert } from './alerts';
import { cfg, HOUR } from './config';
import { localStamp, now } from './clock';
import { currentProject } from './project';
import {
  advanceStage, bumpTrackUsage, getContact, saveTracking, STAGES, trackingCandidates, trackUsageToday,
  type Contact, type ShipEvent, type Stage, type TrackCounts,
} from './store';

/** Kurir yang dikenal Binderbyte: kode untuk API, nama untuk dashboard. */
export const COURIERS: { code: string; label: string }[] = [
  { code: 'jne', label: 'JNE' },
  { code: 'jnt', label: 'J&T Express' },
  { code: 'sicepat', label: 'SiCepat' },
  { code: 'anteraja', label: 'AnterAja' },
  { code: 'ide', label: 'ID Express' },
  { code: 'ninja', label: 'Ninja Xpress' },
  { code: 'lion', label: 'Lion Parcel' },
  { code: 'spx', label: 'Shopee Express' },
  { code: 'pos', label: 'POS Indonesia' },
  { code: 'tiki', label: 'TIKI' },
  { code: 'sap', label: 'SAP Express' },
  { code: 'wahana', label: 'Wahana' },
  { code: 'kurir_tokopedia', label: 'Kurir Rekomendasi Tokopedia' },
  { code: 'gtl', label: 'GTL (GoTo Logistics)' },
  { code: 'jet', label: 'JET Express' },
  { code: 'rpx', label: 'RPX' },
  { code: 'first', label: 'First Logistics' },
  { code: 'kgx', label: 'KGX Express' },
  { code: 'jxe', label: 'JX Express' },
  { code: 'jnt_cargo', label: 'J&T Cargo' },
  { code: 'lex', label: 'LEX' },
  { code: 'indah_cargo', label: 'Indah Cargo' },
  { code: 'dakota', label: 'Dakota Cargo' },
  { code: 'pcp', label: 'PCP Express' },
  { code: 'rex', label: 'REX Express' },
];

const COURIER_CODES = new Set(COURIERS.map((c) => c.code));

export function isCourier(code: unknown): code is string {
  return typeof code === 'string' && COURIER_CODES.has(code);
}

// ---------------------------------------------------------------------------
// Menangkap nomor pesanan dan resi dari chat
// ---------------------------------------------------------------------------

/**
 * Nomor pesanan: id 18 digit TikTok Shop / Tokopedia (576… atau 577…), invoice
 * baru INV/20261125/MPL/1234567890, atau invoice lama INV/20200101/XX/I/123456.
 */
const ORDER_RE = /\b57[67]\d{15}\b|\bINV\/\d{8}\/MPL\/\d{6,12}(?!\d)|\bINV\/\d{8}\/[IVXLC]+\/[IVXLC]+\/\d{6,12}(?!\d)/i;

/** Resi Kurir Rekomendasi Tokopedia: kurirnya sudah pasti. */
const TKP_RE = /\bTKP01-[A-Z0-9]{5,12}\b|\bTKP\d{10}\b/i;

/**
 * Tebakan kurir dari kata di dekat resi (lihat COURIER_NEAR); urutan ini
 * menentukan yang menang.
 */
const COURIER_WORDS: [RegExp, string][] = [
  [/\bjne\b/i, 'jne'],
  [/\bj\s*&\s*t\b|\bjnt\b|\bj and t\b/i, 'jnt'],
  [/\bsi\s?cepat\b/i, 'sicepat'],
  [/\banteraja\b/i, 'anteraja'],
  [/\bid\s?express\b/i, 'ide'],
  [/\bninja\b/i, 'ninja'],
  [/\blion\b/i, 'lion'],
  [/\bspx\b|\bshopee express\b/i, 'spx'],
  [/(?<!kode\s)\bpos\b|\bpos indonesia\b|\bkantor pos\b/i, 'pos'],
  [/\btiki\b/i, 'tiki'],
  [/\bsap\b/i, 'sap'],
  [/\bwahana\b/i, 'wahana'],
  [/\bgtl\b/i, 'gtl'],
];

/** Nama kurir yang boleh terselip di antara kata "resi" dan nomornya ("resi J&T: JP…"). */
const COURIER_BETWEEN =
  'jne|j\\s*&\\s*t|jnt|j and t|si\\s?cepat|anteraja|id\\s?express|ninja(?: xpress)?|lion(?: parcel)?|spx|shopee express|pos(?: indonesia)?|tiki|sap|wahana|gtl';

/** Token yang berupa tanggal (2026-11-25 atau 25-11-2026, boleh diawali minus), tidak diikuti huruf, angka, atau minus lagi. */
const DATE_TOKEN = '-*(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}-\\d{1,2}-\\d{2,4})(?![A-Z0-9-])';

/**
 * Resi dengan kata kunci: "resi", "no. resi", "awb" (juga "resinya"), boleh
 * diikuti nama kurir, lalu ":", "#", atau "-", lalu 8 sampai 25 huruf/angka/minus
 * yang memuat paling sedikit satu angka. Angka polos tanpa kata kunci tidak
 * dianggap resi: nomor HP dan harga juga berbentuk begitu. Tanggal sesudah kata
 * kunci ("resi: 2026-11-25 baru dikirim", "resi 25-11-2026") juga bukan resi.
 */
const AWB_RE = new RegExp(
  `\\b(?:resi(?:nya)?|awb)\\b\\s*(?:(?:${COURIER_BETWEEN})\\b\\s*)?[:#-]?\\s*(?!${DATE_TOKEN})((?=[A-Z-]*\\d)[A-Z0-9-]{8,25})(?![A-Z0-9-])`,
  'i'
);

export interface OrderHints {
  orderRef?: string;
  awb?: string;
  courier?: string;
}

/**
 * Kurir hanya ditebak dari kata yang seluruhnya ada dalam sekian karakter
 * sebelum atau sesudah nomor resi. Nama jalan atau orang yang jauh dari resi
 * ("jalan lion no 5", "pak ninja") tidak dipakai.
 */
const COURIER_NEAR = 40;

/** Kurir pertama menurut urutan COURIER_WORDS yang muncul di dalam [start, end) teks. */
function courierNear(text: string, start: number, end: number): string | undefined {
  for (const [re, code] of COURIER_WORDS) {
    // Dicari di seluruh teks supaya \b dan "kode pos" tetap dinilai benar di tepi jendela.
    for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
      if (m.index >= start && m.index + m[0].length <= end) return code;
    }
  }
  return undefined;
}

/**
 * Nomor HP Indonesia (08…, 628…, +628…, atau 8… tanpa awalan): pelanggan
 * kadang menulis "resi" lalu nomor HP-nya, itu bukan resi. Diuji pada token
 * yang tanda minusnya sudah dibuang, jadi "0812-3456-7890" juga terbaca
 * sebagai nomor HP.
 */
const PHONE_TOKEN = /^(?:\+?62|0)?8\d{7,12}$/;
const isPhone = (token: string): boolean => PHONE_TOKEN.test(token.replace(/-/g, ''));

/**
 * Token sesudah "resi" yang seluruhnya berbentuk nomor pesanan ("resi
 * 576123456789012345"): itu nomor pesanan, bukan resi.
 */
const ORDER_TOKEN = new RegExp(`^(?:${ORDER_RE.source})$`, 'i');
const isOrderRef = (token: string): boolean => ORDER_TOKEN.test(token);

/** Nomor pesanan, resi, dan tebakan kurir dari satu pesan. Fungsi murni. */
export function parseOrderHints(text: string): OrderHints {
  const out: OrderHints = {};
  const order = text.match(ORDER_RE);
  if (order) out.orderRef = order[0];
  const tkp = text.match(TKP_RE);
  if (tkp) {
    out.awb = tkp[0].toUpperCase();
    out.courier = 'kurir_tokopedia';
    return out;
  }
  // Kecocokan pertama yang bukan nomor HP dan bukan nomor pesanan.
  const awb = [...text.matchAll(new RegExp(AWB_RE.source, 'gi'))].find((m) => m[1] && !isPhone(m[1]) && !isOrderRef(m[1]));
  if (awb?.[1] && awb.index !== undefined) {
    out.awb = awb[1].toUpperCase();
    // Nomor resi (grup 1) selalu ada di ujung kecocokan: sesudahnya hanya lookahead.
    const end = awb.index + awb[0].length;
    const guess = courierNear(text, end - awb[1].length - COURIER_NEAR, end + COURIER_NEAR);
    if (guess) out.courier = guess;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Status kurir
// ---------------------------------------------------------------------------

export type ShipPhase = 'delivered' | 'transit' | 'pending' | 'problem' | 'unknown';

/** Retur, batal, hilang, atau rusak: staf perlu melihat sendiri, tahap tidak diubah. */
const PROBLEM_RE = /\b(cancel\w*|dibatalkan|batal\w*|retur\w*|diretur|return\w*|dikembalikan|lost|hilang|rusak|damaged|undeliverable)\b/i;
/** Paket belum diambil kurir: pesanan baru dibuat atau menunggu pickup. Tahap belum naik ke "dikirim". */
const PENDING_RE =
  /\b(menunggu (pickup|penjemputan|kurir)|belum (dikirim|di ?pickup)|order (created|dibuat)|pesanan dibuat|manifested|manifest|awaiting pickup|pickup pending|ready (for|to) (pickup|ship))\b/i;
/** Sudah sampai ke penerima. Kata "diterima" atau "sampai" saja tidak cukup: paket juga "diterima di gudang sortir". */
const DELIVERED_RE =
  /\bdelivered\b|\bterkirim\b|\bditerima oleh\b|\bsudah diterima\b|\bsampai tujuan\b|\btelah diterima\b|\btiba di (alamat|tujuan)\b|\btelah tiba\b|\bsudah sampai\b|\bproof of delivery\b|\bselesai antar\b|\bpesanan selesai\b/i;
/**
 * Belum sampai walau ada kata "deliver", "terkirim", "diterima", "tiba", atau
 * "sampai": sedang diantar, gagal antar, belum, baru diterima di gudang, hub,
 * atau kantor, baru tiba atau sampai di hub atau gudang ("telah tiba di hub
 * Jakarta"), atau baru diterima oleh kurir, counter, atau agen saat pickup.
 */
const NOT_DELIVERED_RE =
  /\b(on|out for|attempt|fail|gagal|tidak|belum|not|un)\W{0,3}(deliver|terkirim|dikirim|diterima)|undelivered|delivery failed|\bditerima\s+di\b|\b(tiba|sampai)\s+di\s+(hub|gudang|warehouse|sorting|transit|kantor|counter|agen|gateway|drop ?point|pusat sortir)\b|\bditerima\s+oleh\s+(kurir|courier|driver|counter|agen|petugas|gudang|hub|sorting|drop ?point)\b|\breceived\s+(at|in|by\s+(courier|driver|counter|agent|hub|warehouse|gudang))\b/i;

/** Status kurir -> sudah sampai, masih di jalan, menunggu kurir, bermasalah, atau belum tahu. */
export function phaseOf(status: string | null | undefined): ShipPhase {
  if (!status || !status.trim()) return 'unknown';
  if (PROBLEM_RE.test(status)) return 'problem';
  if (PENDING_RE.test(status)) return 'pending';
  if (DELIVERED_RE.test(status) && !NOT_DELIVERED_RE.test(status)) return 'delivered';
  return 'transit';
}

/** Tautan cek resi untuk staf; cekresi.com selalu ada. */
export function trackingLinks(awb: string, courier: string): { label: string; url: string }[] {
  const id = encodeURIComponent(awb);
  const links = [{ label: 'cekresi.com', url: `https://cekresi.com/?noresi=${id}` }];
  if (courier === 'kurir_tokopedia') links.push({ label: 'Tokopedia', url: `https://www.tokopedia.com/kurir-rekomendasi?awb=${id}` });
  if (courier === 'gtl') links.push({ label: 'GTL', url: 'https://gtl.id/tracking' });
  return links;
}

export interface TrackResult {
  status: string;
  history: ShipEvent[];
}

/** Tanya status satu resi. Gagal = melempar Error dengan pesan yang bisa dibaca staf. */
export type Tracker = (q: { awb: string; courier: string; phoneLast5?: string }) => Promise<TrackResult>;

const MAX_HISTORY = 20;
const TIMEOUT_MS = 15_000;

/**
 * Error sebelum ada jawaban HTTP dari Binderbyte (waktu habis, DNS, atau
 * koneksi putus). Permintaan seperti ini tidak dihitung sebagai cek berbayar
 * dan tidak memakai batas harian. Jawaban HTTP dengan error (400, 403, 503)
 * tetap dihitung, karena Binderbyte bisa menagihnya.
 */
export class NetworkError extends Error {
  readonly network = true;
}

/** Error dari pelacak yang belum sampai ke Binderbyte (NetworkError atau objek dengan `network: true`). */
const isNetworkError = (e: unknown): boolean =>
  e instanceof NetworkError || (typeof e === 'object' && e !== null && (e as { network?: unknown }).network === true);

/** Pelacak bawaan: API Binderbyte. */
const binderbyte: Tracker = async ({ awb, courier, phoneLast5 }) => {
  const q = new URLSearchParams({ api_key: cfg.binderbyteKey, courier, awb });
  if (courier === 'jne' && phoneLast5) q.set('number', phoneLast5);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  let body: { status?: unknown; message?: unknown; data?: { summary?: { status?: unknown }; history?: unknown } } = {};
  let unreadable = false;
  try {
    res = await fetch(`https://api.binderbyte.com/v1/track?${q}`, { signal: ctl.signal });
    body = (await res.json().catch(() => {
      unreadable = true;
      return {};
    })) as typeof body;
  } catch (e) {
    if (ctl.signal.aborted) throw new NetworkError(`Binderbyte tidak menjawab dalam ${TIMEOUT_MS / 1000} detik.`);
    throw new NetworkError(`Binderbyte tidak bisa dihubungi: ${e instanceof Error ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
  // HTTP 200 tetapi isinya bukan JSON: pesan tersendiri, bukan "HTTP 200".
  if (res.status === 200 && unreadable) throw new Error('Jawaban Binderbyte tidak bisa dibaca.');
  if (res.status !== 200 || Number(body.status) !== 200) {
    throw new Error(typeof body.message === 'string' && body.message ? body.message : `HTTP ${res.status}`);
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
  const rows = Array.isArray(body.data?.history) ? (body.data.history as Record<string, unknown>[]) : [];
  return {
    status: str(body.data?.summary?.status),
    history: rows.slice(0, MAX_HISTORY).map((h) => ({ date: str(h?.date), desc: str(h?.desc), location: str(h?.location) })),
  };
};

let tracker: Tracker = binderbyte;
let injected = false;

/** Tes: ganti pelacaknya; null = kembali ke Binderbyte. */
export function setTracker(fn: Tracker | null): void {
  tracker = fn ?? binderbyte;
  injected = Boolean(fn);
}

/** Pelacakan otomatis menyala: API key Binderbyte diisi (atau tes memasang pelacak). */
export function trackingEnabled(): boolean {
  return Boolean(cfg.binderbyteKey) || injected;
}

/**
 * Bungkus pelacak supaya tiap panggilan dihitung di track_usage (otomatis atau
 * manual), berhasil maupun error. NetworkError (belum sampai ke Binderbyte)
 * tidak dihitung, dan `after` tidak dipanggil. Error saat mencatat hitungan
 * hanya masuk log: hasil pelacak dan ship_error tidak boleh berubah karenanya.
 * `after` menerima jumlah sesudahnya, atau null kalau pencatatan gagal.
 */
function counting(use: Tracker, day: string, kind: 'auto' | 'manual', after?: (n: TrackCounts | null) => void): Tracker {
  return async (q) => {
    let reached = true;
    try {
      return await use(q);
    } catch (e) {
      if (isNetworkError(e)) reached = false;
      throw e;
    } finally {
      if (reached) {
        try {
          // Dihitung dulu, terpisah: `after?.(…)` tidak menjalankan argumennya kalau `after` kosong.
          const counts = await bumpTrackUsage(day, kind);
          after?.(counts);
        } catch (e) {
          after?.(null);
          console.error(`[resi] catatan jatah harian gagal: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Akun Binderbyte: tarif, kuota gratis, dan saldo
// ---------------------------------------------------------------------------

/**
 * Keadaan akun Binderbyte (produk cek resi). `used` dan `limit` = kuota gratis
 * yang terpakai dan besarnya (limit 0 = kuota sudah habis), `price` = Rp per
 * cek sesudah kuota gratis, `balance` = saldo Rp, `at` = kapan dibaca.
 */
export type QuotaState = { used: number; limit: number; price: number; balance: number; at: number };

/** Membaca jawaban mentah GET /v1/checkQuota. Gagal = melempar Error dengan pesan yang bisa dibaca staf. */
export type QuotaFetcher = () => Promise<unknown>;

/** Keadaan akun dibaca ulang paling cepat sekali per jam. */
const QUOTA_TTL = HOUR;
/**
 * Sesudah satu pembacaan (berhasil maupun gagal), pembacaan otomatis berikutnya
 * paling cepat 10 menit lagi: API key salah atau Binderbyte mati tidak membuat
 * permintaan baru di tiap /state, /usage, atau putaran bot.
 */
const QUOTA_RETRY = 10 * 60_000;
const QUOTA_TIMEOUT_MS = 8_000;

/** Pembaca bawaan: API Binderbyte. */
const checkQuota: QuotaFetcher = async () => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), QUOTA_TIMEOUT_MS);
  let res: Response;
  let body: { message?: unknown } | null;
  try {
    res = await fetch(`https://api.binderbyte.com/v1/checkQuota?${new URLSearchParams({ api_key: cfg.binderbyteKey })}`, { signal: ctl.signal });
    body = (await res.json().catch(() => null)) as typeof body;
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(`Binderbyte tidak menjawab dalam ${QUOTA_TIMEOUT_MS / 1000} detik.`);
    throw new Error(`Binderbyte tidak bisa dihubungi: ${e instanceof Error ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
  if (!body) throw new Error(res.status === 200 ? 'Jawaban Binderbyte tidak bisa dibaca.' : `HTTP ${res.status}`);
  // Error dengan pesan dari Binderbyte: pesannya dipakai parseQuota.
  if (res.status !== 200 && !(typeof body.message === 'string' && body.message)) throw new Error(`HTTP ${res.status}`);
  return body;
};

/** Jawaban checkQuota -> angka. Semua angka dari Binderbyte berupa teks ("15", "10000.00"). */
function parseQuota(raw: unknown, at: number): QuotaState {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (Number(body.status) !== 200) {
    throw new Error(typeof body.message === 'string' && body.message ? body.message : 'Jawaban Binderbyte tidak bisa dibaca.');
  }
  const out = { used: Number(body.count), limit: Number(body.limit), price: Number(body.price), balance: Number(body.balance), at };
  if (![out.used, out.limit, out.price, out.balance].every(Number.isFinite)) throw new Error('Jawaban Binderbyte tidak bisa dibaca.');
  return out;
}

let quotaFetcher: QuotaFetcher = checkQuota;
let quotaInjected = false;
/** Keadaan terakhir yang berhasil dibaca (di memori proses; akunnya satu untuk semua proyek). */
let quota: QuotaState | null = null;
let quotaErr: string | null = null;
let quotaLoading: Promise<QuotaState | null> | null = null;
/** Waktu pembacaan terakhir dimulai (berhasil maupun gagal). */
let quotaTriedAt = -Infinity;

/** Tes: ganti pembaca akun; null = kembali ke Binderbyte. Keadaan yang tersimpan ikut dibuang. */
export function setQuotaFetcher(fn: QuotaFetcher | null): void {
  quotaFetcher = fn ?? checkQuota;
  quotaInjected = Boolean(fn);
  quota = null;
  quotaErr = null;
  quotaLoading = null;
  quotaTriedAt = -Infinity;
}

/** Akun bisa dibaca: pelacakan menyala dan ada API key (atau tes memasang pembaca). */
const quotaReady = (): boolean => trackingEnabled() && (Boolean(cfg.binderbyteKey) || quotaInjected);

/** Pesan error pembacaan akun yang terakhir; null kalau pembacaan terakhir berhasil. */
export function quotaError(): string | null {
  return quotaErr;
}

/**
 * Baca ulang keadaan akun sekarang dan tunggu hasilnya. Hanya satu pembacaan
 * berjalan pada satu waktu. Gagal: keadaan lama tetap dipakai dan pesannya
 * ada di quotaError(). Null kalau akun tidak bisa dibaca dan belum ada keadaan lama.
 */
export function refreshQuota(at = now()): Promise<QuotaState | null> {
  if (!quotaReady()) return Promise.resolve(null);
  if (quotaLoading) return quotaLoading;
  quotaTriedAt = at;
  const run = loadQuota(quotaFetcher, at);
  quotaLoading = run;
  void run.finally(() => {
    if (quotaLoading === run) quotaLoading = null;
  });
  return run;
}

/** Isi refreshQuota: tidak pernah melempar. */
async function loadQuota(use: QuotaFetcher, at: number): Promise<QuotaState | null> {
  try {
    const next = parseQuota(await use(), at);
    // Pembaca diganti selama menunggu (tes): hasilnya dibuang.
    if (use === quotaFetcher) {
      quota = next;
      quotaErr = null;
    }
  } catch (e) {
    if (use === quotaFetcher) quotaErr = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error(`[resi] saldo Binderbyte tidak terbaca: ${e instanceof Error ? e.message : e}`);
  }
  return quota;
}

/**
 * Perlu dibaca ulang: belum ada keadaan atau sudah lebih dari 1 jam, dan
 * pembacaan terakhir (juga yang gagal) sudah lebih dari 10 menit lalu.
 */
const quotaDue = (at: number): boolean => (!quota || at - quota.at >= QUOTA_TTL) && at - quotaTriedAt >= QUOTA_RETRY;

/**
 * Keadaan akun yang tersimpan, langsung (null kalau belum pernah terbaca).
 * Kalau sudah lebih dari 1 jam atau belum ada, satu pembacaan ulang dimulai
 * di latar belakang (paling cepat 10 menit sesudah pembacaan terakhir);
 * hasilnya dipakai pada panggilan berikutnya.
 */
export function quotaState(at = now()): Promise<QuotaState | null> {
  if (!quotaReady()) return Promise.resolve(null);
  if (quotaDue(at)) void refreshQuota(at);
  return Promise.resolve(quota);
}

/** Sisa kuota gratis; 0 kalau sudah habis. */
export const freeLeft = (q: QuotaState): number => Math.max(0, q.limit - q.used);

/** Tarif Rp per cek: dari akun kalau sudah terbaca dan lebih dari 0, selain itu TRACK_PRICE_IDR. */
export const trackPrice = (q: QuotaState | null): number =>
  q && Number.isFinite(q.price) && q.price > 0 ? q.price : cfg.trackPriceIdr;

/** Tahap yang masih boleh naik ke "dikirim". */
const BEFORE_SHIPPED: readonly Stage[] = ['baru', 'menunggu', 'dihubungi', 'link', 'payment'];
/** Tahap yang masih boleh naik ke "selesai". */
const BEFORE_DONE: readonly Stage[] = STAGES.filter((s) => s !== 'selesai' && s !== 'batal');

/**
 * Tahap tujuan menurut status kurir, dengan tahap asal yang boleh naik ke
 * sana; null kalau tahap tetap ("menunggu kurir", "bermasalah", dan "belum
 * tahu" tidak mengubah tahap). Hanya naik, "batal" tidak disentuh.
 */
function nextStage(status: string): { from: readonly Stage[]; to: Stage } | null {
  const phase = phaseOf(status);
  if (phase === 'delivered') return { from: BEFORE_DONE, to: 'selesai' };
  if (phase === 'transit') return { from: BEFORE_SHIPPED, to: 'dikirim' };
  return null;
}

/** 5 digit terakhir nomor penerima (verifikasi JNE); tidak ada untuk kontak "lid:…". */
function last5(phone: string): string | undefined {
  if (phone.startsWith('lid:')) return undefined;
  const d = phone.replace(/\D/g, '');
  return d.length >= 5 ? d.slice(-5) : undefined;
}

/**
 * Cek resi satu kontak dan simpan hasilnya. Tanpa resi atau kurir yang sah:
 * kontaknya dikembalikan apa adanya. Error dari pelacak dicatat di
 * `ship_error`; status, riwayat, dan tahap lama tidak diubah. Kalau resi atau
 * kurir berganti selama pengecekan, hasilnya dibuang.
 */
export async function trackContact(phone: string, at = now()): Promise<Contact | undefined> {
  // Cek manual (tombol "Cek resi"): dihitung di n_manual, tidak ikut batas harian.
  let counted = false;
  const out = await trackWith(counting(tracker, localStamp(at).slice(0, 10), 'manual', () => { counted = true; }), phone, at);
  // Cek manual yang sampai ke Binderbyte juga memeriksa saldo: dengan TRACK_DAILY_MAX=0,
  // atau tanpa resi untuk cek otomatis, pemilik tetap mendapat warning saldo menipis.
  // Di proses admin warning-nya hanya tercatat di dashboard; WhatsApp dikirim oleh proses bot.
  if (counted) await warnLowBalance(at);
  return out;
}

/** Isi trackContact dengan pelacak tertentu (pelacaknya sudah dibungkus untuk menghitung pemakaian harian). */
async function trackWith(use: Tracker, phone: string, at: number): Promise<Contact | undefined> {
  const c = await getContact(phone);
  if (!c || !c.awb || !isCourier(c.courier)) return c;
  // Hasil hanya disimpan kalau resi, kurir, dan awb_at di database masih sama.
  const expect = { awb: c.awb, courier: c.courier, awb_at: c.awb_at };
  const discard = (): Promise<Contact | undefined> => {
    console.log(`[resi] ${phone}: resi berubah selama pengecekan, hasil dibuang`);
    return getContact(phone);
  };
  let result: TrackResult;
  try {
    const phoneLast5 = c.courier === 'jne' ? last5(c.phone) : undefined;
    result = await use({ awb: c.awb, courier: c.courier, ...(phoneLast5 ? { phoneLast5 } : {}) });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (!(await saveTracking(phone, expect, { ship_checked_at: at, ship_error: msg }))) return discard();
    console.log(`[resi] ${phone}: cek ${c.awb} gagal: ${msg}`);
    return getContact(phone);
  }
  const saved = await saveTracking(phone, expect, {
    ship_status: result.status,
    ship_history: result.history.slice(0, MAX_HISTORY),
    ship_checked_at: at,
    ship_error: null,
    // Fase disimpan supaya trackingCandidates bisa memberi jeda 6 jam lewat SQL.
    ship_phase: phaseOf(result.status),
  });
  if (!saved) return discard();
  const updated = (await getContact(phone)) as Contact;
  // Tahap dinaikkan dengan UPDATE bersyarat atas tahap di database saat ini,
  // bukan tahap yang dibaca sebelum pelacak dipanggil: staf bisa mengubahnya
  // (misalnya ke "batal") selama menunggu jawaban kurir.
  const next = nextStage(result.status);
  if (!next || !(await advanceStage(phone, next.from, next.to, expect))) return updated;
  console.log(`[resi] ${phone}: tahap ${updated.stage} -> ${next.to} (${result.status})`);
  return getContact(phone);
}

/** Paling banyak sekian resi per putaran (Binderbyte bisa lambat: 15 detik per resi). */
const PER_RUN = 20;

/** Batas harian sudah dicatat di log untuk kunci <proyek>:<tanggal> ini (di memori; sesudah restart dicatat sekali lagi). */
let warnedKey = '';

/**
 * Putaran berkala (tiap 5 menit di src/app.ts): cek resi yang perlu dicek di
 * proyek ini, satu per satu. Tiap resi paling sering sekali per 30 menit
 * (6 jam kalau pengecekan terakhir error atau statusnya bermasalah), selama
 * 30 hari sejak diisi, dan paling banyak cfg.trackDailyMax resi per hari.
 * Batas harian tercapai, atau saldo Binderbyte menipis sesudah kuota gratis
 * habis: warning "resi" ke pemilik. Mengembalikan jumlah resi yang dicek.
 */
export async function runTracking(at = now()): Promise<number> {
  if (!trackingEnabled()) return 0;
  // TRACK_DAILY_MAX=0: cek otomatis dimatikan. Tombol "Cek resi" tetap bisa dipakai,
  // dan tidak ada log atau warning batas harian.
  if (cfg.trackDailyMax <= 0) return 0;
  const day = localStamp(at).slice(0, 10);
  const key = `${currentProject().id}:${day}`;
  // Hitungan harian ada di tabel track_usage, jadi tetap berlaku sesudah bot
  // dijalankan ulang. Dibaca sekali per putaran, lalu diikuti dari hasil bump.
  // Hanya cek otomatis yang dibatasi; cek manual tidak dihitung di sini.
  let used = (await trackUsageToday(day)).auto;
  let made = 0;
  const counted = counting(tracker, day, 'auto', (n) => {
    made += 1;
    // Pencatatan gagal: hitungan di memori tetap naik, supaya batas harian putaran ini tetap berlaku.
    used = n ? n.auto : used + 1;
  });
  let n = 0;
  for (const c of await trackingCandidates(at, PER_RUN)) {
    if (used >= cfg.trackDailyMax) {
      if (warnedKey !== key) {
        // Kunci per hari: masa tenang "resi" (24 jam) tidak menelan warning hari berikutnya.
        console.log(`[resi] batas cek resi harian tercapai (${used})`);
        await raiseAlert('resi', `Batas cek resi harian (${cfg.trackDailyMax}) tercapai. Cek otomatis berhenti sampai besok.`, { key: `batas:${day}` });
      }
      warnedKey = key;
      break;
    }
    try {
      await trackWith(counted, c.phone, at);
      n += 1;
    } catch (e) {
      console.error(`[resi] ${c.phone}: cek gagal: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (made > 0) await warnLowBalance(at);
  return n;
}

/**
 * Sesudah putaran atau cek manual yang memanggil Binderbyte: baca ulang akun kalau keadaannya
 * sudah lebih dari 1 jam (paling cepat 10 menit sesudah pembacaan terakhir,
 * juga yang gagal), lalu beri warning kalau kuota gratis habis dan
 * saldonya di bawah TRACK_BALANCE_MIN_IDR (paling sering sekali per 24 jam).
 */
async function warnLowBalance(at: number): Promise<void> {
  try {
    const q = quotaDue(at) ? await refreshQuota(at) : quota;
    if (!q || freeLeft(q) > 0 || q.balance >= cfg.trackBalanceMinIdr) return;
    const price = trackPrice(q);
    const left = price > 0 ? Math.floor(q.balance / price) : 0;
    const rp = (v: number): string => 'Rp' + Math.round(v).toLocaleString('id-ID');
    await raiseAlert('resi', `Saldo Binderbyte ${rp(q.balance)}, cukup untuk sekitar ${left.toLocaleString('id-ID')} cek lagi. Isi ulang di hub.binderbyte.com.`, { key: 'saldo' });
  } catch (e) {
    console.error(`[resi] pemeriksaan saldo Binderbyte gagal: ${e instanceof Error ? e.message : e}`);
  }
}
