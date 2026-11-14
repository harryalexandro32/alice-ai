/**
 * Penyimpanan: satu file SQLite (node:sqlite bawaan Node, tanpa dependensi).
 *
 * Follow-up dan "sudah pernah disapa" harus selamat dari restart, jadi tidak
 * ada satu pun keadaan percakapan yang cuma hidup di memori.
 *
 * Data lead disimpan sebagai JSON (`lead`), bukan kolom tetap: field apa yang
 * dikumpulkan ditentukan profil bisnis, bukan skema.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Dir = 'in' | 'out' | 'human';
export type FollowupState = 'idle' | 'pending';

export interface Contact {
  /** Nomor "+62…", atau "lid:…" kalau WhatsApp tidak memberi nomornya. */
  phone: string;
  /** Alamat balasan milik transport (JID di Baileys, nomor di Cloud API). */
  address: string;
  lead: Record<string, string>;
  /** Pernah menanyakan hal yang harus dijawab manusia (harga, stok, …). */
  needs_sales: number;
  first_seen_at: number;
  last_inbound_at: number;
  last_dir: Dir;
  last_out_text: string | null;
  followup_state: FollowupState;
  followup_total: number;
  lead_sent_at: number | null;
  handoff_sent_at: number | null;
  /** Ringkasan percakapan sejauh ini, ditulis LLM tiap giliran. */
  summary: string | null;
  /** Nama profil WhatsApp-nya, apa adanya (belum tentu nama orang). */
  wa_name: string | null;
  /** Kapan staf terakhir menandai "sudah ditangani" (ms), atau null. */
  handled_at: number | null;
  /** 1 = pelanggan lama yang diimpor pemilik (bukan orang baru). */
  imported: number;
  /** 1 = diimpor dengan "bot diam"; diterapkan begitu alamat chatnya diketahui. */
  pending_off: number;
}

export interface OutboxRow {
  id: number;
  kind: 'sales' | 'sheet';
  payload: string;
  attempts: number;
}

let db: DatabaseSync;

