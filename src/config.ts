/**
 * Semua pengaturan di satu tempat. Zona waktu TIDAK ditulis di tempat lain:
 * "jam 8 pagi" berarti apa pun yang BOT_TZ katakan.
 *
 * .env hanya memuat yang dipakai bersama semua proyek (database, LLM,
 * dashboard, SMTP). Yang khas satu bot (jalur WhatsApp, nomor
 * sales, nomor bot, mode uji, follow-up) ada di database, per proyek.
 */

import 'dotenv/config';

import { join } from 'node:path';

import type { Project } from './db/schema';
import { currentProject, maybeProject } from './project';

const str = (k: string, d = ''): string => process.env[k]?.trim() || d;
const has = (k: string): boolean => Boolean(process.env[k]?.trim());
const bool = (k: string, d: boolean): boolean => {
  const raw = process.env[k]?.trim().toLowerCase();
  return raw ? !['0', 'false', 'no', 'off', 'tidak'].includes(raw) : d;
};
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

/**
 * Satu nomor sales. "self" = nomor bot itu sendiri (sales membalas dari
 * aplikasi WhatsApp di nomor yang sama). Kosong = tanpa notifikasi WA.
 */
export function parseSalesNumber(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  return v.toLowerCase() === 'self' ? 'self' : normPhone(v);
}

