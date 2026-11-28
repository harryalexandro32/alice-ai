/**
 * Penyimpanan: PostgreSQL lewat Drizzle (lihat src/db/).
 *
 * Follow-up dan "sudah pernah disapa" harus selamat dari restart, jadi tidak
 * ada satu pun keadaan percakapan yang cuma hidup di memori.
 *
 * Semua fungsi data percakapan bekerja untuk proyek yang sedang dilayani
 * (src/project.ts) — pemanggil tidak perlu menyebut proyeknya. Fungsi proyek,
 * profil, dan laporan bot menerima id proyek secara terang.
 *
 * Data lead disimpan sebagai JSON (`lead`), bukan kolom tetap: field apa yang
 * dikumpulkan ditentukan profil bisnis, bukan skema.
 */

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';

import { now } from './clock';
import { db } from './db';
import {
  alerts, botOff, contacts, errors, handoffs, humanSeen, llmUsage, messages, orders, outbox, pauses, profiles, projects, projectStatus, shopLinks,
  trackUsage, webhookEvents,
  type OrderItem, type OrderRow, type PairingRequest, type Project, type ProjectStatus, type ShipEvent, type ShopLink,
} from './db/schema';
import { currentProject } from './project';
import type { Quote } from './transport/types';

export type { OrderItem, OrderRow, PairingRequest, Project, ProjectStatus, ShipEvent, ShopLink };

export type Dir = 'in' | 'out' | 'human';
export type FollowupState = 'idle' | 'pending';
/**
 * Tahap pipeline lead. Yang berubah otomatis: "baru" -> "menunggu" (bot
 * menyerahkan chat ke tim), "baru"/"menunggu" -> "dihubungi" (manusia membalas
 * atau menandai sudah ditangani), dan "baru"/"menunggu"/"dihubungi" -> "link"
 * (bot mengirim tautan beli). Tahap tidak pernah turun otomatis. "batal" hanya
 * diubah staf; "payment" diubah staf atau oleh pesanan dari toko Tokopedia &
 * Shop yang ditautkan (src/tiktok.ts); "dikirim" dan "selesai" diubah staf,
 * oleh pelacakan resi (src/tracking.ts), atau oleh pesanan dari toko itu.
 */
export const STAGES = ['baru', 'menunggu', 'dihubungi', 'link', 'payment', 'dikirim', 'selesai', 'batal'] as const;
export type Stage = (typeof STAGES)[number];

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
  stage: Stage;
  /** Catatan staf, atau null. */
  note: string | null;
  /** Balasan ditunda sampai jam tenang berakhir (ms), atau null. */
  deferred_until: number | null;
  /** Kapan pelanggan minta tidak dihubungi lagi (ms), atau null. */
  opted_out_at: number | null;
  /** Nomor pesanan marketplace atau nomor invoice, atau null. */
  order_ref: string | null;
  /** Nomor resi pengiriman, atau null. */
  awb: string | null;
  /** Kode kurir Binderbyte (lihat COURIERS di src/tracking.ts), atau null. */
  courier: string | null;
  /** Kapan resi terakhir diisi atau diganti (ms), atau null. */
  awb_at: number | null;
  /** Status kurir dari pelacakan terakhir yang berhasil, apa adanya, atau null. */
  ship_status: string | null;
  /** Riwayat perjalanan paket, terbaru dulu (maks. 20), atau null. */
  ship_history: ShipEvent[] | null;
  /** Kapan resi terakhir dicek, berhasil atau error (ms), atau null. */
  ship_checked_at: number | null;
  /** Pesan error dari pengecekan terakhir yang gagal; null setelah berhasil. */
  ship_error: string | null;
  /** Fase dari status kurir saat dicek (lihat phaseOf di src/tracking.ts), atau null. */
  ship_phase: string | null;
}

/**
 * sales = lead dan "butuh staf"; reply = balasan dari dashboard; test = pesan
 * tes ke satu penerima notifikasi; alert = warning dari proses tanpa WhatsApp
 * (dashboard) ke satu penerima notifikasi.
 */
export type OutboxKind = 'sales' | 'reply' | 'test' | 'alert';

export interface OutboxRow {
  id: number;
  kind: OutboxKind;
  payload: unknown;
  attempts: number;
}

/** Id proyek yang sedang dilayani. */
const pid = (): string => currentProject().id;

function toContact(r: typeof contacts.$inferSelect | undefined): Contact | undefined {
  if (!r) return undefined;
  const { project: _project, ...rest } = r;
  // Baris rusak diperlakukan sebagai belum ada data, bukan bikin bot mati.
  const lead = rest.lead && typeof rest.lead === 'object' ? rest.lead : {};
  const ship_history = Array.isArray(rest.ship_history) ? rest.ship_history : null;
  return { ...rest, lead, ship_history, last_dir: rest.last_dir as Dir, followup_state: rest.followup_state as FollowupState, stage: rest.stage as Stage };
}

export async function getContact(phone: string): Promise<Contact | undefined> {
  const [r] = await db().select().from(contacts).where(and(eq(contacts.project, pid()), eq(contacts.phone, phone))).limit(1);
  return toContact(r);
}

export async function contactByAddress(address: string): Promise<Contact | undefined> {
  const [r] = await db().select().from(contacts).where(and(eq(contacts.project, pid()), eq(contacts.address, address))).limit(1);
  return toContact(r);
}

export async function createContact(phone: string, address: string, at: number): Promise<Contact> {
  await db().insert(contacts).values({ project: pid(), phone, address, first_seen_at: at, last_inbound_at: at });
  return (await getContact(phone)) as Contact;
}

const UPDATABLE = new Set<keyof Contact>([
  'address', 'lead', 'needs_sales', 'last_inbound_at', 'last_dir', 'last_out_text',
  'followup_state', 'followup_total', 'lead_sent_at', 'handoff_sent_at', 'summary', 'wa_name', 'handled_at', 'pending_off', 'stage', 'note',
  'deferred_until', 'opted_out_at',
  'order_ref', 'awb', 'courier', 'awb_at', 'ship_status', 'ship_history', 'ship_checked_at', 'ship_error', 'ship_phase',
]);

export async function updateContact(phone: string, patch: Partial<Contact>): Promise<Contact> {
  const set = Object.fromEntries(Object.entries(patch).filter(([k]) => UPDATABLE.has(k as keyof Contact)));
  if (Object.keys(set).length) {
    await db().update(contacts).set(set).where(and(eq(contacts.project, pid()), eq(contacts.phone, phone)));
  }
  return (await getContact(phone)) as Contact;
}

/** Jenis kiriman khusus di tabel messages (lihat schema.ts). */
export type MessageKind = 'followup' | 'dashboard';

/** Id pesan yang dicatat, atau null kalau id WhatsApp-nya sudah pernah dicatat (kiriman ganda). */
export async function addMessage(
  phone: string, dir: Dir, text: string, at: number, waId?: string | null, kind?: MessageKind, quote?: Quote | null
): Promise<number | null> {
  const rows = await db()
    .insert(messages)
    .values({ project: pid(), phone, dir, text, at, wa_id: waId ?? null, kind: kind ?? null, quote: quote ?? null })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  return rows[0]?.id ?? null;
}

export interface MessageRow {
  id: number;
  dir: Dir;
  text: string;
  at: number;
  kind: string | null;
  /** Pesan yang dikutip (pelanggan membalas pesan tertentu), atau null. */
  quote: Quote | null;
}

