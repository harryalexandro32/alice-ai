/**
 * Skema database (PostgreSQL) — satu-satunya tempat bentuk tabel ditulis.
 *
 * Satu database untuk semua proyek. Satu proyek = satu bisnis = satu nomor
 * WhatsApp; setiap baris data membawa kolom `project`, jadi lead, profil,
 * dan pengaturan antarproyek tidak pernah bercampur.
 *
 * Mengubah skema: ubah berkas ini, lalu `npm run db:generate` membuat berkas
 * migrasi SQL di drizzle/. Migrasi dijalankan otomatis saat bot/dashboard
 * start (lihat src/db/index.ts) dan oleh deploy/deploy.sh.
 *
 * Nama properti sama dengan nama kolomnya (snake_case), supaya baris dari
 * database bisa langsung dipakai sebagai `Contact` dan sejenisnya.
 *
 * Data lead disimpan sebagai JSON (`lead`), bukan kolom tetap: field apa yang
 * dikumpulkan ditentukan profil bisnis, bukan skema.
 */

import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, unique } from 'drizzle-orm/pg-core';

/** Milidetik sejak epoch, seperti Date.now(). */
const ms = (name: string) => bigint(name, { mode: 'number' });

/** Permintaan dari dashboard untuk proses bot: minta kode pairing, atau tautkan ulang. */
export interface PairingRequest {
  /** Nomor bot (hanya angka) untuk kode pairing. */
  number?: string;
  /** True = putuskan sesi WhatsApp yang sekarang dan mulai menautkan dari awal. */
  reset?: boolean;
  at: number;
}

/** Satu baris per bisnis. `id` = slug pendek, mis. "gfan". */
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Kunci bibit profil di kode (src/business/<template>/), mis. "gfan" atau "generic". */
  template: text('template').notNull().default('generic'),
  /** False = bot proyek ini tidak dijalankan (layanan systemd-nya dimatikan). */
  enabled: boolean('enabled').notNull().default(true),
  /** True = bot dijeda untuk semua chat: pesan tetap dicatat, tapi tidak dibalas. */
  paused: boolean('paused').notNull().default(false),
  transport: text('transport').notNull().default('baileys'),
  /** Nomor WhatsApp bot, "+62…". */
  wa_number: text('wa_number'),
  /** Nomor sales: "+62…" atau "self" (nomor bot sendiri). */
  sales_number: text('sales_number'),
  pairing_request: jsonb('pairing_request').$type<PairingRequest | null>(),
  created_at: ms('created_at').notNull(),
  updated_at: ms('updated_at').notNull(),
});

/**
 * Profil bisnis hasil dashboard: salam, data produk, panduan rekomendasi,
 * pengaturan, daftar berkas. `data` = bagian yang bisa diubah (Editable);
 * bibitnya di src/business/<template>/profile.ts dipakai untuk kunci yang
 * belum ada di sini.
 */
export const profiles = pgTable('profiles', {
  project: text('project')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  updated_at: ms('updated_at').notNull(),
});

/**
 * Laporan berkala proses bot (detak jantung). Dashboard berjalan di proses
 * lain, jadi keadaan WhatsApp, QR, dan kode pairing dibaca dari sini.
 */
export const projectStatus = pgTable('project_status', {
  project: text('project').primaryKey(),
  /** starting | qr | pairing | connected | disconnected | logged_out | conflict | stopped */
  state: text('state').notNull().default('stopped'),
  /** Isi QR mentah (dirender jadi gambar di dashboard), atau null. */
  qr: text('qr'),
  pairing_code: text('pairing_code'),
  self_phone: text('self_phone'),
  /** Alasan / galat terakhir, untuk ditampilkan. */
  detail: text('detail'),
  usage_calls: integer('usage_calls'),
  usage_limit: integer('usage_limit'),
  guard: text('guard'),
  transport: text('transport'),
  effective: jsonb('effective').$type<Record<string, unknown>>(),
  channels: jsonb('channels').$type<Record<string, boolean>>(),
  version: text('version'),
  pid: integer('pid'),
  started_at: ms('started_at'),
  last_seen_at: ms('last_seen_at'),
});

