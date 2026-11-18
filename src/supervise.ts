/**
 * Pengawas: `npm start`. Menjalankan bot sebagai proses anak, lalu
 *
 *   - menyimpan SEMUA keluarannya (termasuk log Baileys) ke logs/bot-TANGGAL.log,
 *     jadi jejaknya tidak hilang saat jendela terminal ditutup;
 *   - menyalakannya lagi kalau ia mati, dengan jeda yang makin panjang;
 *   - mengabari pemilik lewat email (kalau diatur) saat bot mati.
 *
 * Bot tanpa pengawas: `npm run bot`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import 'dotenv/config';

const LOG_DIR = process.env.LOG_DIR?.trim() || './logs';
const KEEP_DAYS = Number(process.env.LOG_KEEP_DAYS) || 14;
const TZ = process.env.BOT_TZ?.trim() || 'Asia/Jakarta';

const day = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const clock = (): string => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, timeStyle: 'medium' }).format(new Date());

mkdirSync(LOG_DIR, { recursive: true });

let lastPruned = '';
function prune(): void {
  const today = day();
  if (lastPruned === today) return;
  lastPruned = today;
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const f of readdirSync(LOG_DIR)) {
    const m = f.match(/^bot-(\d{4}-\d{2}-\d{2})\.log$/);
    if (m && (m[1] as string) < cutoff) unlinkSync(join(LOG_DIR, f));
  }
}

/** Tiap baris diberi jam, supaya kejadian bisa dicocokkan dengan chat pelanggan. */
let carry = '';
function record(chunk: Buffer | string): void {
  const text = carry + chunk.toString();
  const lines = text.split('\n');
  carry = lines.pop() ?? '';
  if (!lines.length) return;
  prune();
  try {
    appendFileSync(join(LOG_DIR, `bot-${day()}.log`), lines.map((l) => `${clock()} ${l.replace(/\r$/, '')}\n`).join(''));
  } catch {
    // disk penuh / berkas terkunci: bot tetap jalan, hanya catatannya yang hilang
  }
}

/**
 * Catat "bot berhenti" sebagai warning di dashboard (WhatsApp tidak mungkin:
 * botnya sedang mati). Tidak pernah melempar.
 */
async function tell(text: string): Promise<void> {
  try {
    const { openDb, closeDb } = await import('./db');
    const { initBiz } = await import('./business');
    await openDb();
    await initBiz(undefined, { requireEnabled: false });
    const { raiseAlert } = await import('./alerts');
    await raiseAlert('bot-mati', text, { whatsapp: false });
    await closeDb();
  } catch (e) {
    say(`kabar "bot mati" tidak terkirim: ${e instanceof Error ? e.message : e}`);
  }
}

const say = (text: string): void => {
  const line = `[pengawas] ${text}\n`;
  process.stdout.write(line);
  record(line);
};

let child: ChildProcess | null = null;
let stopping = false;
let delay = 5_000;

function start(): void {
  const startedAt = Date.now();
  child = spawn(process.execPath, [join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  });
  say(`bot dinyalakan (pid ${child.pid}) — log: ${join(LOG_DIR, `bot-${day()}.log`)}`);
  child.stdout?.on('data', (d: Buffer) => { process.stdout.write(d); record(d); });
  child.stderr?.on('data', (d: Buffer) => { process.stderr.write(d); record(d); });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return void say('bot dihentikan.');
    // Jalan lama lalu mati = kejadian baru; mati terus-menerus = jeda makin panjang.
    if (Date.now() - startedAt > 10 * 60_000) delay = 5_000;
    say(`bot BERHENTI (kode ${code ?? '-'}${signal ? `, sinyal ${signal}` : ''}); dinyalakan lagi dalam ${delay / 1000} detik`);
    void tell(`Bot berhenti (kode ${code ?? '-'}) dan dinyalakan lagi dalam ${delay / 1000} detik. Kalau ini terus berulang, lihat Pengaturan > Lanjutan > Catatan error di dashboard atau berkas log di mesin bot.`);
    setTimeout(start, delay);
    delay = Math.min(delay * 2, 5 * 60_000);
  });
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill();
    else process.exit(0);
    setTimeout(() => process.exit(0), 3_000).unref();
  });
}

start();