/** Riwayat satu percakapan, terlama dulu; `before` = hanya pesan dengan id lebih kecil (halaman sebelumnya). */
export async function messagePage(phone: string, limit: number, before?: number): Promise<MessageRow[]> {
  const rows = await db()
    .select({ id: messages.id, dir: messages.dir, text: messages.text, at: messages.at, kind: messages.kind, quote: messages.quote })
    .from(messages)
    .where(and(eq(messages.project, pid()), eq(messages.phone, phone), ...(before ? [lt(messages.id, before)] : [])))
    .orderBy(desc(messages.id))
    .limit(limit);
  return rows.reverse().map((r) => ({ ...r, dir: r.dir as Dir }));
}

export async function recentMessages(phone: string, n: number): Promise<{ dir: Dir; text: string; at: number; quote: Quote | null }[]> {
  const rows = await db()
    .select({ dir: messages.dir, text: messages.text, at: messages.at, quote: messages.quote })
    .from(messages)
    .where(and(eq(messages.project, pid()), eq(messages.phone, phone)))
    .orderBy(desc(messages.id))
    .limit(n);
  return rows.reverse().map((r) => ({ ...r, dir: r.dir as Dir }));
}

/**
 * Percakapan di sekitar satu pesan pelanggan (waktu `at`): pesan-pesan sebelumnya
 * (terlama dulu) dan pesan sejak pesan itu (termasuk pesan itu sendiri dan
 * balasan bot sesudahnya). Dipakai Pertanyaan yang belum terjawab.
 */
export async function messagesAround(
  phone: string, at: number, before = 8, after = 6
): Promise<{ before: { dir: Dir; text: string; at: number }[]; after: { dir: Dir; text: string; at: number }[] }> {
  const cols = { dir: messages.dir, text: messages.text, at: messages.at };
  const where = (cond: ReturnType<typeof lt>) => and(eq(messages.project, pid()), eq(messages.phone, phone), cond);
  const [prev, next] = await Promise.all([
    db().select(cols).from(messages).where(where(lt(messages.at, at))).orderBy(desc(messages.id)).limit(before),
    db().select(cols).from(messages).where(where(gte(messages.at, at))).orderBy(asc(messages.id)).limit(after),
  ]);
  const typed = (rows: typeof prev) => rows.map((r) => ({ ...r, dir: r.dir as Dir }));
  return { before: typed(prev.reverse()), after: typed(next) };
}

export async function countInboundSince(phone: string, since: number): Promise<number> {
  const [r] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.project, pid()), eq(messages.phone, phone), eq(messages.dir, 'in'), gte(messages.at, since)));
  return Number(r?.n ?? 0);
}

export async function setPause(address: string, until: number): Promise<void> {
  await db()
    .insert(pauses)
    .values({ project: pid(), address, until })
    .onConflictDoUpdate({ target: [pauses.project, pauses.address], set: { until } });
}

export async function pausedUntil(address: string): Promise<number> {
  const [r] = await db().select({ until: pauses.until }).from(pauses).where(and(eq(pauses.project, pid()), eq(pauses.address, address)));
  return r ? Number(r.until) : 0;
}

/** Catat bahwa admin manusia membalas / mengirimi alamat ini. */
export async function markHuman(address: string, at: number): Promise<void> {
  await db()
    .insert(humanSeen)
    .values({ project: pid(), address, at })
    .onConflictDoUpdate({ target: [humanSeen.project, humanSeen.address], set: { at } });
}

/** Kapan admin manusia terakhir membalas alamat ini; 0 = belum pernah. */
export async function humanSeenAt(address: string): Promise<number> {
  const [r] = await db().select({ at: humanSeen.at }).from(humanSeen).where(and(eq(humanSeen.project, pid()), eq(humanSeen.address, address)));
  return r ? Number(r.at) : 0;
}

/** Bot dimatikan untuk alamat ini lewat tombol di dashboard. */
export async function setBotOff(address: string, at: number): Promise<void> {
  await db()
    .insert(botOff)
    .values({ project: pid(), address, at })
    .onConflictDoUpdate({ target: [botOff.project, botOff.address], set: { at } });
}

export async function isBotOff(address: string): Promise<boolean> {
  const [r] = await db().select({ at: botOff.at }).from(botOff).where(and(eq(botOff.project, pid()), eq(botOff.address, address)));
  return Boolean(r);
}

/** Kembalikan chat ke bot: semua penahan (tombol, admin membalas, jeda) dilepas. */
export async function releaseToBot(address: string): Promise<void> {
  const p = pid();
  await db().delete(botOff).where(and(eq(botOff.project, p), eq(botOff.address, address)));
  await db().delete(humanSeen).where(and(eq(humanSeen.project, p), eq(humanSeen.address, address)));
  await db().delete(pauses).where(and(eq(pauses.project, p), eq(pauses.address, address)));
}

/** Semua penahan chat proyek ini sekaligus, untuk daftar lead (tanpa satu kueri per kontak). */
export async function chatHolds(): Promise<{ off: Set<string>; pauses: Map<string, number>; human: Set<string> }> {
  const p = pid();
  const [off, paused, human] = await Promise.all([
    db().select({ address: botOff.address }).from(botOff).where(eq(botOff.project, p)),
    db().select({ address: pauses.address, until: pauses.until }).from(pauses).where(eq(pauses.project, p)),
    db().select({ address: humanSeen.address }).from(humanSeen).where(eq(humanSeen.project, p)),
  ]);
  return {
    off: new Set(off.map((r) => r.address)),
    pauses: new Map(paused.map((r) => [r.address, Number(r.until)])),
    human: new Set(human.map((r) => r.address)),
  };
}

/**
 * Catat pelanggan lama yang diimpor pemilik. Kontak yang sudah ada tidak
 * ditimpa; hanya namanya diisi kalau belum ada. Mengembalikan true kalau
 * kontaknya baru dibuat.
 */
export async function importContact(phone: string, lead: Record<string, string>, off: boolean, at: number): Promise<boolean> {
  const existing = await getContact(phone);
  if (!existing) {
    // last_inbound_at 0: belum pernah chat dengan bot, jadi tidak ikut daftar "terbaru".
    await db().insert(contacts).values({
      project: pid(), phone, address: '', lead, first_seen_at: at, last_inbound_at: 0, last_dir: 'in', imported: 1, pending_off: off ? 1 : 0,
    });
    return true;
  }
  const merged = { ...lead, ...existing.lead };
  await db()
    .update(contacts)
    .set({ lead: merged, pending_off: off && !existing.address ? 1 : existing.pending_off })
    .where(and(eq(contacts.project, pid()), eq(contacts.phone, phone)));
  if (off && existing.address) await setBotOff(existing.address, at);
  return false;
}

/** Jumlah pelanggan lama yang pernah diimpor ke proyek ini. */
export async function countImported(): Promise<number> {
  const [r] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.project, pid()), eq(contacts.imported, 1)));
  return Number(r?.n ?? 0);
}

export interface ErrorRow {
  at: number;
  level: string;
  text: string;
}

let errorsSince = 0;
export async function addError(e: ErrorRow): Promise<void> {
  const p = pid();
  await db().insert(errors).values({ project: p, at: e.at, level: e.level, text: e.text });
  // Merapikan tiap sekian catatan saja; tabelnya tidak boleh tumbuh tanpa batas.
  if ((errorsSince += 1) % 50 === 0) {
    const keep = db().select({ id: errors.id }).from(errors).where(eq(errors.project, p)).orderBy(desc(errors.id)).limit(1000);
    await db().delete(errors).where(and(eq(errors.project, p), notInArray(errors.id, keep)));
  }
}

/** Level lama yang masih ada di baris yang sudah tersimpan -> level sekarang. */
const OLD_LEVELS: Record<string, string> = { galat: 'error', peringatan: 'warning' };