export function openDb(path: string): void {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      phone TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      lead TEXT NOT NULL DEFAULT '{}',
      needs_sales INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_inbound_at INTEGER NOT NULL,
      last_dir TEXT NOT NULL DEFAULT 'in',
      last_out_text TEXT,
      followup_state TEXT NOT NULL DEFAULT 'idle',
      followup_total INTEGER NOT NULL DEFAULT 0,
      lead_sent_at INTEGER,
      handoff_sent_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS contacts_address ON contacts(address);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      dir TEXT NOT NULL,
      text TEXT NOT NULL,
      at INTEGER NOT NULL,
      wa_id TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS messages_phone ON messages(phone, id);
    CREATE TABLE IF NOT EXISTS pauses (
      address TEXT PRIMARY KEY,
      until INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_off (
      address TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS switch_applied (
      phone TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      level TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS human_seen (
      address TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      done_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS llm_usage (
      day TEXT PRIMARY KEY,
      calls INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Kolom yang ditambahkan belakangan (database lama tidak punya).
  const cols = (db.prepare('PRAGMA table_info(contacts)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('summary')) db.exec('ALTER TABLE contacts ADD COLUMN summary TEXT');
  if (!cols.includes('wa_name')) db.exec('ALTER TABLE contacts ADD COLUMN wa_name TEXT');
  if (!cols.includes('handled_at')) db.exec('ALTER TABLE contacts ADD COLUMN handled_at INTEGER');
  if (!cols.includes('imported')) db.exec('ALTER TABLE contacts ADD COLUMN imported INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('pending_off')) db.exec('ALTER TABLE contacts ADD COLUMN pending_off INTEGER NOT NULL DEFAULT 0');
  // Percakapan yang sudah pernah dibalas admin sebelum tabel ini ada.
  db.exec(`
    INSERT OR IGNORE INTO human_seen (address, at)
    SELECT c.address, MAX(m.at) FROM messages m JOIN contacts c ON c.phone = m.phone
    WHERE m.dir = 'human' GROUP BY c.address
  `);
}

type Row = Omit<Contact, 'lead'> & { lead: string };

function toContact(r: Row | undefined): Contact | undefined {
  if (!r) return undefined;
  let lead: Record<string, string> = {};
  try {
    lead = JSON.parse(r.lead) as Record<string, string>;
  } catch {
    // baris rusak diperlakukan sebagai belum ada data, bukan bikin bot mati
  }
  return { ...r, lead };
}

export function getContact(phone: string): Contact | undefined {
  return toContact(db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone) as Row | undefined);
}

export function contactByAddress(address: string): Contact | undefined {
  return toContact(db.prepare('SELECT * FROM contacts WHERE address = ?').get(address) as Row | undefined);
}

export function createContact(phone: string, address: string, at: number): Contact {
  db.prepare(
    'INSERT INTO contacts (phone, address, first_seen_at, last_inbound_at) VALUES (?, ?, ?, ?)'
  ).run(phone, address, at, at);
  return getContact(phone) as Contact;
}

const UPDATABLE = new Set<keyof Contact>([
  'address', 'lead', 'needs_sales', 'last_inbound_at', 'last_dir', 'last_out_text',
  'followup_state', 'followup_total', 'lead_sent_at', 'handoff_sent_at', 'summary', 'wa_name', 'handled_at', 'pending_off',
]);

export function updateContact(phone: string, patch: Partial<Contact>): Contact {
  const keys = (Object.keys(patch) as (keyof Contact)[]).filter((k) => UPDATABLE.has(k));
  if (keys.length) {
    const sql = `UPDATE contacts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE phone = ?`;
    const values = keys.map((k) =>
      k === 'lead' ? JSON.stringify(patch.lead) : (patch[k] as string | number | null)
    );
    db.prepare(sql).run(...values, phone);
  }
  return getContact(phone) as Contact;
}

/** False kalau id pesan itu sudah pernah dicatat (kiriman ganda). */
export function addMessage(phone: string, dir: Dir, text: string, at: number, waId?: string | null): boolean {
  const r = db
    .prepare('INSERT OR IGNORE INTO messages (phone, dir, text, at, wa_id) VALUES (?, ?, ?, ?, ?)')
    .run(phone, dir, text, at, waId ?? null);
  return Number(r.changes) > 0;
}

export function recentMessages(phone: string, n: number): { dir: Dir; text: string; at: number }[] {
  const rows = db
    .prepare('SELECT dir, text, at FROM messages WHERE phone = ? ORDER BY id DESC LIMIT ?')
    .all(phone, n) as { dir: Dir; text: string; at: number }[];
  return rows.reverse();
}

export function countInboundSince(phone: string, since: number): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE phone = ? AND dir = 'in' AND at >= ?")
    .get(phone, since) as { n: number };
  return Number(r.n);
}

export function setPause(address: string, until: number): void {
  db.prepare(
    'INSERT INTO pauses (address, until) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET until = excluded.until'
  ).run(address, until);
}

export function pausedUntil(address: string): number {
  const r = db.prepare('SELECT until FROM pauses WHERE address = ?').get(address) as
    | { until: number }
    | undefined;
  return r ? Number(r.until) : 0;
}

/** Catat bahwa admin manusia membalas / mengirimi alamat ini. */
export function markHuman(address: string, at: number): void {
  db.prepare('INSERT INTO human_seen (address, at) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET at = excluded.at').run(address, at);
}

/** Kapan admin manusia terakhir membalas alamat ini; 0 = belum pernah. */
export function humanSeenAt(address: string): number {
  const r = db.prepare('SELECT at FROM human_seen WHERE address = ?').get(address) as { at: number } | undefined;
  return r ? Number(r.at) : 0;
}

/** Bot dimatikan untuk alamat ini lewat tombol di dashboard. */
export function setBotOff(address: string, at: number): void {
  db.prepare('INSERT INTO bot_off (address, at) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET at = excluded.at').run(address, at);
}

export function isBotOff(address: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM bot_off WHERE address = ?').get(address));
}

/** Kembalikan chat ke bot: semua penahan (tombol, admin membalas, jeda) dilepas. */
export function releaseToBot(address: string): void {
  for (const t of ['bot_off', 'human_seen', 'pauses']) db.prepare(`DELETE FROM ${t} WHERE address = ?`).run(address);
}

/** Kapan perintah tombol untuk nomor ini terakhir dijalankan; 0 = belum pernah. */
export function switchAppliedAt(phone: string): number {
  const r = db.prepare('SELECT at FROM switch_applied WHERE phone = ?').get(phone) as { at: number } | undefined;
  return r ? Number(r.at) : 0;
}

export function markSwitchApplied(phone: string, at: number): void {
  db.prepare('INSERT INTO switch_applied (phone, at) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET at = excluded.at').run(phone, at);
}

/**
 * Catat pelanggan lama yang diimpor pemilik. Kontak yang sudah ada tidak
 * ditimpa; hanya namanya diisi kalau belum ada. Mengembalikan true kalau
 * kontaknya baru dibuat.
 */
export function importContact(phone: string, lead: Record<string, string>, off: boolean, at: number): boolean {
  const existing = getContact(phone);
  if (!existing) {
    // last_inbound_at 0: belum pernah chat dengan bot, jadi tidak ikut daftar "terbaru".
    db.prepare(
      'INSERT INTO contacts (phone, address, lead, first_seen_at, last_inbound_at, last_dir, imported, pending_off) VALUES (?, ?, ?, ?, 0, ?, 1, ?)'
    ).run(phone, '', JSON.stringify(lead), at, 'in', off ? 1 : 0);
    return true;
  }
  const merged = { ...lead, ...existing.lead };
  db.prepare('UPDATE contacts SET lead = ?, pending_off = ? WHERE phone = ?').run(JSON.stringify(merged), off && !existing.address ? 1 : existing.pending_off, phone);
  if (off && existing.address) setBotOff(existing.address, at);
  return false;
}

export interface ErrorRow {
  at: number;
  level: string;
  text: string;
}

let errorsSince = 0;
export function addError(e: ErrorRow): void {
  db.prepare('INSERT INTO errors (at, level, text) VALUES (?, ?, ?)').run(e.at, e.level, e.text);
  // Merapikan tiap sekian catatan saja; tabelnya tidak boleh tumbuh tanpa batas.
  if ((errorsSince += 1) % 50 === 0) db.exec('DELETE FROM errors WHERE id NOT IN (SELECT id FROM errors ORDER BY id DESC LIMIT 1000)');
}

/** Catatan galat, terbaru dulu. */
export function recentErrors(n: number): ErrorRow[] {
  const rows = db.prepare('SELECT at, level, text FROM errors ORDER BY id DESC LIMIT ?').all(n) as unknown as ErrorRow[];
  return rows.map((r) => ({ ...r }));
}

export interface AlertRow {
  at: number;
  kind: string;
  key: string;
  text: string;
}

export function addAlert(a: AlertRow): void {
  db.prepare('INSERT INTO alerts (at, kind, key, text) VALUES (?, ?, ?, ?)').run(a.at, a.kind, a.key, a.text);
  db.exec('DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY id DESC LIMIT 500)');
}

/** Kapan peringatan sejenis (jenis + kunci) terakhir dicatat; 0 = belum pernah. */
export function lastAlertAt(kind: string, key: string): number {
  const r = db.prepare('SELECT MAX(at) AS at FROM alerts WHERE kind = ? AND key = ?').get(kind, key) as { at: number | null };
  return Number(r?.at ?? 0);
}

/** Peringatan terbaru dulu. */
export function recentAlerts(n: number): AlertRow[] {
  const rows = db.prepare('SELECT at, kind, key, text FROM alerts ORDER BY id DESC LIMIT ?').all(n) as unknown as AlertRow[];
  return rows.map((r) => ({ ...r }));
}

export function followupCandidates(): Contact[] {
  const rows = db
    .prepare("SELECT * FROM contacts WHERE followup_state = 'pending' AND last_dir = 'out'")
    .all() as unknown as Row[];
  return rows.map((r) => toContact(r) as Contact);
}

/** Kontak terbaru, untuk daftar lead di dashboard. */
export function recentContacts(n: number): Contact[] {
  const rows = db
    .prepare('SELECT * FROM contacts ORDER BY last_inbound_at DESC LIMIT ?')
    .all(n) as unknown as Row[];
  return rows.map((r) => toContact(r) as Contact);
}

export function outboxAdd(kind: OutboxRow['kind'], payload: unknown, at: number): void {
  db.prepare('INSERT INTO outbox (kind, payload, created_at) VALUES (?, ?, ?)').run(
    kind,
    JSON.stringify(payload),
    at
  );
}

export function outboxPending(maxAttempts: number): OutboxRow[] {
  return db
    .prepare('SELECT id, kind, payload, attempts FROM outbox WHERE done_at IS NULL AND attempts < ? ORDER BY id')
    .all(maxAttempts) as unknown as OutboxRow[];
}

export function outboxDone(id: number, at: number): void {
  db.prepare('UPDATE outbox SET done_at = ? WHERE id = ?').run(at, id);
}

export function outboxFailed(id: number): void {
  db.prepare('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?').run(id);
}

export interface UsageDay {
  day: string;
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

/** Tambahkan pemakaian LLM ke hari itu (hari menurut zona waktu bot). */
export function addUsage(d: UsageDay): void {
  db.prepare(
    `INSERT INTO llm_usage (day, calls, prompt_tokens, cached_tokens, completion_tokens) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET calls = calls + excluded.calls,
       prompt_tokens = prompt_tokens + excluded.prompt_tokens,
       cached_tokens = cached_tokens + excluded.cached_tokens,
       completion_tokens = completion_tokens + excluded.completion_tokens`
  ).run(d.day, d.calls, d.promptTokens, d.cachedTokens, d.completionTokens);
}

/** Pemakaian per hari, terbaru dulu. */
export function usageDays(n: number): UsageDay[] {
  const rows = db
    .prepare(
      `SELECT day, calls, prompt_tokens AS promptTokens, cached_tokens AS cachedTokens,
              completion_tokens AS completionTokens FROM llm_usage ORDER BY day DESC LIMIT ?`
    )
    .all(n) as unknown as UsageDay[];
  return rows.map((r) => ({ ...r }));
}
