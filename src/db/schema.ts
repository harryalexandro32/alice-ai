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

/** Satu baris riwayat perjalanan paket dari kurir (lihat src/tracking.ts). */
export interface ShipEvent {
  date: string;
  desc: string;
  location: string;
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
  /** Alasan / error terakhir, untuk ditampilkan. */
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
    /** Tahap pipeline: baru | menunggu | dihubungi | link | payment | dikirim | selesai | batal (lihat STAGES di src/store.ts). */
    stage: text('stage').notNull().default('baru'),
    /** Catatan staf tentang pelanggan ini. */
    note: text('note'),
    /** Balasan ditunda sampai jam tenang berakhir (ms); null = tidak ada balasan yang ditunda. */
    deferred_until: ms('deferred_until'),
    /** Pelanggan minta tidak dihubungi lagi (ms); null = tidak. Dihapus hanya oleh pemilik. */
    opted_out_at: ms('opted_out_at'),
    /** Nomor pesanan marketplace atau nomor invoice, apa adanya. */
    order_ref: text('order_ref'),
    /** Nomor resi pengiriman. */
    awb: text('awb'),
    /** Kode kurir Binderbyte (lihat COURIERS di src/tracking.ts). */
    courier: text('courier'),
    /** Kapan resi terakhir diisi atau diganti (ms). */
    awb_at: ms('awb_at'),
    /** Status kurir dari pelacakan terakhir yang berhasil, apa adanya (mis. DELIVERED). */
    ship_status: text('ship_status'),
    /** Riwayat perjalanan paket, terbaru dulu, paling banyak 20 baris. */
    ship_history: jsonb('ship_history').$type<ShipEvent[] | null>(),
    /** Kapan resi terakhir dicek (berhasil atau error), ms. */
    ship_checked_at: ms('ship_checked_at'),
    /** Pesan error dari pengecekan terakhir yang gagal; null setelah berhasil. */
    ship_error: text('ship_error'),
    /** Fase dari status kurir saat dicek: delivered | transit | pending | problem | unknown; lihat phaseOf. */
    ship_phase: text('ship_phase'),
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
    /** Jenis kiriman khusus: 'followup' (pengingat bot) atau 'dashboard' (dibalas staf dari web); null = biasa. */
    kind: text('kind'),
    /** Pesan yang dikutip pelanggan saat membalas (fitur "balas" WhatsApp); null = tidak mengutip. */
    quote: jsonb('quote').$type<import('../transport/types').Quote | null>(),
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

/** Antrean lead ke sales dan balasan dari dashboard; dicoba ulang sampai berhasil. */
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

/**
 * Pertanyaan pelanggan yang dioper bot ke staf karena tidak bisa dijawabnya.
 * Pemilik menjawabnya sekali di dashboard; jawabannya masuk ke "Pengetahuan
 * lain", jadi lain kali bot bisa menjawab sendiri.
 */
export const handoffs = pgTable(
  'handoffs',
  {
    id: serial('id').primaryKey(),
    project: text('project').notNull(),
    phone: text('phone').notNull(),
    question: text('question').notNull(),
    at: ms('at').notNull(),
    resolved_at: ms('resolved_at'),
    answer: text('answer'),
    /** ditambahkan (jawabannya masuk pengetahuan) | diajarkan (jadi pelajaran untuk bot) | diabaikan */
    resolution: text('resolution'),
  },
  (t) => [index('handoffs_project').on(t.project, t.id)]
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

/**
 * Jumlah cek resi per proyek per hari (tanggal lokal, YYYY-MM-DD): `n` untuk
 * cek otomatis, `n_manual` untuk tombol "Cek resi" di dashboard. Disimpan di
 * database supaya batas harian TRACK_DAILY_MAX (hanya untuk `n`) tetap
 * berlaku walau bot dijalankan ulang, dan supaya biayanya bisa ditampilkan.
 */
export const trackUsage = pgTable(
  'track_usage',
  {
    project: text('project').notNull(),
    day: text('day').notNull(),
    n: integer('n').notNull().default(0),
    // Cek resi manual dari tombol "Cek resi" (tidak ikut batas harian).
    n_manual: integer('n_manual').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.project, t.day] })]
);

/** Satu barang di pesanan marketplace: unit dengan SKU yang sama digabung (`qty`). */
export interface OrderItem {
  name: string;
  sku: string;
  qty: number;
  /** Harga satuan dari marketplace, apa adanya (teks, mis. "125000"). */
  price: string;
}