/** Catatan error, terbaru dulu. */
export async function recentErrors(n: number): Promise<ErrorRow[]> {
  const rows = await db()
    .select({ at: errors.at, level: errors.level, text: errors.text })
    .from(errors)
    .where(eq(errors.project, pid()))
    .orderBy(desc(errors.id))
    .limit(n);
  return rows.map((r) => ({ ...r, level: OLD_LEVELS[r.level] ?? r.level }));
}

export interface AlertRow {
  at: number;
  kind: string;
  key: string;
  text: string;
}

export async function addAlert(a: AlertRow): Promise<void> {
  const p = pid();
  await db().insert(alerts).values({ project: p, ...a });
  const keep = db().select({ id: alerts.id }).from(alerts).where(eq(alerts.project, p)).orderBy(desc(alerts.id)).limit(500);
  await db().delete(alerts).where(and(eq(alerts.project, p), notInArray(alerts.id, keep)));
}

/** Kapan warning sejenis (jenis + kunci) terakhir dicatat; 0 = belum pernah. */
export async function lastAlertAt(kind: string, key: string): Promise<number> {
  const [r] = await db()
    .select({ at: sql<string | null>`max(${alerts.at})` })
    .from(alerts)
    .where(and(eq(alerts.project, pid()), eq(alerts.kind, kind), eq(alerts.key, key)));
  return Number(r?.at ?? 0);
}

/** Warning terbaru dulu. */
export async function recentAlerts(n: number): Promise<AlertRow[]> {
  return db()
    .select({ at: alerts.at, kind: alerts.kind, key: alerts.key, text: alerts.text })
    .from(alerts)
    .where(eq(alerts.project, pid()))
    .orderBy(desc(alerts.id))
    .limit(n);
}

export async function followupCandidates(): Promise<Contact[]> {
  const rows = await db()
    .select()
    .from(contacts)
    // 'human' = pengingat setelah admin manusia membalas (lihat followup.ts).
    .where(and(eq(contacts.project, pid()), eq(contacts.followup_state, 'pending'), inArray(contacts.last_dir, ['out', 'human'])));
  return rows.map((r) => toContact(r) as Contact);
}

/** Kontak yang balasannya ditunda jam tenang dan sudah waktunya dibalas (`deferred_until` <= at). */
export async function dueDeferred(at: number): Promise<Contact[]> {
  const rows = await db()
    .select()
    .from(contacts)
    .where(and(eq(contacts.project, pid()), isNotNull(contacts.deferred_until), lte(contacts.deferred_until, at)))
    .orderBy(contacts.deferred_until);
  return rows.map((r) => toContact(r) as Contact);
}

/** Waktu balasan tertunda yang paling dekat (ms), atau null kalau tidak ada. */
export async function nextDeferredAt(): Promise<number | null> {
  const [r] = await db()
    .select({ at: sql<string | null>`min(${contacts.deferred_until})` })
    .from(contacts)
    .where(eq(contacts.project, pid()));
  return r?.at === null || r?.at === undefined ? null : Number(r.at);
}

/** Kontak terbaru, untuk daftar lead di dashboard. */
export async function recentContacts(n: number): Promise<Contact[]> {
  const rows = await db().select().from(contacts).where(eq(contacts.project, pid())).orderBy(desc(contacts.last_inbound_at)).limit(n);
  return rows.map((r) => toContact(r) as Contact);
}

export async function outboxAdd(kind: OutboxKind, payload: unknown, at: number): Promise<number> {
  const [r] = await db().insert(outbox).values({ project: pid(), kind, payload, created_at: at }).returning({ id: outbox.id });
  return (r as { id: number }).id;
}

/** Baris antrean yang belum terkirim; `only` = hanya satu jenis (mis. balasan dari dashboard). */
export async function outboxPending(maxAttempts: number, only?: readonly OutboxKind[]): Promise<OutboxRow[]> {
  const rows = await db()
    .select({ id: outbox.id, kind: outbox.kind, payload: outbox.payload, attempts: outbox.attempts })
    .from(outbox)
    .where(and(eq(outbox.project, pid()), isNull(outbox.done_at), lt(outbox.attempts, maxAttempts), ...(only ? [inArray(outbox.kind, [...only])] : [])))
    .orderBy(outbox.id);
  return rows.map((r) => ({ ...r, kind: r.kind as OutboxKind }));
}

/** Balasan dari dashboard untuk nomor ini yang belum terkirim (masih menunggu, atau gagal). */
export async function pendingReplies(phone: string): Promise<{ id: number; payload: unknown; attempts: number; created_at: number }[]> {
  return db()
    .select({ id: outbox.id, payload: outbox.payload, attempts: outbox.attempts, created_at: outbox.created_at })
    .from(outbox)
    .where(and(eq(outbox.project, pid()), eq(outbox.kind, 'reply'), isNull(outbox.done_at), sql`${outbox.payload}->>'phone' = ${phone}`))
    .orderBy(outbox.id);
}

/** Keadaan beberapa baris antrean (pesan tes): sudah terkirim, atau berapa kali gagal. */
export async function outboxState(ids: number[]): Promise<{ id: number; done_at: number | null; attempts: number }[]> {
  if (!ids.length) return [];
  return db()
    .select({ id: outbox.id, done_at: outbox.done_at, attempts: outbox.attempts })
    .from(outbox)
    .where(and(eq(outbox.project, pid()), inArray(outbox.id, ids)))
    .orderBy(outbox.id);
}

export async function outboxDone(id: number, at: number): Promise<void> {
  await db().update(outbox).set({ done_at: at }).where(eq(outbox.id, id));
}

export async function outboxFailed(id: number): Promise<void> {
  await db().update(outbox).set({ attempts: sql`${outbox.attempts} + 1` }).where(eq(outbox.id, id));
}

// ---------------------------------------------------------------------------
// Pertanyaan yang dioper ke staf (lihat flow.ts dan halaman Pengetahuan)
// ---------------------------------------------------------------------------

/** Bentuk pembanding pertanyaan: huruf kecil, tanpa tanda baca, spasi dirapatkan. */
export function normQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface HandoffRow {
  id: number;
  phone: string;
  question: string;
  at: number;
  resolved_at: number | null;
  answer: string | null;
  resolution: string | null;
}

const handoffCols = {
  id: handoffs.id, phone: handoffs.phone, question: handoffs.question, at: handoffs.at,
  resolved_at: handoffs.resolved_at, answer: handoffs.answer, resolution: handoffs.resolution,
};

/**
 * Catat pertanyaan yang dioper ke staf. Tidak dicatat ulang selama pertanyaan
 * yang sama (setelah dinormalkan) dari nomor yang sama belum diselesaikan.
 * True kalau barisnya baru.
 */
export async function addHandoff(phone: string, question: string, at: number): Promise<boolean> {
  const q = question.replace(/\s+/g, ' ').trim().slice(0, 1000);
  const norm = normQuestion(q);
  if (!norm) return false;
  const open = await db()
    .select({ question: handoffs.question })
    .from(handoffs)
    .where(and(eq(handoffs.project, pid()), eq(handoffs.phone, phone), isNull(handoffs.resolved_at)));
  if (open.some((r) => normQuestion(r.question) === norm)) return false;
  await db().insert(handoffs).values({ project: pid(), phone, question: q, at });
  return true;
}

/** Pertanyaan terbaru dulu; `resolved` memilih yang sudah atau belum diselesaikan. */
export async function listHandoffs(resolved: boolean, limit = 1000): Promise<HandoffRow[]> {
  return db()
    .select(handoffCols)
    .from(handoffs)
    .where(and(eq(handoffs.project, pid()), resolved ? isNotNull(handoffs.resolved_at) : isNull(handoffs.resolved_at)))
    .orderBy(desc(handoffs.id))
    .limit(limit);
}

