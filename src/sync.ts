/**
 * Sisi bot dari penyimpanan bersama: menarik profil + berkas yang disimpan
 * dashboard online, dan mengirim salinan lead + status untuk ditampilkannya.
 *
 * Yang membatasi rancangannya adalah JATAH penyimpanan (Vercel Blob, paket
 * gratis, dicek 2026-11-11): 10.000 pembacaan dan 2.000 penulisan per bulan —
 * dan kalau terlampaui, penyimpanannya dimatikan 30 hari. Jadi:
 *
 *   - Profil ditarik sebelum membalas, tapi paling sering sekali per 3 menit,
 *     plus sekali per 20 menit saat sepi.
 *   - Laporan rutin dikirim paling sering sekali per 15 menit, dan hanya kalau
 *     ada yang berubah.
 *   - Kejadian yang butuh orang (peringatan, pelanggan butuh staf, lead baru)
 *     TIDAK menunggu 15 menit: dikirim dalam ±1 menit.
 *   - Keduanya punya jatah harian yang dicatat di database, jadi bot yang
 *     mati-nyala berulang pun tidak bisa menghabiskan jatah sebulan.
 *
 * Hasil tarikan ditulis ke folder data lokal, jadi sisa bot tidak tahu
 * profilnya datang dari mana, dan tetap jalan memakai salinan terakhir kalau
 * penyimpanan bersama sedang tidak terjangkau atau jatahnya habis.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { alertItems, botStatus, errorItems, leadRows, setQuotaReporter, usageReport } from './admin/store-local';
import type { Snapshot } from './admin/stores';
import { mediaDir, replaceOverrides } from './business';
import type { Editable } from './business/types';
import { localDay, now } from './clock';
import { MINUTE } from './config';
import { blob, remotePath } from './remote';
import { quotaUse, quotaUsed } from './store';

/** Jangan menarik lebih sering dari ini, seramai apa pun chatnya. */
const MIN_PULL_GAP_MS = 3 * MINUTE;
const IDLE_PULL_MS = 20 * MINUTE;
/** Laporan rutin paling sering sekali per jangka ini. */
const MIN_PUSH_GAP_MS = 15 * MINUTE;
/** Laporan karena kejadian penting: tetap diberi jarak, supaya rentetan kejadian jadi satu kiriman. */
const URGENT_PUSH_GAP_MS = MINUTE;

/**
 * Jatah harian. 280 × 30 = 8.400 pembacaan dan 55 × 30 = 1.650 penulisan per
 * bulan; sisanya (±1.600 dan ±350) untuk dashboard itu sendiri.
 */
export const DAILY_READS = 280;
export const DAILY_WRITES = 55;

const warned = new Set<string>();
/** Pakai satu jatah; false kalau jatah hari ini sudah habis. */
function spend(kind: 'baca' | 'tulis', limit: number): boolean {
  const day = localDay(now());
  if (quotaUsed(day, kind) >= limit) {
    if (!warned.has(`${day}:${kind}`)) {
      warned.add(`${day}:${kind}`);
      console.warn(
        `[sinkron] jatah ${kind} hari ini (${limit}) habis — ` +
          (kind === 'baca' ? 'perubahan dari dashboard baru dipakai bot besok' : 'dashboard online baru diperbarui lagi besok') +
          '. Bot tetap jalan seperti biasa.'
      );
    }
    return false;
  }
  quotaUse(day, kind);
  return true;
}

/** Pemakaian jatah hari ini, untuk ditampilkan dashboard. */
export function quotaToday(): string {
  const day = localDay(now());
  return `${quotaUsed(day, 'baca')}/${DAILY_READS} baca · ${quotaUsed(day, 'tulis')}/${DAILY_WRITES} tulis hari ini`;
}

let lastPullAt = 0;
let lastProfile = '';
let pulling: Promise<void> | null = null;

