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
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      done_at INTEGER
    );
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
  'followup_state', 'followup_total', 'lead_sent_at', 'handoff_sent_at',
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