export async function getHandoff(id: number): Promise<HandoffRow | undefined> {
  const [r] = await db().select(handoffCols).from(handoffs).where(and(eq(handoffs.project, pid()), eq(handoffs.id, id))).limit(1);
  return r;
}

/** Tandai baris-baris ini selesai. */
export async function resolveHandoffs(ids: number[], resolution: 'ditambahkan' | 'diajarkan' | 'diabaikan', answer: string | null, at: number): Promise<void> {
  if (!ids.length) return;
  await db()
    .update(handoffs)
    .set({ resolved_at: at, resolution, answer })
    .where(and(eq(handoffs.project, pid()), inArray(handoffs.id, ids)));
}

/** Isian staf untuk satu kontak: tahap, catatan, nomor pesanan, resi, kurir (null = kosongkan). */
export interface StaffPatch {
  stage?: Stage;
  note?: string | null;
  order_ref?: string | null;
  awb?: string | null;
  courier?: string | null;
}

/** Hasil pelacakan dikosongkan: resi atau kurirnya berganti, jadi status lama tidak berlaku lagi. */
const SHIP_RESET = { ship_status: null, ship_history: null, ship_checked_at: null, ship_error: null, ship_phase: null } as const;

/**
 * Ubah tahap pipeline, catatan, dan/atau data pesanan satu kontak. Undefined
 * kalau kontaknya tidak ada. Resi berganti (termasuk dikosongkan): `awb_at`
 * diisi ulang dan hasil pelacakan dikosongkan. Hanya kurir yang berganti
 * padahal resi ada: sama, supaya resi lama yang kurirnya baru dibetulkan staf
 * dicek lagi selama 30 hari.
 */
export async function setStageNote(phone: string, patch: StaffPatch, at = now()): Promise<Contact | undefined> {
  const c = await getContact(phone);
  if (!c) return undefined;
  const set: Partial<Contact> = { ...patch };
  const awbChanged = 'awb' in patch && (patch.awb ?? null) !== c.awb;
  const courierChanged = 'courier' in patch && (patch.courier ?? null) !== c.courier;
  if (awbChanged) Object.assign(set, { awb_at: patch.awb ? at : null }, SHIP_RESET);
  else if (courierChanged && c.awb) Object.assign(set, { awb_at: at }, SHIP_RESET);
  return updateContact(phone, set);
}

/** Isian pesanan dari chat pelanggan (src/flow.ts captureOrder). */
export interface OrderFill {
  order_ref?: string;
  awb?: string;
  courier?: string;
}

/**
 * Isi nomor pesanan, resi, dan kurir dari chat, hanya kalau kolomnya di
 * database masih kosong, dengan UPDATE bersyarat per kolom: isian staf yang
 * masuk sesaat sebelumnya tidak ditimpa. Resi yang diisi: `awb_at` = `at` dan
 * hasil pelacakan dikosongkan. Kurir hanya diisi kalau resi di database sama
 * dengan `fill.awb` (resi yang baru diisi atau yang sudah tersimpan); tanpa
 * `fill.awb` kurir tidak diisi. Mengembalikan kontak sesudahnya.
 */
export async function fillOrder(phone: string, fill: OrderFill, at: number): Promise<Contact> {
  const where = (...cond: ReturnType<typeof eq>[]) => and(eq(contacts.project, pid()), eq(contacts.phone, phone), ...cond);
  if (fill.order_ref) {
    await db().update(contacts).set({ order_ref: fill.order_ref }).where(where(isNull(contacts.order_ref)));
  }
  if (fill.awb) {
    await db().update(contacts).set({ awb: fill.awb, awb_at: at, ...SHIP_RESET }).where(where(isNull(contacts.awb)));
  }
  if (fill.courier && fill.awb) {
    await db().update(contacts).set({ courier: fill.courier }).where(where(isNull(contacts.courier), eq(contacts.awb, fill.awb)));
  }
  return (await getContact(phone)) as Contact;
}

/** Resi, kurir, dan `awb_at` yang dicek; hasil pelacakan hanya berlaku kalau ketiganya di database masih sama. */
export interface TrackExpect {
  awb: string;
  courier: string;
  awb_at: number | null;
}

/** Syarat WHERE: resi, kurir, dan `awb_at` di database sama dengan `expect`. */
function sameAwb(expect: TrackExpect) {
  return and(
    eq(contacts.awb, expect.awb),
    eq(contacts.courier, expect.courier),
    sql`${contacts.awb_at} is not distinct from ${expect.awb_at}::bigint`,
  );
}

/**
 * Naikkan tahap ke `to` hanya kalau tahap di database saat ini salah satu dari
 * `from`, dalam satu UPDATE bersyarat. Perubahan staf yang terjadi sementara
 * itu (misalnya "batal") tidak ditimpa. Dengan `expect`: hanya kalau resi,
 * kurir, dan `awb_at` di database masih sama (staf bisa menggantinya sesaat
 * sebelumnya). True kalau tahapnya berubah.
 */
export async function advanceStage(phone: string, from: readonly Stage[], to: Stage, expect?: TrackExpect): Promise<boolean> {
  if (!from.length) return false;
  const rows = await db()
    .update(contacts)
    .set({ stage: to })
    .where(and(
      eq(contacts.project, pid()),
      eq(contacts.phone, phone),
      inArray(contacts.stage, [...from]),
      expect ? sameAwb(expect) : undefined,
    ))
    .returning({ phone: contacts.phone });
  return rows.length > 0;
}

/**
 * Simpan hasil pelacakan hanya kalau resi, kurir, dan `awb_at` di database
 * masih sama dengan yang dicek, dalam satu UPDATE bersyarat. Staf bisa
 * mengganti resi selama menunggu jawaban kurir; hasil untuk resi lama tidak
 * boleh menempel di resi baru. True kalau barisnya berubah.
 */
export async function saveTracking(phone: string, expect: TrackExpect, patch: Partial<Contact>): Promise<boolean> {
  const set = Object.fromEntries(Object.entries(patch).filter(([k]) => UPDATABLE.has(k as keyof Contact)));
  if (!Object.keys(set).length) return false;
  const rows = await db()
    .update(contacts)
    .set(set)
    .where(and(eq(contacts.project, pid()), eq(contacts.phone, phone), sameAwb(expect)))
    .returning({ phone: contacts.phone });
  return rows.length > 0;
}

/** Resi dilacak paling lama sekian lama sejak diisi. */
export const TRACK_WINDOW_MS = 30 * 24 * 3_600_000;
/** Satu resi dicek paling sering sekali dalam sekian lama. */
export const TRACK_EVERY_MS = 30 * 60_000;
/** Pengecekan terakhir error atau statusnya bermasalah: dicek lagi paling cepat sekian lama kemudian (hemat saldo Binderbyte). */
export const TRACK_RETRY_MS = 6 * 3_600_000;

/**
 * Kontak yang resinya perlu dicek sekarang: resi dan kurir terisi, tahap belum
 * selesai/batal, resi diisi dalam 30 hari terakhir, dan belum dicek dalam 30
 * menit terakhir (6 jam kalau pengecekan terakhir error atau statusnya
 * bermasalah). Yang paling lama tidak dicek dulu. Jeda 6 jam ada di SQL,
 * bukan di JS: kalau tidak, baris bermasalah memenuhi batas `limit` dan resi
 * lain tidak pernah dicek.
 */
