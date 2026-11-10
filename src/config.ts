/**
 * Semua pengaturan dari env, di satu tempat. Zona waktu TIDAK ditulis di
 * tempat lain: "jam 8 pagi" berarti apa pun yang BOT_TZ katakan.
 */

import 'dotenv/config';

const str = (k: string, d = ''): string => process.env[k]?.trim() || d;
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

export const cfg = {
  tz: str('BOT_TZ', 'Asia/Jakarta'),
  dbPath: str('DB_PATH', './data/gfan.db'),

  llmApiKey: str('LLM_API_KEY'),
  llmBaseUrl: str('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
  llmModel: str('LLM_MODEL', 'deepseek-chat'),
  llmDailyLimit: num('LLM_DAILY_LIMIT', 1500),

  followupAfterHours: num('FOLLOWUP_AFTER_HOURS', 23),
  followupStartHour: num('FOLLOWUP_START_HOUR', 8),
  followupEndHour: num('FOLLOWUP_END_HOUR', 20),
  followupMaxHours: num('FOLLOWUP_MAX_HOURS', 0),
  followupMaxTotal: num('FOLLOWUP_MAX_TOTAL', 2),

  humanPauseHours: num('HUMAN_PAUSE_HOURS', 12),

  salesNumbers: str('SALES_NUMBERS')
    .split(',')
    .map((s) => normPhone(s))
    .filter((s): s is string => Boolean(s)),
  sheetId: str('SHEET_ID'),
  sheetTab: str('SHEET_TAB', 'Leads'),
  googleCredentials: str('GOOGLE_CREDENTIALS', './google-service-account.json'),

  maxInboundPerNumber: num('MAX_INBOUND_PER_NUMBER', 40),
  debounceMs: num('DEBOUNCE_MS', 4000),

  waAuthDir: str('WA_AUTH_DIR', './auth'),
  waPairingNumber: str('WA_PAIRING_NUMBER'),
};

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
