/**
 * Penyimpanan dashboard: database bersama dan folder data/<proyek>/media/ di
 * mesin yang sama dengan bot. Semua fungsi bekerja untuk proyek permintaan
 * yang sedang dilayani (withProject di server.ts).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mediaDir, saveBiz } from '../business';
import { cfg, effectiveSettings } from '../config';
import { sttEnabled } from '../llm/stt';
import { waTargets } from '../notify';
import { llmEnabled } from '../llm/provider';
import { now } from '../clock';
import { holdFrom } from '../flow';
import { currentProject } from '../project';
import { chatHolds, readStatus, recentAlerts, recentContacts, recentErrors, trackUsageDays, usageDays } from '../store';
import { freeLeft, quotaError, quotaState, refreshQuota, trackingEnabled, trackPrice } from '../tracking';
import type { AdminStore, AlertItem, BotStatus, ErrorItem, LeadRow, ResiUsage, UsageReport } from './stores';

export async function alertItems(): Promise<AlertItem[]> {
  return (await recentAlerts(50)).map((a) => ({ at: a.at, kind: a.kind, text: a.text }));
}

export function errorItems(): Promise<ErrorItem[]> {
  return recentErrors(150);
}

export async function leadRows(): Promise<LeadRow[]> {
  const t = now();
  const [contacts, holds] = await Promise.all([recentContacts(200), chatHolds()]);
  return contacts.map((c) => ({
    phone: c.phone,
    lead: c.lead,
    needsSales: Boolean(c.needs_sales),
    complete: Boolean(c.lead_sent_at),
    lastAt: c.last_inbound_at,
    lastDir: c.last_dir,
    summary: c.summary ?? '',
    // Diimpor dengan "bot diam" tapi belum pernah chat: alamatnya belum ada, tandanya ada di kontak.
    hold: c.opted_out_at ? 'berhenti' : c.pending_off ? 'tombol' : holdFrom(holds, c.address, t, c),
    stage: c.stage,
    note: c.note ?? '',
    waName: c.wa_name ?? '',
  }));
}

/**
 * Keadaan bot. Pengaturan dihitung di sini dari profil yang sama dengan yang
 * dipakai bot; yang hanya diketahui proses bot (WhatsApp, jatah LLM hari ini,
 * pengaman nomor) diambil dari laporan berkalanya.
 */
export async function botStatus(): Promise<BotStatus> {
  const st = await readStatus(currentProject().id);
  return {
    transport: cfg.transport,
    llm: llmEnabled() ? cfg.llmModel : null,
    usage: { calls: st?.usage_calls ?? 0, limit: st?.usage_limit ?? cfg.llmDailyLimit },
    sales: waTargets('lead').map((p) => (p === 'self' ? 'nomor bot sendiri' : p)).join(', ') || null,
    onlyNumbers: cfg.onlyNumbers.length,
    effective: effectiveSettings() as unknown as Record<string, number | boolean | string[]>,
    channels: { stt: sttEnabled() },
    ...(st?.guard ? { guard: st.guard } : {}),
    ...(st ? { wa: st.state } : {}),
    reportedAt: st?.last_seen_at ?? null,
  };
}

/**
 * Cek resi per hari dan keadaan akun Binderbyte. Akun dibaca dari simpanan
 * di memori (dibaca ulang di latar belakang tiap jam). `wait` (hanya /usage):
 * tunggu pembacaan pertama kalau belum ada simpanan dan belum ada error.
 * Tanpa `wait` (/state) jaringan tidak pernah ditunggu: simpanan, atau
 * TRACK_PRICE_IDR kalau belum ada.
 */
async function resiUsage(wait: boolean): Promise<ResiUsage> {
  const [days, cached] = await Promise.all([trackUsageDays(90), quotaState()]);
  const q = cached ?? (wait && quotaError() === null ? await refreshQuota() : null);
  return {
    enabled: trackingEnabled(),
    price: trackPrice(q),
    dailyMax: cfg.trackDailyMax,
    days,
    account: q ? { used: q.used, limit: q.limit, freeLeft: freeLeft(q), balance: q.balance, at: q.at } : null,
    accountError: quotaError(),
  };
}

/** `waitAccount`: lihat resiUsage (true hanya untuk /usage). */
export async function usageReport(opts: { waitAccount?: boolean } = {}): Promise<UsageReport> {
  const [days, resi] = await Promise.all([usageDays(90), resiUsage(Boolean(opts.waitAccount))]);
  return {
    model: cfg.llmModel,
    price: { in: cfg.llmPriceIn, cached: cfg.llmPriceCached, out: cfg.llmPriceOut },
    usdIdr: cfg.usdIdr,
    days,
    resi,
  };
}

export function localStore(): AdminStore {
  const path = (file: string) => join(mediaDir(), file);
  return {
    async save(changes) {
      await saveBiz(changes);
    },
    async putPhoto(file, data) {
      mkdirSync(mediaDir(), { recursive: true });
      writeFileSync(path(file), data);
    },
    async getPhoto(file) {
      return existsSync(path(file)) ? readFileSync(path(file)) : null;
    },
    async delPhoto(file) {
      if (existsSync(path(file))) unlinkSync(path(file));
    },
    leads: leadRows,
    status: botStatus,
    usage: usageReport,
    alerts: alertItems,
    errors: errorItems,
  };
}