export async function trackingCandidates(at: number, limit: number): Promise<Contact[]> {
  const rows = await db()
    .select()
    .from(contacts)
    .where(and(
      eq(contacts.project, pid()),
      isNotNull(contacts.awb),
      isNotNull(contacts.courier),
      notInArray(contacts.stage, ['selesai', 'batal']),
      gte(contacts.awb_at, at - TRACK_WINDOW_MS),
      or(
        isNull(contacts.ship_checked_at),
        and(
          isNull(contacts.ship_error),
          or(isNull(contacts.ship_phase), ne(contacts.ship_phase, 'problem')),
          lt(contacts.ship_checked_at, at - TRACK_EVERY_MS),
        ),
        and(
          or(isNotNull(contacts.ship_error), eq(contacts.ship_phase, 'problem')),
          lt(contacts.ship_checked_at, at - TRACK_RETRY_MS),
        ),
      ),
    ))
    .orderBy(sql`${contacts.ship_checked_at} asc nulls first`, contacts.phone)
    .limit(limit);
  return rows.map((r) => toContact(r) as Contact);
}

// ---------------------------------------------------------------------------
// Angka di Beranda dashboard
// ---------------------------------------------------------------------------

export interface Metrics {
  /** Jumlah percakapan (nomor berbeda yang mengirim pesan) per hari, terlama dulu. */
  days: { day: string; conversations: number }[];
  /** Percakapan di jendela ini, dan berapa yang dioper ke staf. */
  handed: { total: number; count: number };
  /** Median detik dari pesan pelanggan ke balasan bot berikutnya (dibatasi 1 jam); null = belum ada. */
  replyMedianSec: number | null;
  /** Pelanggan yang dikirimi follow-up, dan berapa yang membalas dalam 48 jam. */
  followup: { sent: number; answered: number };
  /** Jumlah baris pesan per hari menurut arahnya (masuk, dibalas bot, dibalas admin), terlama dulu. */
  messagesByDay: { day: string; in: number; out: number; human: number }[];
  /** Jumlah kontak per tahap pipeline, semua kontak proyek ini (tidak dibatasi jendela). */
  stages: Record<Stage, number>;
}

/**
 * Empat angka Beranda untuk `days` (hari menurut zona waktu bot, terlama
 * dulu). `since` = batas bawah kasar untuk indeks; yang menentukan adalah
 * tanggal lokalnya.
 */
export async function metrics(days: string[], since: number, tz: string): Promise<Metrics> {
  const p = pid();
  const first = days[0] as string;
  const dayOf = (col: unknown) => sql`to_char(to_timestamp(${col} / 1000.0) AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
  const inWindow = (col: unknown) => sql`${col} >= ${since} AND ${dayOf(col)} >= ${first}`;

  const perDay = await db().execute(sql`
    SELECT ${dayOf(sql.raw('m.at'))} AS day, count(DISTINCT m.phone)::int AS n
    FROM messages m
    WHERE m.project = ${p} AND m.dir = 'in' AND ${inWindow(sql.raw('m.at'))}
    GROUP BY 1`);
  const byDay = new Map(rowsOf<{ day: string; n: number }>(perDay).map((r) => [String(r.day), Number(r.n)]));

  const handed = rowsOf<{ total: number; count: number }>(await db().execute(sql`
    WITH conv AS (
      SELECT DISTINCT m.phone FROM messages m
      WHERE m.project = ${p} AND m.dir = 'in' AND ${inWindow(sql.raw('m.at'))}
    )
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE
        EXISTS (SELECT 1 FROM contacts c WHERE c.project = ${p} AND c.phone = conv.phone AND c.needs_sales = 1)
        OR EXISTS (SELECT 1 FROM handoffs h WHERE h.project = ${p} AND h.phone = conv.phone AND ${inWindow(sql.raw('h.at'))})
      )::int AS count
    FROM conv`))[0];

  const median = rowsOf<{ median: number | null }>(await db().execute(sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY least(r.secs, 3600)) AS median
    FROM (
      SELECT (o.at - i.at) / 1000.0 AS secs
      FROM messages i
      JOIN LATERAL (
        SELECT o.at FROM messages o
        WHERE o.project = i.project AND o.phone = i.phone AND o.dir = 'out' AND o.id > i.id
          AND (o.kind IS NULL OR o.kind <> 'followup')
        ORDER BY o.id LIMIT 1
      ) o ON true
      WHERE i.project = ${p} AND i.dir = 'in' AND ${inWindow(sql.raw('i.at'))}
    ) r`))[0];

  const fu = rowsOf<{ sent: number; answered: number }>(await db().execute(sql`
    SELECT count(DISTINCT f.phone)::int AS sent,
      count(DISTINCT f.phone) FILTER (WHERE EXISTS (
        SELECT 1 FROM messages i
        WHERE i.project = f.project AND i.phone = f.phone AND i.dir = 'in' AND i.at > f.at AND i.at <= f.at + ${48 * 3_600_000}
      ))::int AS answered
    FROM messages f
    WHERE f.project = ${p} AND f.kind = 'followup' AND ${inWindow(sql.raw('f.at'))}`))[0];

  const msgRows = rowsOf<{ day: string; dir: string; n: number }>(await db().execute(sql`
    SELECT ${dayOf(sql.raw('m.at'))} AS day, m.dir AS dir, count(*)::int AS n
    FROM messages m
    WHERE m.project = ${p} AND ${inWindow(sql.raw('m.at'))}
    GROUP BY 1, 2`));
  const msgs = new Map<string, { in: number; out: number; human: number }>();
  for (const r of msgRows) {
    const d = msgs.get(String(r.day)) ?? { in: 0, out: 0, human: 0 };
    if (r.dir === 'in' || r.dir === 'out' || r.dir === 'human') d[r.dir] += Number(r.n);
    msgs.set(String(r.day), d);
  }

  const stageRows = rowsOf<{ stage: string; n: number }>(await db().execute(sql`
    SELECT c.stage AS stage, count(*)::int AS n FROM contacts c WHERE c.project = ${p} GROUP BY 1`));
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const r of stageRows) if ((STAGES as readonly string[]).includes(r.stage)) stages[r.stage as Stage] += Number(r.n);

  return {
    days: days.map((day) => ({ day, conversations: byDay.get(day) ?? 0 })),
    handed: { total: Number(handed?.total ?? 0), count: Number(handed?.count ?? 0) },
    replyMedianSec: median?.median === null || median?.median === undefined ? null : Math.round(Number(median.median)),
    followup: { sent: Number(fu?.sent ?? 0), answered: Number(fu?.answered ?? 0) },
    messagesByDay: days.map((day) => ({ day, ...(msgs.get(day) ?? { in: 0, out: 0, human: 0 }) })),
    stages,
  };
}

/** Baris hasil db().execute: node-postgres memberi { rows }, PGlite juga. */
function rowsOf<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
}