const base = {
  tz: str('BOT_TZ', 'Asia/Jakarta'),
  /** postgres://…, pglite://<folder>, atau memory:// (lihat src/db/index.ts). */
  databaseUrl: str('DATABASE_URL'),
  /** Tempat foto dan PDF unggahan: <dataRoot>/<proyek>/media/. */
  dataRoot: str('DATA_DIR', './data'),
  /** Tempat sesi WhatsApp (Baileys): <authRoot>/<proyek>/. */
  authRoot: './auth',

  // Dashboard pemilik. Tanpa kata sandi, dashboard tidak dinyalakan.
  adminPassword: str('ADMIN_PASSWORD'),
  adminPort: num('ADMIN_PORT', 3100),
  adminHost: str('ADMIN_HOST', '127.0.0.1'),

  // Alamat lain yang boleh memakai dashboard ini lewat proxy (mis. Vercel):
  // "https://alice.lukicenturi.com". Host-nya sendiri selalu boleh.
  adminOrigins: str('ADMIN_ORIGINS').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),

  llmApiKey: str('LLM_API_KEY'),
  llmBaseUrl: str('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
  llmModel: str('LLM_MODEL', 'deepseek-chat'),
  llmDailyLimit: num('LLM_DAILY_LIMIT', 1500),
  // Pesan suara -> teks lewat layanan speech-to-text berformat OpenAI (opsional).
  sttBaseUrl: str('STT_BASE_URL').replace(/\/+$/, ''),
  sttApiKey: str('STT_API_KEY'),
  sttModel: str('STT_MODEL', 'whisper-large-v3'),
  sttLanguage: str('STT_LANGUAGE', 'id'),
  // Follow-up ditulis LLM menurut isi percakapannya (kalau mati: kalimat tetap).
  followupSmart: bool('FOLLOWUP_SMART', true),
  // Foto dari pelanggan ikut dikirim ke LLM untuk diamati (model harus bisa membaca gambar).
  llmVision: bool('LLM_VISION', true),
  // Pesan suara ditranskripsi (kalau STT_* diisi); bisa dimatikan per proyek di dashboard.
  transcribeVoice: true,
  // Tarif untuk menghitung perkiraan biaya di dashboard: USD per 1 juta token.
  // Bawaan = tarif jam sibuk deepseek-flash (dicek 2026-11-11); di luar jam
  // sibuk tarifnya separuh, jadi angka di dashboard adalah batas atas.
  llmPriceIn: num('LLM_PRICE_IN', 0.3),
  llmPriceCached: num('LLM_PRICE_CACHED', 0.006),
  llmPriceOut: num('LLM_PRICE_OUT', 1.2),
  usdIdr: num('USD_IDR', 16_500),

  // Follow-up dikirim setelah pelanggan diam selama waktu yang diacak di antara
  // dua angka ini (seperti jeda balasan), supaya tidak selalu tepat di jam yang sama.
  followupAfterHours: num('FOLLOWUP_AFTER_HOURS', 23),
  followupAfterHoursMax: num('FOLLOWUP_AFTER_HOURS_MAX', 25),
  followupStartHour: num('FOLLOWUP_START_HOUR', 8),
  followupEndHour: num('FOLLOWUP_END_HOUR', 20),
  // Cloud API menolak teks bebas di luar 24 jam sejak pesan terakhir pelanggan,
  // jadi di sana batasnya otomatis 24 (lihat projectCfg). Baileys tidak punya jendela itu.
  followupMaxHours: num('FOLLOWUP_MAX_HOURS', 0),
  followupMaxTotal: num('FOLLOWUP_MAX_TOTAL', 2),

  humanPauseHours: num('HUMAN_PAUSE_HOURS', 12),

  // Jam tenang: pesan yang masuk di antara dua jam ini tidak langsung dibalas,
  // tapi dibalas begitu jam tenang berakhir (lihat quiet.ts). Diatur per proyek.
  quietEnabled: true,
  quietStartHour: 0,
  quietEndHour: 7,

  // Warning untuk pemilik lewat email SMTP (opsional; lihat src/alerts.ts).
  // Rahasia: hanya di .env, tidak pernah di dashboard.
  smtpHost: str('SMTP_HOST'),
  smtpPort: num('SMTP_PORT', 465),
  smtpUser: str('SMTP_USER'),
  smtpPass: str('SMTP_PASS'),
  smtpFrom: str('SMTP_FROM'),
  alertEmailTo: str('ALERT_EMAIL_TO'),

  // Mode uji: kalau diisi, bot HANYA melayani nomor-nomor ini. Dipakai waktu
  // mencoba di nomor yang sudah punya pelanggan sungguhan. Diatur per proyek
  // di dashboard (Pengaturan).
  onlyNumbers: [] as string[],
  maxInboundPerNumber: num('MAX_INBOUND_PER_NUMBER', 40),
  debounceMs: num('DEBOUNCE_MS', 4000),

  // Pengaman nomor di jalur Baileys (lihat transport/sendguard.ts). Per menit
  // hanya mengantre; per jam dan per 24 jam menolak kiriman berikutnya.
  waMaxPerMinute: num('WA_MAX_PER_MINUTE', 5),
  waMaxPerHour: num('WA_MAX_PER_HOUR', 60),
  waMaxPerDay: num('WA_MAX_PER_DAY', 300),
  // Pemanasan antiban untuk nomor baru (7 hari, mulai 20 kiriman di hari
  // pertama). Matikan per proyek kalau nomornya sudah lama dipakai normal.
  waWarmup: true,

  // --- Per proyek (baris projects di database); nilai di sini hanya cadangan ---
  transport: 'baileys' as 'baileys' | 'cloud',
  /** Nomor sales: "+62…", "self", atau null. */
  salesNumber: null as string | null,
  /** Folder sesi WhatsApp proyek ini (Baileys): <authRoot>/<proyek>. */
  waAuthDir: './auth',
  /** Nomor bot; kalau diisi dan belum tertaut, bot meminta kode pairing. */
  waPairingNumber: '',

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

/**
 * Pengaturan yang boleh diubah pemilik dari dashboard (Pengaturan). Nilai di
 * .env adalah bawaannya; yang diisi di dashboard menimpanya selama bot jalan.
 * [minimum, maksimum] untuk angka.
 */
export const TUNABLE = {
  followupAfterHours: [1, 72], followupAfterHoursMax: [1, 96], followupStartHour: [0, 23], followupEndHour: [1, 24], followupMaxTotal: [0, 5],
  humanPauseHours: [1, 168], quietStartHour: [0, 23], quietEndHour: [1, 24], llmDailyLimit: [10, 100_000], maxInboundPerNumber: [5, 500],
  waMaxPerMinute: [1, 30], waMaxPerHour: [10, 1000], waMaxPerDay: [50, 10_000], debounceMs: [500, 20_000],
  llmPriceIn: [0, 100], llmPriceCached: [0, 100], llmPriceOut: [0, 100], usdIdr: [1000, 100_000],
} as const satisfies Partial<Record<keyof typeof base, readonly [number, number]>>;

export type TunableKey = keyof typeof TUNABLE;
export interface Settings extends Partial<Record<TunableKey, number>> {
  /** Foto dari pelanggan dianalisis LLM. */
  llmVision?: boolean;
  /** Follow-up ditulis LLM menurut isi percakapan. */
  followupSmart?: boolean;
  /** Pesan suara ditranskripsi lalu dijawab (butuh STT_* di .env bot). */
  transcribeVoice?: boolean;
  /** Mode uji: hanya nomor-nomor ini yang dilayani. Kosong = semua nomor. */
  onlyNumbers?: string[];
  /** Jam tenang dinyalakan (jamnya: quietStartHour sampai quietEndHour). */
  quietEnabled?: boolean;
  /** Pemanasan antiban 7 hari untuk nomor baru. */
  waWarmup?: boolean;
}

/** Kunci `cfg` yang nilainya milik proyek yang sedang dilayani, bukan .env. */
export const PROJECT_KEYS: ReadonlySet<string> = new Set([
  'transport', 'salesNumber', 'waAuthDir', 'waPairingNumber', 'followupMaxHours',
  'llmVision', 'followupSmart', 'transcribeVoice', 'onlyNumbers', 'quietEnabled', 'waWarmup', ...Object.keys(TUNABLE),
]);

/**
 * Semua pengaturan. Kunci di PROJECT_KEYS dibaca dari proyek yang sedang
 * dilayani (baris proyek + Pengaturan di dashboard); sisanya dari .env.
 * Dengan begitu `cfg.x` tetap dipakai apa adanya di mana pun.
 */
export const cfg: typeof base = new Proxy(base, {
  get(target, key) {
    const ctx = typeof key === 'string' && PROJECT_KEYS.has(key) ? maybeProject() : undefined;
    return ctx && key in ctx.cfg ? ctx.cfg[key as string] : (target as Record<string | symbol, unknown>)[key];
  },
  set(target, key, value) {
    const ctx = typeof key === 'string' && PROJECT_KEYS.has(key) ? maybeProject() : undefined;
    if (ctx) ctx.cfg[key as string] = value;
    else (target as Record<string | symbol, unknown>)[key] = value;
    return true;
  },
});

const envDefaults = { ...base, onlyNumbers: [...base.onlyNumbers] };

/** Pengaturan ya/tidak di Settings. */
const BOOL_KEYS = ['llmVision', 'followupSmart', 'transcribeVoice', 'quietEnabled', 'waWarmup'] as const;

/** Nilai dari Pengaturan di dashboard di atas bawaan .env. Kunci yang tidak diisi kembali ke bawaan. */
export function settingsCfg(s: Settings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(TUNABLE) as TunableKey[]) out[k] = typeof s[k] === 'number' ? s[k] : envDefaults[k];
  for (const k of BOOL_KEYS) out[k] = typeof s[k] === 'boolean' ? s[k] : envDefaults[k];
  out.onlyNumbers = Array.isArray(s.onlyNumbers) ? s.onlyNumbers : envDefaults.onlyNumbers;
  return out;
}