export const contacts = pgTable(
  'contacts',
  {
    project: text('project').notNull(),
    phone: text('phone').notNull(),
    address: text('address').notNull(),
    lead: jsonb('lead').$type<Record<string, string>>().notNull().default({}),
    needs_sales: integer('needs_sales').notNull().default(0),
    first_seen_at: ms('first_seen_at').notNull(),
    last_inbound_at: ms('last_inbound_at').notNull(),
    last_dir: text('last_dir').notNull().default('in'),
    last_out_text: text('last_out_text'),
    followup_state: text('followup_state').notNull().default('idle'),
    followup_total: integer('followup_total').notNull().default(0),
    lead_sent_at: ms('lead_sent_at'),
    handoff_sent_at: ms('handoff_sent_at'),
    summary: text('summary'),
    wa_name: text('wa_name'),
    handled_at: ms('handled_at'),
    imported: integer('imported').notNull().default(0),
    pending_off: integer('pending_off').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.project, t.phone] }),
    index('contacts_address').on(t.project, t.address),
    index('contacts_last_inbound').on(t.project, t.last_inbound_at),
  ]
);

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    project: text('project').notNull(),
    phone: text('phone').notNull(),
    dir: text('dir').notNull(),
    text: text('text').notNull(),
    at: ms('at').notNull(),
    wa_id: text('wa_id'),
  },
  (t) => [index('messages_phone').on(t.project, t.phone, t.id), unique('messages_wa_id').on(t.project, t.wa_id)]
);

/** Bot diam untuk alamat ini sampai `until` (admin membalas sendiri). */
export const pauses = pgTable(
  'pauses',
  {
    project: text('project').notNull(),
    address: text('address').notNull(),
    until: ms('until').notNull(),
  },
  (t) => [primaryKey({ columns: [t.project, t.address] })]
);

/** Bot dimatikan untuk alamat ini lewat tombol di dashboard. */
export const botOff = pgTable(
  'bot_off',
  {
    project: text('project').notNull(),
    address: text('address').notNull(),
    at: ms('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.project, t.address] })]
);

/** Kapan admin manusia terakhir membalas alamat ini. */
export const humanSeen = pgTable(
  'human_seen',
  {
    project: text('project').notNull(),
    address: text('address').notNull(),
    at: ms('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.project, t.address] })]
);

export const alerts = pgTable(
  'alerts',
  {
    id: serial('id').primaryKey(),
    project: text('project').notNull(),
    at: ms('at').notNull(),
    kind: text('kind').notNull(),
    key: text('key').notNull().default(''),
    text: text('text').notNull(),
  },
  (t) => [index('alerts_project').on(t.project, t.id)]
);

export const errors = pgTable(
  'errors',
  {
    id: serial('id').primaryKey(),
    project: text('project').notNull(),
    at: ms('at').notNull(),
    level: text('level').notNull(),
    text: text('text').notNull(),
  },
  (t) => [index('errors_project').on(t.project, t.id)]
);

/** Antrean lead ke sales / Sheet; dicoba ulang sampai berhasil. */
export const outbox = pgTable(
  'outbox',
  {
    id: serial('id').primaryKey(),
    project: text('project').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    created_at: ms('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    done_at: ms('done_at'),
  },
  (t) => [index('outbox_project').on(t.project, t.id)]
);

export const llmUsage = pgTable(
  'llm_usage',
  {
    project: text('project').notNull(),
    day: text('day').notNull(),
    calls: integer('calls').notNull().default(0),
    prompt_tokens: integer('prompt_tokens').notNull().default(0),
    cached_tokens: integer('cached_tokens').notNull().default(0),
    completion_tokens: integer('completion_tokens').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.project, t.day] })]
);

export type Project = typeof projects.$inferSelect;
export type ProjectStatus = typeof projectStatus.$inferSelect;