export interface UsageDay {
  day: string;
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

/** Tambahkan pemakaian LLM ke hari itu (hari menurut zona waktu bot). */
export async function addUsage(d: UsageDay): Promise<void> {
  await db()
    .insert(llmUsage)
    .values({
      project: pid(), day: d.day, calls: d.calls, prompt_tokens: d.promptTokens, cached_tokens: d.cachedTokens, completion_tokens: d.completionTokens,
    })
    .onConflictDoUpdate({
      target: [llmUsage.project, llmUsage.day],
      set: {
        calls: sql`${llmUsage.calls} + excluded.calls`,
        prompt_tokens: sql`${llmUsage.prompt_tokens} + excluded.prompt_tokens`,
        cached_tokens: sql`${llmUsage.cached_tokens} + excluded.cached_tokens`,
        completion_tokens: sql`${llmUsage.completion_tokens} + excluded.completion_tokens`,
      },
    });
}

/** Pemakaian per hari, terbaru dulu. */
export async function usageDays(n: number): Promise<UsageDay[]> {
  return db()
    .select({
      day: llmUsage.day, calls: llmUsage.calls, promptTokens: llmUsage.prompt_tokens,
      cachedTokens: llmUsage.cached_tokens, completionTokens: llmUsage.completion_tokens,
    })
    .from(llmUsage)
    .where(eq(llmUsage.project, pid()))
    .orderBy(desc(llmUsage.day))
    .limit(n);
}

/** Jumlah cek resi satu hari: otomatis (ikut batas harian) dan manual (tombol "Cek resi"). */
export interface TrackCounts {
  auto: number;
  manual: number;
}

/** Jumlah cek resi proyek ini pada `day` (YYYY-MM-DD, tanggal lokal); 0 kalau belum ada. */
export async function trackUsageToday(day: string): Promise<TrackCounts> {
  const [r] = await db()
    .select({ auto: trackUsage.n, manual: trackUsage.n_manual })
    .from(trackUsage)
    .where(and(eq(trackUsage.project, pid()), eq(trackUsage.day, day)));
  return { auto: r?.auto ?? 0, manual: r?.manual ?? 0 };
}

/** Tambah satu cek resi otomatis atau manual pada `day`; mengembalikan jumlah sesudahnya. */
export async function bumpTrackUsage(day: string, kind: 'auto' | 'manual'): Promise<TrackCounts> {
  const col = kind === 'auto' ? trackUsage.n : trackUsage.n_manual;
  const [r] = await db()
    .insert(trackUsage)
    .values({ project: pid(), day, n: kind === 'auto' ? 1 : 0, n_manual: kind === 'manual' ? 1 : 0 })
    .onConflictDoUpdate({ target: [trackUsage.project, trackUsage.day], set: { [kind === 'auto' ? 'n' : 'n_manual']: sql`${col} + 1` } })
    .returning({ auto: trackUsage.n, manual: trackUsage.n_manual });
  return { auto: r?.auto ?? 0, manual: r?.manual ?? 0 };
}

/** Jumlah cek resi per hari, terbaru dulu (seperti usageDays). */
export async function trackUsageDays(n: number): Promise<({ day: string } & TrackCounts)[]> {
  return db()
    .select({ day: trackUsage.day, auto: trackUsage.n, manual: trackUsage.n_manual })
    .from(trackUsage)
    .where(eq(trackUsage.project, pid()))
    .orderBy(desc(trackUsage.day))
    .limit(n);
}

// ---------------------------------------------------------------------------
// Toko Tokopedia & Shop: tautan toko, pesanan, dan webhook (lihat src/tiktok.ts)
// ---------------------------------------------------------------------------

/** Status pesanan yang berarti sudah dibayar (ejaan API). */
export const PAID_STATUSES = ['AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING', 'AWAITING_COLLECTION', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'] as const;

/** Syarat SQL: pesanan sudah dibayar, HANYA menurut statusnya (sama dengan isPaid di src/tiktok.ts; ditahan dan batal tidak). */
const orderPaid = () => inArray(orders.status, [...PAID_STATUSES]);

/** Tautan toko proyek ini, atau undefined. */
export async function getShopLink(): Promise<ShopLink | undefined> {
  const [r] = await db().select().from(shopLinks).where(eq(shopLinks.project, pid())).limit(1);
  return r;
}

/**
 * Tautan toko dengan id toko ini, di proyek mana pun (webhook hanya membawa
 * shop_id), juga tautan yang diputus dari dashboard (`unlinked`). Tautan
 * aktif dulu: tautan lama yang kedaluwarsa atau diputus di proyek lain tidak
 * boleh menerima webhook toko yang sekarang aktif di proyek ini.
 */
export async function shopLinkByShopId(shopId: string): Promise<ShopLink | undefined> {
  const [r] = await db()
    .select()
    .from(shopLinks)
    .where(eq(shopLinks.shop_id, shopId))
    .orderBy(sql`(${shopLinks.status} = 'active') desc`, desc(shopLinks.updated_at))
    .limit(1);
  return r;
}

/** Tautan AKTIF toko ini di proyek lain selain `exceptProject`, atau undefined. */
export async function activeShopLinkByShopId(shopId: string, exceptProject: string): Promise<ShopLink | undefined> {
  const [r] = await db()
    .select()
    .from(shopLinks)
    .where(and(eq(shopLinks.shop_id, shopId), eq(shopLinks.status, 'active'), ne(shopLinks.project, exceptProject)))
    .limit(1);
  return r;
}

/** Semua tautan toko yang aktif, semua proyek (putaran berkala dashboard). */
export async function activeShopLinks(): Promise<ShopLink[]> {
  return db().select().from(shopLinks).where(eq(shopLinks.status, 'active')).orderBy(shopLinks.project);
}

/** Simpan tautan toko proyek ini (baru, atau menimpa yang lama). */
export async function saveShopLink(row: Omit<ShopLink, 'project'>): Promise<ShopLink> {
  const values = { ...row, project: pid() };
  const { project: _project, ...set } = values;
  const [r] = await db().insert(shopLinks).values(values).onConflictDoUpdate({ target: shopLinks.project, set }).returning();
  return r as ShopLink;
}

/** Ubah sebagian tautan toko proyek ini; undefined kalau tidak ada. */
export async function updateShopLink(patch: Partial<Omit<ShopLink, 'project'>>): Promise<ShopLink | undefined> {
  const [r] = await db().update(shopLinks).set(patch).where(eq(shopLinks.project, pid())).returning();
  return r;
}

/** Hapus baris tautan toko proyek ini (pencabutan izin dari toko; pemutusan dari dashboard memakai status `unlinked`). */
export async function deleteShopLink(): Promise<void> {
  await db().delete(shopLinks).where(eq(shopLinks.project, pid()));
}

/**
 * Simpan satu pesanan (baru, atau menimpa data marketplace yang lama).
 * Data yang lebih tua tidak menimpa yang lebih baru: baris tersimpan hanya
 * ditimpa kalau `update_time`-nya kosong atau tidak lebih baru dari yang
 * masuk (misalnya webhook masuk di tengah sinkron yang lama). Kalau tidak
 * ditimpa, baris tersimpan yang dikembalikan; null kalau baris itu sudah
 * dihapus sementara itu (mis. izin toko dicabut). `contact_phone` tidak
 * disentuh: tautan ke percakapan diatur matchOrder dan staf.
 */
export async function upsertOrderRow(row: Omit<OrderRow, 'project' | 'contact_phone'>): Promise<OrderRow | null> {
  const values = { ...row, project: pid() };
  const { project: _project, order_id: _id, ...set } = values;
  const [r] = await db()
    .insert(orders)
    .values(values)
    .onConflictDoUpdate({
      target: [orders.project, orders.order_id],
      set,
      setWhere: sql`${orders.update_time} is null or excluded.update_time >= ${orders.update_time}`,
    })
    .returning();
  if (r) return r;
  return (await getOrder(row.order_id)) ?? null;
}

export async function getOrder(orderId: string): Promise<OrderRow | undefined> {
  const [r] = await db().select().from(orders).where(and(eq(orders.project, pid()), eq(orders.order_id, orderId))).limit(1);
  return r;
}

/** Tautkan pesanan ke percakapan (null = lepas). Undefined kalau pesanannya tidak ada. */
export async function setOrderContact(orderId: string, phone: string | null): Promise<OrderRow | undefined> {
  const [r] = await db()
    .update(orders)
    .set({ contact_phone: phone })
    .where(and(eq(orders.project, pid()), eq(orders.order_id, orderId)))
    .returning();
  return r;
}

/**
 * Lepas pesanan dari percakapan ini, kecuali `keepOrderId`: nomor pesanannya
 * diganti atau dikosongkan, jadi pesanan lama tidak boleh lagi mengubah resi
 * dan tahapnya. Null = lepas semua. Mengembalikan jumlah yang dilepas.
 */
export async function detachOrdersExcept(phone: string, keepOrderId: string | null): Promise<number> {
  const rows = await db()
    .update(orders)
    .set({ contact_phone: null })
    .where(and(eq(orders.project, pid()), eq(orders.contact_phone, phone), ...(keepOrderId ? [ne(orders.order_id, keepOrderId)] : [])))
    .returning({ id: orders.order_id });
  return rows.length;
}

/** Hapus semua pesanan toko ini di proyek ini (toko memutus izin aplikasi). Mengembalikan jumlahnya. */
export async function deleteOrders(shopId: string): Promise<number> {
  const rows = await db()
    .delete(orders)
    .where(and(eq(orders.project, pid()), eq(orders.shop_id, shopId)))
    .returning({ id: orders.order_id });
  return rows.length;
}

/**
 * Toko mencabut izin aplikasi: hapus semua pesanan dan semua baris tautan
 * toko ini di SEMUA proyek (tidak terikat proyek yang sedang dilayani),
 * juga tautan yang diputus dari dashboard di proyek lain. Pesanan dan
 * tautan dihapus dalam satu transaksi: kalau gagal, tidak ada yang terhapus
 * dan percobaan berikutnya mengulang semuanya. Mengembalikan proyek yang
 * tersentuh (urut) dan jumlah pesanan yang dihapus.
 */
export async function deleteShopEverywhere(shopId: string): Promise<{ projects: string[]; orders: number }> {
  return db().transaction(async (tx) => {
    const gone = await tx.delete(orders).where(eq(orders.shop_id, shopId)).returning({ project: orders.project });
    const links = await tx.delete(shopLinks).where(eq(shopLinks.shop_id, shopId)).returning({ project: shopLinks.project });
    const projects = [...new Set([...gone, ...links].map((r) => r.project))].sort();
    return { projects, orders: gone.length };
  });
}

/** Pesanan terbaru dulu (menurut waktu ubah di marketplace). */
export async function listOrders(limit: number): Promise<OrderRow[]> {
  return db()
    .select()
    .from(orders)
    .where(eq(orders.project, pid()))
    .orderBy(sql`${orders.update_time} desc nulls last`, desc(orders.order_id))
    .limit(limit);
}

/**
 * `total` = pesanan yang dibuat sejak `since` (ms). `unmatched` = SEMUA
 * pesanan yang sudah dibayar tapi belum tertaut ke percakapan, tanpa batas
 * tanggal, supaya angka di sidebar sama dengan saringan "belum tertaut".
 */
export async function orderCounts(since: number): Promise<{ total: number; unmatched: number }> {
  const [r] = await db()
    .select({
      total: sql<number>`count(*) filter (where coalesce(${orders.create_time}, ${orders.update_time}, ${orders.synced_at}) >= ${since})::int`,
      unmatched: sql<number>`count(*) filter (where ${and(orderPaid(), isNull(orders.contact_phone))})::int`,
    })
    .from(orders)
    .where(eq(orders.project, pid()));
  return { total: Number(r?.total ?? 0), unmatched: Number(r?.unmatched ?? 0) };
}

/**
 * Pesanan satu percakapan: yang ditautkan ke nomor ini (terbaru dulu), atau
 * yang nomor pesanannya sama dengan `orderRef` dan belum tertaut ke
 * percakapan lain (percakapan tidak pernah menampilkan pesanan pembeli lain).
 * Undefined kalau tidak ada.
 */
export async function orderForContact(phone: string, orderRef: string | null): Promise<OrderRow | undefined> {
  const byRef = orderRef ? and(eq(orders.order_id, orderRef), or(isNull(orders.contact_phone), eq(orders.contact_phone, phone))) : undefined;
  const [r] = await db()
    .select()
    .from(orders)
    .where(and(eq(orders.project, pid()), or(eq(orders.contact_phone, phone), byRef)))
    .orderBy(sql`(${orders.contact_phone} = ${phone}) desc nulls last`, sql`${orders.update_time} desc nulls last`)
    .limit(1);
  return r;
}

/**
 * Pesanan yang belum tertaut, padahal ada percakapan dengan nomor pesanan
 * yang sama (nomor itu dicatat sebelum pesanannya masuk). Paling banyak 500.
 */
export async function unmatchedOrdersWithRef(limit = 500): Promise<OrderRow[]> {
  return db()
    .selectDistinct({ order: orders })
    .from(orders)
    .innerJoin(contacts, and(eq(contacts.project, orders.project), eq(contacts.order_ref, orders.order_id)))
    .where(and(eq(orders.project, pid()), isNull(orders.contact_phone)))
    .limit(limit)
    .then((rows) => rows.map((r) => r.order));
}

/** Kontak yang nomor pesanannya sama persis dengan `orderRef` (yang terakhir chat dulu). */
export async function contactByOrderRef(orderRef: string): Promise<Contact | undefined> {
  const [r] = await db()
    .select()
    .from(contacts)
    .where(and(eq(contacts.project, pid()), eq(contacts.order_ref, orderRef)))
    .orderBy(desc(contacts.last_inbound_at))
    .limit(1);
  return toContact(r);
}

/** Webhook disimpan sekian lama untuk menolak kiriman ganda (TikTok mengulang paling lama ±15 jam). */
const WEBHOOK_KEEP_MS = 7 * 24 * 3_600_000;

/** Jenis webhook "toko mencabut izin": dicoba lagi sampai berhasil, tidak pernah dibuang. */
const WEBHOOK_DEAUTH = 6;

/** Webhook dengan id ini sudah pernah diproses sampai selesai (bukan yang masih menunggu dicoba lagi). */
export async function hasWebhookEvent(id: string): Promise<boolean> {
  const [r] = await db()
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.id, id), isNull(webhookEvents.pending)))
    .limit(1);
  return Boolean(r);
}