/** Nilai `cfg` khas satu proyek: dari baris proyeknya dan Pengaturan di profilnya. */
export function projectCfg(row: Pick<Project, 'id' | 'transport' | 'sales_number' | 'wa_number'>, s: Settings): Record<string, unknown> {
  const transport = row.transport === 'cloud' ? 'cloud' : 'baileys';
  return {
    transport,
    salesNumber: parseSalesNumber(row.sales_number),
    waAuthDir: join(base.authRoot, row.id),
    waPairingNumber: row.wa_number ?? '',
    followupMaxHours: has('FOLLOWUP_MAX_HOURS') ? envDefaults.followupMaxHours : transport === 'cloud' ? 24 : 0,
    ...settingsCfg(s),
  };
}

/** Pakai pengaturan dari dashboard untuk proyek yang sedang dilayani. */
export function applySettings(s: Settings): void {
  Object.assign(currentProject().cfg, settingsCfg(s));
}

/** Nilai yang sedang berlaku, untuk ditampilkan dashboard. */
export function effectiveSettings(): Required<Settings> {
  const out: Record<string, unknown> = { onlyNumbers: cfg.onlyNumbers };
  for (const k of BOOL_KEYS) out[k] = cfg[k];
  for (const k of Object.keys(TUNABLE) as TunableKey[]) out[k] = cfg[k];
  return out as unknown as Required<Settings>;
}

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
