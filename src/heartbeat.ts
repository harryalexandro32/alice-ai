/**
 * Detak jantung bot: laporan berkala ke database untuk dashboard.
 *
 * Dashboard berjalan di proses lain, jadi semua yang hanya diketahui proses
 * bot — keadaan WhatsApp, QR, kode pairing, jatah LLM hari ini, pengaman
 * nomor — ditulis ke tabel project_status tiap 30 detik dan setiap kali
 * keadaan sambungan berubah.
 *
 * Arah sebaliknya juga lewat database: dashboard menaruh permintaan di
 * projects.pairing_request (minta kode pairing, atau putuskan & tautkan
 * ulang), dan bot memeriksanya tiap beberapa detik.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cfg, effectiveSettings } from './config';
import { sttEnabled } from './llm/stt';
import { llmUsageToday } from './llm/provider';
import { emailReady, telegramReady } from './notify';
import { currentProject } from './project';
import { getProject, setPairingRequest, writeStatus, type StatusPatch } from './store';
import { guardSummary } from './transport/sendguard';
import type { Transport, TransportState } from './transport/types';

const BEAT_MS = 30_000;
/** Permintaan dari dashboard (kode pairing) harus terasa cepat. */
const REQUEST_MS = 3_000;

let last: TransportState = { state: 'starting' };
const startedAt = Date.now();
let versionText: string | null = null;

/** Versi kode yang sedang jalan: hash git pendek, atau versi package.json. */
export function version(): string {
  if (versionText) return versionText;
  const root = join(__dirname, '..');
  try {
    versionText = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    try {
      versionText = String((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '?');
    } catch {
      versionText = '?';
    }
  }
  return versionText;
}

function snapshot(): StatusPatch {
  const u = llmUsageToday();
  return {
    state: last.state,
    qr: last.qr ?? null,
    pairing_code: last.pairingCode ?? null,
    self_phone: last.selfPhone ?? null,
    detail: last.detail ?? null,
    usage_calls: u.calls,
    usage_limit: u.limit,
    guard: cfg.transport === 'baileys' ? guardSummary() : null,
    transport: cfg.transport,
    effective: effectiveSettings() as unknown as Record<string, unknown>,
    channels: { email: emailReady(), telegram: telegramReady(), stt: sttEnabled() },
    version: version(),
    pid: process.pid,
    started_at: startedAt,
    last_seen_at: Date.now(),
  };
}

/** Tulis laporan sekarang. */
export function beat(): Promise<void> {
  return writeStatus(snapshot());
}

/** Keadaan sambungan berubah (dipanggil transport, atau tes). */
export function reportState(s: TransportState): Promise<void> {
  last = s;
  return beat();
}

/**
 * Jalankan permintaan dashboard untuk proyek ini, kalau ada: minta kode
 * pairing, atau putuskan sesi dan tautkan ulang. Permintaannya dihapus dulu,
 * supaya yang gagal tidak diulang terus-menerus; dashboard menampilkan
 * alasannya dari laporan berikutnya.
 */
export async function handlePairingRequest(transport: Transport): Promise<void> {
  const id = currentProject().id;
  const req = (await getProject(id))?.pairing_request;
  if (!req) return;
  await setPairingRequest(id, null);
  try {
    if (req.reset) {
      if (!transport.relink) throw new Error(`jalur ${transport.name} tidak bisa ditautkan ulang dari dashboard`);
      console.log('[wa] dashboard meminta sesi diputus dan ditautkan ulang');
      await transport.relink();
    } else {
      const number = (req.number || cfg.waPairingNumber).replace(/[^0-9]/g, '');
      if (!transport.requestPairingCode) throw new Error(`jalur ${transport.name} tidak memakai kode pairing`);
      if (!number) throw new Error('nomor WhatsApp bot belum diisi');
      console.log(`[wa] dashboard meminta kode pairing untuk +${number}`);
      // Transport melaporkan kodenya sendiri lewat onState.
      await transport.requestPairingCode(number);
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[wa] permintaan dashboard gagal: ${why}`);
    last = { ...last, detail: `Permintaan gagal: ${why}` };
  }
  await beat();
}

/** Bot berhenti (SIGTERM dari systemd, Ctrl+C). */
export async function markStopped(): Promise<void> {
  last = { state: 'stopped', detail: 'Bot dihentikan' };
  await beat();
}

/** Mulai melapor. Mengembalikan fungsi untuk berhenti (tes). */
export function startHeartbeat(transport: Transport): () => void {
  // Galat yang sama berulang tiap 3 detik (mis. database putus) cukup dicatat sekali.
  let lastError = '';
  const failed = (what: string) => (e: unknown) => {
    const text = `[detak] ${what} gagal: ${e instanceof Error ? e.message : e}`;
    if (text !== lastError) console.error(text);
    lastError = text;
  };
  const ok = () => void (lastError = '');

  transport.onState?.((s) => void reportState(s).then(ok, failed('laporan')));
  void beat().then(ok, failed('laporan'));
  const beatTimer = setInterval(() => void beat().then(ok, failed('laporan')), BEAT_MS);

  let busy = false;
  const requestTimer = setInterval(() => {
    if (busy) return;
    busy = true;
    void handlePairingRequest(transport)
      .then(ok, failed('permintaan dashboard'))
      .finally(() => (busy = false));
  }, REQUEST_MS);

  return () => {
    clearInterval(beatTimer);
    clearInterval(requestTimer);
  };
}