/** Unduh satu berkas ke folder media kalau belum ada. True kalau sekarang ada. */
async function fetchFile(name: string): Promise<boolean> {
  const local = join(mediaDir(), name);
  if (existsSync(local)) return true;
  if (!spend('baca', DAILY_READS)) return false;
  const data = await blob().getBytes(remotePath.media(name));
  if (data) writeFileSync(local, data);
  else console.error(`[sinkron] ${name} belum ada di penyimpanan bersama`);
  return Boolean(data);
}

async function pullOnce(): Promise<void> {
  if (!spend('baca', DAILY_READS)) return;
  const bytes = await blob().getBytes(remotePath.profile());
  const text = bytes?.toString('utf8') ?? '';
  if (!text || text === lastProfile) return;

  const overrides = JSON.parse(text) as Partial<Editable>;
  // Berkas dulu, baru profil: bot tidak boleh sempat "tahu" berkas yang belum
  // ada di sini.
  for (const p of overrides.files ?? []) {
    if (!/^[fd][0-9a-f]{8}\.(jpg|png|webp|pdf)$/.test(p.file)) continue;
    await fetchFile(p.file);
    // Isi PDF yang boleh dibaca bot: teksnya disiapkan dashboard sebagai <id>.txt.
    if (p.read && p.file.endsWith('.pdf')) await fetchFile(`${p.id}.txt`);
  }
  // Daftar pelanggan lama: berkasnya diberi nama menurut waktu impornya, jadi
  // impor baru = berkas baru, dan yang lama tidak diunduh ulang.
  if (overrides.knownAt) await fetchFile(`known-${overrides.knownAt}.json`);
  replaceOverrides(overrides);
  lastProfile = text;
  console.log('[sinkron] profil terbaru dari dashboard dipakai');
}

/** Tarik profil terbaru. Gagal = lanjut dengan salinan terakhir, bukan berhenti. */
export function pullProfile(force = false): Promise<void> {
  if (pulling) return pulling;
  if (!force && Date.now() - lastPullAt < MIN_PULL_GAP_MS) return Promise.resolve();
  lastPullAt = Date.now();
  pulling = pullOnce()
    .catch((e) => console.error(`[sinkron] gagal menarik profil: ${e instanceof Error ? e.message : e}`))
    .finally(() => {
      pulling = null;
    });
  return pulling;
}

let lastPushAt = 0;
let lastKey = '';
let urgent = false;

/** Ada kejadian yang perlu segera terlihat di dashboard (peringatan, butuh staf, lead baru). */
export function pushSoon(): void {
  urgent = true;
}

/** Kirim salinan lead + status bot, kalau ada yang berubah. */
export async function pushSnapshot(force = false): Promise<boolean> {
  const leads = leadRows();
  const alerts = alertItems();
  const errors = errorItems();
  const key = JSON.stringify([leads, alerts[0]?.at ?? 0, errors[0]?.at ?? 0]);
  const gap = urgent ? URGENT_PUSH_GAP_MS : MIN_PUSH_GAP_MS;
  if (!force && (key === lastKey || Date.now() - lastPushAt < gap)) return false;
  if (!spend('tulis', DAILY_WRITES)) return false;
  const snapshot: Snapshot = { at: Date.now(), status: botStatus(), leads, usage: usageReport(), alerts, errors };
  try {
    await blob().put(remotePath.snapshot(), JSON.stringify(snapshot), 'application/json');
    lastPushAt = Date.now();
    lastKey = key;
    urgent = false;
    return true;
  } catch (e) {
    console.error(`[sinkron] gagal mengirim salinan lead: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export async function startSync(): Promise<void> {
  setQuotaReporter(quotaToday);
  await pullProfile(true);
  await pushSnapshot(true);
  // Di latar: untuk follow-up dan untuk bot yang sedang sepi.
  setInterval(() => void pullProfile(), IDLE_PULL_MS);
  setInterval(() => void pushSnapshot(), MINUTE);
  console.log(`[sinkron] tersambung ke penyimpanan bersama — profil diatur dari dashboard online (${quotaToday()})`);
}

/** Tes. */
export function resetSync(): void {
  lastPullAt = lastPushAt = 0;
  lastProfile = lastKey = '';
  urgent = false;
  warned.clear();
}
