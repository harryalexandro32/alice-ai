/**
 * Sisi bot dari penyimpanan bersama: menarik profil + foto yang disimpan
 * dashboard online, dan mengirim salinan lead + status untuk ditampilkannya.
 *
 * Profil ditarik TEPAT sebelum membalas (dan sesekali di latar), bukan tiap
 * beberapa detik. Itu saat-saat perubahan memang berpengaruh, dan jumlah
 * pembacaan jadi sebanding dengan jumlah chat — bukan ribuan per hari walau
 * sepi, yang akan menghabiskan jatah operasi penyimpanan.
 *
 * Hasil tarikan ditulis ke folder data lokal, jadi sisa bot tidak tahu
 * profilnya datang dari mana, dan tetap jalan memakai salinan terakhir kalau
 * penyimpanan bersama sedang tidak terjangkau.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { botStatus, leadRows, usageReport } from './admin/store-local';
import type { Snapshot } from './admin/stores';
import { mediaDir, replaceOverrides } from './business';
import type { Editable } from './business/types';
import { MINUTE } from './config';
import { blob, remotePath } from './remote';

/** Jangan menarik lebih sering dari ini, seramai apa pun chatnya. */
const MIN_PULL_GAP_MS = 5_000;
/** Kiriman lead paling sering sekali per jangka ini (menulis itu operasi mahal). */
const MIN_PUSH_GAP_MS = 15 * MINUTE;

let lastPullAt = 0;
let lastProfile = '';
let pulling: Promise<void> | null = null;

async function pullOnce(): Promise<void> {
  const bytes = await blob().getBytes(remotePath.profile());
  const text = bytes?.toString('utf8') ?? '';
  if (!text || text === lastProfile) return;

  const overrides = JSON.parse(text) as Partial<Editable>;
  // Foto dulu, baru profil: bot tidak boleh sempat "tahu" foto yang berkasnya
  // belum ada di sini.
  for (const p of overrides.files ?? []) {
    if (!/^[fd][0-9a-f]{8}\.(jpg|png|webp|pdf)$/.test(p.file)) continue;
    const local = join(mediaDir(), p.file);
    if (existsSync(local)) continue;
    const data = await blob().getBytes(remotePath.media(p.file));
    if (data) writeFileSync(local, data);
    else console.error(`[sinkron] berkas ${p.file} belum ada di penyimpanan bersama`);
  }
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
let lastLeads = '';

/** Kirim salinan lead + status bot, kalau ada yang berubah. */
export async function pushSnapshot(force = false): Promise<boolean> {
  const leads = leadRows();
  const key = JSON.stringify(leads);
  if (!force && (key === lastLeads || Date.now() - lastPushAt < MIN_PUSH_GAP_MS)) return false;
  const snapshot: Snapshot = { at: Date.now(), status: botStatus(), leads, usage: usageReport() };
  try {
    await blob().put(remotePath.snapshot(), JSON.stringify(snapshot), 'application/json');
    lastPushAt = Date.now();
    lastLeads = key;
    return true;
  } catch (e) {
    console.error(`[sinkron] gagal mengirim salinan lead: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export async function startSync(): Promise<void> {
  await pullProfile(true);
  await pushSnapshot(true);
  // Di latar: untuk follow-up dan untuk bot yang sedang sepi.
  setInterval(() => void pullProfile(), 10 * MINUTE);
  setInterval(() => void pushSnapshot(), MINUTE);
  console.log('[sinkron] tersambung ke penyimpanan bersama — profil diatur dari dashboard online');
}

/** Tes. */
export function resetSync(): void {
  lastPullAt = lastPushAt = 0;
  lastProfile = lastLeads = '';
}
