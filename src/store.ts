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

import { and, desc, eq, gte, isNull, lt, notInArray, sql } from 'drizzle-orm';

import { db } from './db';
import {
  alerts, botOff, contacts, errors, humanSeen, llmUsage, messages, outbox, pauses, profiles, projects, projectStatus,
  type PairingRequest, type Project, type ProjectStatus,
} from './db/schema';
import { currentProject } from './project';

export type { PairingRequest, Project, ProjectStatus };

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
  return { ...rest, lead, last_dir: rest.last_dir as Dir, followup_state: rest.followup_state as FollowupState };
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
  'followup_state', 'followup_total', 'lead_sent_at', 'handoff_sent_at', 'summary', 'wa_name', 'handled_at', 'pending_off',
]);

export async function updateContact(phone: string, patch: Partial<Contact>): Promise<Contact> {
  const set = Object.fromEntries(Object.entries(patch).filter(([k]) => UPDATABLE.has(k as keyof Contact)));
  if (Object.keys(set).length) {
    await db().update(contacts).set(set).where(and(eq(contacts.project, pid()), eq(contacts.phone, phone)));
  }
  return (await getContact(phone)) as Contact;
}

/** False kalau id pesan itu sudah pernah dicatat (kiriman ganda). */
export async function addMessage(phone: string, dir: Dir, text: string, at: number, waId?: string | null): Promise<boolean> {
  const rows = await db()
    .insert(messages)
    .values({ project: pid(), phone, dir, text, at, wa_id: waId ?? null })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  return rows.length > 0;
}

export async function recentMessages(phone: string, n: number): Promise<{ dir: Dir; text: string; at: number }[]> {
  const rows = await db()
    .select({ dir: messages.dir, text: messages.text, at: messages.at })
    .from(messages)
    .where(and(eq(messages.project, pid()), eq(messages.phone, phone)))
    .orderBy(desc(messages.id))
    .limit(n);
  return rows.reverse().map((r) => ({ ...r, dir: r.dir as Dir }));
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

/** Catatan galat, terbaru dulu. */
export async function recentErrors(n: number): Promise<ErrorRow[]> {
  return db()
    .select({ at: errors.at, level: errors.level, text: errors.text })
    .from(errors)
    .where(eq(errors.project, pid()))
    .orderBy(desc(errors.id))
    .limit(n);
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

/** Kapan peringatan sejenis (jenis + kunci) terakhir dicatat; 0 = belum pernah. */
export async function lastAlertAt(kind: string, key: string): Promise<number> {
  const [r] = await db()
    .select({ at: sql<string | null>`max(${alerts.at})` })
    .from(alerts)
    .where(and(eq(alerts.project, pid()), eq(alerts.kind, kind), eq(alerts.key, key)));
  return Number(r?.at ?? 0);
}

/** Peringatan terbaru dulu. */
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
    .where(and(eq(contacts.project, pid()), eq(contacts.followup_state, 'pending'), eq(contacts.last_dir, 'out')));
  return rows.map((r) => toContact(r) as Contact);
}

/** Kontak terbaru, untuk daftar lead di dashboard. */
export async function recentContacts(n: number): Promise<Contact[]> {
  const rows = await db().select().from(contacts).where(eq(contacts.project, pid())).orderBy(desc(contacts.last_inbound_at)).limit(n);
  return rows.map((r) => toContact(r) as Contact);
}

export async function outboxAdd(kind: OutboxRow['kind'], payload: unknown, at: number): Promise<void> {
  await db().insert(outbox).values({ project: pid(), kind, payload, created_at: at });
}

export async function outboxPending(maxAttempts: number): Promise<OutboxRow[]> {
  const rows = await db()
    .select({ id: outbox.id, kind: outbox.kind, payload: outbox.payload, attempts: outbox.attempts })
    .from(outbox)
    .where(and(eq(outbox.project, pid()), isNull(outbox.done_at), lt(outbox.attempts, maxAttempts)))
    .orderBy(outbox.id);
  return rows.map((r) => ({ ...r, kind: r.kind as OutboxRow['kind'] }));
}

export async function outboxDone(id: number, at: number): Promise<void> {
  await db().update(outbox).set({ done_at: at }).where(eq(outbox.id, id));
}

export async function outboxFailed(id: number): Promise<void> {
  await db().update(outbox).set({ attempts: sql`${outbox.attempts} + 1` }).where(eq(outbox.id, id));
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
