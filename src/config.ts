/**
 * Semua pengaturan dari env, di satu tempat. Zona waktu TIDAK ditulis di
 * tempat lain: "jam 8 pagi" berarti apa pun yang BOT_TZ katakan.
 */

import 'dotenv/config';

const str = (k: string, d = ''): string => process.env[k]?.trim() || d;
const has = (k: string): boolean => Boolean(process.env[k]?.trim());
const num = (k: string, d: number): number => {
  const raw = process.env[k]?.trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) ? n : d;
};

/** "0812…" / "62812…" / "+62 812-…" -> "+62812…". Null kalau bukan nomor. */
export function normPhone(s: string): string | null {
  let d = s.replace(/[^0-9]/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}

const business = str('BUSINESS', 'gfan');
const transport = str('TRANSPORT', 'baileys').toLowerCase() === 'cloud' ? 'cloud' : 'baileys';

/**
 * Satu nomor sales. "self" = nomor bot itu sendiri (sales membalas dari
 * aplikasi WhatsApp di nomor yang sama). Kosong = tanpa notifikasi WA.
 */
function salesNumber(): string | null {
  const raw = str('SALES_NUMBER');
  if (!raw) return null;
  return raw.toLowerCase() === 'self' ? 'self' : normPhone(raw);
}

export const cfg = {
  business,
  transport: transport as 'baileys' | 'cloud',
  tz: str('BOT_TZ', 'Asia/Jakarta'),
  dbPath: str('DB_PATH', `./data/${business}.db`),
  /** Tempat profil hasil dashboard dan foto: <dataRoot>/<bisnis>/. */
  dataRoot: str('DATA_DIR', './data'),

  // Dashboard pemilik. Tanpa kata sandi, dashboard tidak dinyalakan.
  adminPassword: str('ADMIN_PASSWORD'),
  adminPort: num('ADMIN_PORT', 3100),
  adminHost: str('ADMIN_HOST', '127.0.0.1'),

  // Penyimpanan bersama untuk dashboard yang di-hosting terpisah (Vercel Blob).
  blobToken: str('BLOB_READ_WRITE_TOKEN'),
  blobAccess: (str('BLOB_ACCESS', 'private') === 'public' ? 'public' : 'private') as 'public' | 'private',

  llmApiKey: str('LLM_API_KEY'),
  llmBaseUrl: str('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
  llmModel: str('LLM_MODEL', 'deepseek-chat'),
  llmDailyLimit: num('LLM_DAILY_LIMIT', 1500),
  // Tarif untuk menghitung perkiraan biaya di dashboard: USD per 1 juta token.
  // Bawaan = tarif jam sibuk deepseek-flash (dicek 2026-11-11); di luar jam
  // sibuk tarifnya separuh, jadi angka di dashboard adalah batas atas.
  llmPriceIn: num('LLM_PRICE_IN', 0.3),
  llmPriceCached: num('LLM_PRICE_CACHED', 0.006),
  llmPriceOut: num('LLM_PRICE_OUT', 1.2),
  usdIdr: num('USD_IDR', 16_500),

  followupAfterHours: num('FOLLOWUP_AFTER_HOURS', 23),
  followupStartHour: num('FOLLOWUP_START_HOUR', 8),
  followupEndHour: num('FOLLOWUP_END_HOUR', 20),
  // Cloud API menolak teks bebas di luar 24 jam sejak pesan terakhir pelanggan,
  // jadi di sana batasnya otomatis 24. Baileys tidak punya jendela itu.
  followupMaxHours: has('FOLLOWUP_MAX_HOURS') ? num('FOLLOWUP_MAX_HOURS', 0) : transport === 'cloud' ? 24 : 0,
  followupMaxTotal: num('FOLLOWUP_MAX_TOTAL', 2),

  humanPauseHours: num('HUMAN_PAUSE_HOURS', 12),

  // Peringatan untuk pemilik lewat Telegram (opsional; lihat src/alerts.ts).
  telegramToken: str('TELEGRAM_BOT_TOKEN'),
  telegramChat: str('TELEGRAM_CHAT_ID'),

  salesNumber: salesNumber(),
  sheetId: str('SHEET_ID'),
  sheetTab: str('SHEET_TAB', 'Leads'),
  googleCredentials: str('GOOGLE_CREDENTIALS', './google-service-account.json'),

  // Mode uji: kalau diisi, bot HANYA melayani nomor-nomor ini. Dipakai waktu
  // mencoba di nomor yang sudah punya pelanggan sungguhan.
  onlyNumbers: str('ONLY_NUMBERS')
    .split(',')
    .map((s) => normPhone(s))
    .filter((s): s is string => Boolean(s)),
  maxInboundPerNumber: num('MAX_INBOUND_PER_NUMBER', 40),
  debounceMs: num('DEBOUNCE_MS', 4000),

  // Pengaman nomor di jalur Baileys (lihat transport/sendguard.ts). Per menit
  // hanya mengantre; per jam dan per 24 jam menolak kiriman berikutnya.
  waMaxPerMinute: num('WA_MAX_PER_MINUTE', 5),
  waMaxPerHour: num('WA_MAX_PER_HOUR', 100),
  waMaxPerDay: num('WA_MAX_PER_DAY', 800),

  // Baileys
  waAuthDir: str('WA_AUTH_DIR', './auth'),
  waPairingNumber: str('WA_PAIRING_NUMBER'),

  // Cloud API resmi (atau BSP yang meneruskan format yang sama)
  waApiBase: str('WA_API_BASE', 'https://graph.facebook.com/v23.0').replace(/\/+$/, ''),
  waPhoneNumberId: str('WA_PHONE_NUMBER_ID'),
  waToken: str('WA_TOKEN'),
  waAppSecret: str('WA_APP_SECRET'),
  waVerifyToken: str('WA_VERIFY_TOKEN'),
  waLeadTemplate: str('WA_LEAD_TEMPLATE'),
  waLeadTemplateLang: str('WA_LEAD_TEMPLATE_LANG', 'id'),
  port: num('PORT', 3000),
};

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