/** Catatan satu webhook: kapan pertama masuk (`at`), dan `pending` (null = selesai diproses). */
export async function getWebhookEvent(id: string): Promise<{ at: number; pending: Record<string, unknown> | null; tries: number } | undefined> {
  const [r] = await db()
    .select({ at: webhookEvents.at, pending: webhookEvents.pending, tries: webhookEvents.tries })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id))
    .limit(1);
  return r;
}

/**
 * Simpan webhook yang baru masuk SEBELUM server menjawab 200: isinya
 * disimpan sebagai menunggu (`pending`, 0 percobaan), jadi webhook ini tidak
 * hilang kalau proses berhenti sebelum selesai memprosesnya; putaran berkala
 * mencobanya lagi. Proyeknya disebut terang (server belum ada di proyek).
 * 'baru' = baru disimpan; 'selesai' = id ini sudah pernah selesai diproses;
 * 'menunggu' = id ini sudah ada dan masih menunggu (diproses atau dicoba lagi).
 */
export async function receiveWebhookEvent(
  project: string, id: string, type: number, event: Record<string, unknown>, at: number
): Promise<'baru' | 'selesai' | 'menunggu'> {
  const [r] = await db()
    .insert(webhookEvents)
    .values({ id, project, type, at, pending: event, tries: 0 })
    .onConflictDoNothing({ target: webhookEvents.id })
    .returning({ id: webhookEvents.id });
  if (r) {
    await pruneWebhookEvents(at);
    return 'baru';
  }
  const [old] = await db().select({ pending: webhookEvents.pending }).from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
  return old && old.pending === null ? 'selesai' : 'menunggu';
}