/**
 * Tautan toko Tokopedia & Shop (aplikasi TikTok Shop Partner Center), satu
 * per proyek (lihat src/tiktok.ts). Token disimpan apa adanya di database
 * lokal: PostgreSQL hanya mendengar di 127.0.0.1.
 */
export const shopLinks = pgTable(
  'shop_links',
  {
    project: text('project').primaryKey(),
    shop_id: text('shop_id').notNull(),
    /** Dikirim sebagai `shop_cipher` di tiap panggilan API pesanan. */
    shop_cipher: text('shop_cipher').notNull(),
    shop_name: text('shop_name'),
    region: text('region'),
    seller_name: text('seller_name'),
    open_id: text('open_id'),
    access_token: text('access_token').notNull(),
    access_expires_at: ms('access_expires_at').notNull(),
    refresh_token: text('refresh_token').notNull(),
    refresh_expires_at: ms('refresh_expires_at').notNull(),
    granted_scopes: jsonb('granted_scopes').$type<string[]>().notNull().default([]),
    linked_at: ms('linked_at').notNull(),
    /** Kapan pesanan terakhir disinkronkan (ms); null = belum pernah. */
    last_sync_at: ms('last_sync_at'),
    /**
     * active | expired | revoked | unlinked. `unlinked` = diputus dari dashboard:
     * token dan cipher kosong, baris disimpan supaya webhook pencabutan izin
     * toko ini tetap sampai dan menghapus pesanannya.
     */
    status: text('status').notNull().default('active'),
    /** Error terakhir (sinkron atau perpanjangan token); null sesudah berhasil. */
    error: text('error'),
    updated_at: ms('updated_at').notNull(),
  },
  (t) => [index('shop_links_shop').on(t.shop_id)]
);

/**
 * Pesanan dari toko yang ditautkan, satu baris per pesanan. Waktu dalam ms.
 * `contact_phone` = percakapan yang cocok (nomor pesanan sama dengan
 * `contacts.order_ref`, atau ditautkan staf); null = belum tertaut.
 */
export const orders = pgTable(
  'orders',
  {
    project: text('project').notNull(),
    order_id: text('order_id').notNull(),
    shop_id: text('shop_id').notNull(),
    /** TOKOPEDIA | TIKTOK_SHOP | TIKTOK_SHOP_APP */
    platform: text('platform'),
    /** Ejaan API: UNPAID, ON_HOLD, AWAITING_SHIPMENT, …, CANCELLED. */
    status: text('status').notNull(),
    create_time: ms('create_time'),
    update_time: ms('update_time'),
    paid_time: ms('paid_time'),
    cancel_time: ms('cancel_time'),
    total_amount: text('total_amount'),
    currency: text('currency'),
    payment_method: text('payment_method'),
    is_cod: boolean('is_cod').notNull().default(false),
    buyer_user_id: text('buyer_user_id'),
    /** Nama dan nomor penerima, disamarkan marketplace (apa adanya). */
    recipient_name: text('recipient_name'),
    recipient_phone: text('recipient_phone'),
    items: jsonb('items').$type<OrderItem[]>().notNull().default([]),
    tracking_number: text('tracking_number'),
    shipping_provider: text('shipping_provider'),
    fulfillment_type: text('fulfillment_type'),
    shipping_type: text('shipping_type'),
    cancel_reason: text('cancel_reason'),
    contact_phone: text('contact_phone'),
    synced_at: ms('synced_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.project, t.order_id] }), index('orders_update_time').on(t.project, t.update_time)]
);

/**
 * Webhook Tokopedia & Shop (dikirim paling sedikit sekali): id =
 * tts_notification_id. `pending` kosong = sudah diproses. `pending` terisi =
 * gagal diproses (atau pesanannya belum terbaca): isi webhook-nya disimpan
 * untuk dicoba lagi oleh putaran berkala, karena server langsung menjawab 200
 * dan TikTok tidak mengirim ulang.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    project: text('project').notNull(),
    type: integer('type').notNull(),
    /** Kapan webhook ini pertama masuk (ms). */
    at: ms('at').notNull(),
    /** Isi webhook yang belum berhasil diproses; null = selesai. */
    pending: jsonb('pending').$type<Record<string, unknown>>(),
    /** Jumlah percobaan yang gagal. */
    tries: integer('tries').notNull().default(0),
    /** Error percobaan terakhir; null sesudah berhasil. */
    last_error: text('last_error'),
  },
  (t) => [index('webhook_events_at').on(t.at)]
);

export type Project = typeof projects.$inferSelect;
export type ShopLink = typeof shopLinks.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type ProjectStatus = typeof projectStatus.$inferSelect;
