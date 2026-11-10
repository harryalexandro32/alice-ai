/** Penyimpanan dashboard saat ia jalan di mesin yang sama dengan bot. */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mediaDir, refreshBiz, saveBiz } from '../business';
import { cfg } from '../config';
import { llmEnabled, llmUsageToday } from '../llm/provider';
import { sheetConfigured } from '../sinks/sheet';
import { recentContacts, usageDays } from '../store';
import { guardSummary } from '../transport/sendguard';
import type { AdminStore, BotStatus, LeadRow, UsageReport } from './stores';

export function leadRows(): LeadRow[] {
  return recentContacts(100).map((c) => ({
    phone: c.phone,
    lead: c.lead,
    needsSales: Boolean(c.needs_sales),
    complete: Boolean(c.lead_sent_at),
    lastAt: c.last_inbound_at,
    lastDir: c.last_dir,
  }));
}

export function botStatus(): Omit<BotStatus, 'reportedAt'> {
  const u = llmUsageToday();
  return {
    transport: cfg.transport,
    llm: llmEnabled() ? cfg.llmModel : null,
    usage: { calls: u.calls, limit: u.limit },
    sales: cfg.salesNumber === 'self' ? 'nomor bot sendiri' : cfg.salesNumber,
    sheet: sheetConfigured(),
    onlyNumbers: cfg.onlyNumbers.length,
    ...(cfg.transport === 'baileys' ? { guard: guardSummary() } : {}),
  };
}

export function usageReport(): UsageReport {
  return {
    model: cfg.llmModel,
    price: { in: cfg.llmPriceIn, cached: cfg.llmPriceCached, out: cfg.llmPriceOut },
    usdIdr: cfg.usdIdr,
    days: usageDays(90),
  };
}

export function localStore(): AdminStore {
  const path = (file: string) => join(mediaDir(), file);
  return {
    async refresh() {
      refreshBiz();
    },
    async save(changes) {
      saveBiz(changes);
    },
    async putPhoto(file, data) {
      writeFileSync(path(file), data);
    },
    async getPhoto(file) {
      return existsSync(path(file)) ? readFileSync(path(file)) : null;
    },
    async delPhoto(file) {
      if (existsSync(path(file))) unlinkSync(path(file));
    },
    async leads() {
      return leadRows();
    },
    async status() {
      return { ...botStatus(), reportedAt: null };
    },
    async usage() {
      return usageReport();
    },
  };
}