/**
 * Buang catatan webhook yang lebih tua dari 7 hari. Webhook pencabutan izin
 * yang belum berhasil tetap disimpan: itu harus dicoba lagi sampai berhasil.
 */
async function pruneWebhookEvents(at: number): Promise<void> {
  await db()
    .delete(webhookEvents)
    .where(and(lt(webhookEvents.at, at - WEBHOOK_KEEP_MS), or(isNull(webhookEvents.pending), ne(webhookEvents.type, WEBHOOK_DEAUTH))));
}

/**
 * Catat satu webhook sebagai selesai diproses (baru, atau yang tadinya
 * menunggu dicoba lagi). Catatan lama dibuang sekalian.
 */
export async function finishWebhookEvent(id: string, type: number, at: number): Promise<void> {
  await db()
    .insert(webhookEvents)
    .values({ id, project: pid(), type, at })
    .onConflictDoUpdate({ target: webhookEvents.id, set: { pending: null, last_error: null } });
  await pruneWebhookEvents(at);
}

/**
 * Catat satu webhook yang gagal diproses (atau pesanannya belum terbaca):
 * isinya disimpan untuk dicoba lagi, jumlah percobaan naik satu.
 * Mengembalikan jumlah percobaan yang gagal sejauh ini.
 */
export async function failWebhookEvent(id: string, type: number, event: Record<string, unknown>, error: string, at: number): Promise<number> {
  const [r] = await db()
    .insert(webhookEvents)
    .values({ id, project: pid(), type, at, pending: event, tries: 1, last_error: error })
    .onConflictDoUpdate({
      target: webhookEvents.id,
      set: { pending: event, tries: sql`${webhookEvents.tries} + 1`, last_error: error },
    })
    .returning({ tries: webhookEvents.tries });
  await pruneWebhookEvents(at);
  return r?.tries ?? 1;
}

/** Webhook yang menunggu dicoba lagi dan belum menyerah: kurang dari `maxTries` percobaan, atau pencabutan izin. */
const webhookRetryable = (maxTries: number) =>
  and(isNotNull(webhookEvents.pending), or(lt(webhookEvents.tries, maxTries), eq(webhookEvents.type, WEBHOOK_DEAUTH)));

/** Webhook proyek ini yang menunggu dicoba lagi, terlama dulu, paling banyak `limit`. */
export async function pendingWebhookEvents(
  limit: number, maxTries: number
): Promise<{ id: string; type: number; at: number; pending: Record<string, unknown>; tries: number }[]> {
  const rows = await db()
    .select({ id: webhookEvents.id, type: webhookEvents.type, at: webhookEvents.at, pending: webhookEvents.pending, tries: webhookEvents.tries })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.project, pid()), webhookRetryable(maxTries)))
    .orderBy(asc(webhookEvents.at), asc(webhookEvents.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, pending: r.pending ?? {} }));
}

/** Proyek yang punya webhook yang menunggu dicoba lagi (semua proyek; putaran berkala dashboard). */
export async function pendingWebhookProjects(maxTries: number): Promise<string[]> {
  const rows = await db().selectDistinct({ project: webhookEvents.project }).from(webhookEvents).where(webhookRetryable(maxTries));
  return rows.map((r) => r.project);
}

// ---------------------------------------------------------------------------
// Proyek, profil, dan laporan bot (id proyek disebut terang)
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  return db().select().from(projects).orderBy(projects.created_at, projects.id);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const [r] = await db().select().from(projects).where(eq(projects.id, id)).limit(1);
  return r;
}

export interface NewProject {
  id: string;
  name: string;
  template: string;
  wa_number?: string | null;
  sales_number?: string | null;
  transport?: string;
}

/** Buat proyek (dan profil kosongnya). False kalau id itu sudah ada; yang ada tidak ditimpa. */
export async function createProject(p: NewProject, at = Date.now()): Promise<boolean> {
  const rows = await db()
    .insert(projects)
    .values({
      id: p.id, name: p.name, template: p.template, wa_number: p.wa_number ?? null, sales_number: p.sales_number ?? null,
      transport: p.transport ?? 'baileys', created_at: at, updated_at: at,
    })
    .onConflictDoNothing()
    .returning({ id: projects.id });
  await db().insert(profiles).values({ project: p.id, data: {}, updated_at: at }).onConflictDoNothing();
  return rows.length > 0;
}

/**
 * `updated_at` baru yang selalu lebih besar dari yang lama, walau dua simpanan
 * jatuh di milidetik yang sama — bot memakai angka ini untuk tahu ada perubahan.
 */
const later = (col: typeof projects.updated_at | typeof profiles.updated_at, at: number) => sql<number>`greatest(${at}, ${col} + 1)`;

export type ProjectPatch = Partial<Pick<Project, 'name' | 'enabled' | 'paused' | 'transport' | 'wa_number' | 'sales_number'>>;

/** Ubah baris proyek. Bot yang sedang jalan memuat ulang begitu `updated_at` berubah. */
export async function updateProject(id: string, patch: ProjectPatch): Promise<Project | undefined> {
  const [r] = await db()
    .update(projects)
    .set({ ...patch, updated_at: later(projects.updated_at, Date.now()) })
    .where(eq(projects.id, id))
    .returning();
  return r;
}

/** Permintaan dashboard untuk bot (kode pairing / tautkan ulang); null = selesai ditangani. */
export async function setPairingRequest(id: string, req: PairingRequest | null): Promise<void> {
  // Tanpa menyentuh updated_at: ini bukan perubahan profil, bot tidak perlu memuat ulang.
  await db().update(projects).set({ pairing_request: req }).where(eq(projects.id, id));
}

export async function getProfile(project: string): Promise<Record<string, unknown>> {
  const [r] = await db().select({ data: profiles.data }).from(profiles).where(eq(profiles.project, project)).limit(1);
  return r?.data ?? {};
}

export async function saveProfile(project: string, data: Record<string, unknown>, at = Date.now()): Promise<void> {
  await db()
    .insert(profiles)
    .values({ project, data, updated_at: at })
    .onConflictDoUpdate({ target: profiles.project, set: { data, updated_at: later(profiles.updated_at, at) } });
}

/**
 * Kapan proyek ini terakhir berubah (profil atau barisnya); 0 = tidak ada.
 * Satu kueri murah — bot memanggilnya sebelum giliran untuk tahu perlu memuat ulang atau tidak.
 */
export async function projectStamp(id: string): Promise<number> {
  const [r] = await db()
    .select({ p: projects.updated_at, f: profiles.updated_at })
    .from(projects)
    .leftJoin(profiles, eq(profiles.project, projects.id))
    .where(eq(projects.id, id))
    .limit(1);
  return r ? Math.max(Number(r.p), Number(r.f ?? 0)) : 0;
}

export type StatusPatch = Partial<Omit<ProjectStatus, 'project'>>;

/** Laporan bot untuk proyek yang sedang dilayani. */
export async function writeStatus(patch: StatusPatch): Promise<void> {
  const project = pid();
  await db()
    .insert(projectStatus)
    .values({ state: 'starting', ...patch, project })
    .onConflictDoUpdate({ target: projectStatus.project, set: Object.keys(patch).length ? patch : { project } });
}

export async function readStatus(project: string): Promise<ProjectStatus | undefined> {
  const [r] = await db().select().from(projectStatus).where(eq(projectStatus.project, project)).limit(1);
  return r;
}

export async function readAllStatus(): Promise<ProjectStatus[]> {
  return db().select().from(projectStatus);
}
