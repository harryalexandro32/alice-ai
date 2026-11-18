/**
 * Profil bisnis proyek yang sedang dilayani (lihat src/project.ts).
 *
 * `biz` bukan objek biasa: ia selalu membaca profil proyek yang sedang
 * dilayani — proyek proses bot, atau proyek permintaan dashboard. Modul lain
 * cukup membaca `biz.x` dan selalu mendapat nilai terbaru.
 *
 * Profil = bibit di kode (src/business/<template>/profile.ts) + perubahan
 * pemilik dari dashboard (tabel profiles di database). Bot yang sedang jalan
 * memeriksa apakah profil atau baris proyeknya berubah (refreshBiz) dan
 * memuat ulang tanpa restart.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cfg, normPhone, projectCfg, settingsCfg, TUNABLE, type Settings, type TunableKey } from '../config';
import { currentProject, defaultProject, maybeProject, setDefaultProject, type ProjectCtx } from '../project';
import { getProfile, getProject, projectStamp, saveProfile, type Project } from '../store';
import { isPdf, linksOf, renderCatalog, renderProducts, validateCatalog, validateProducts } from './catalog';
import { generic } from './generic/profile';
import { gfan } from './gfan/profile';
import {
  EDITABLE, type Business, type Editable, type LeadField, type Lesson, type MediaFile, type NotifyKind, type Recipient, type Route,
} from './types';

/** Bibit profil yang bisa dipilih saat membuat proyek. */
export const REGISTRY: Record<string, Business> = { gfan, generic };
export const TEMPLATES = Object.keys(REGISTRY);

const own = (): Record<string | symbol, unknown> => currentProject().biz as unknown as Record<string | symbol, unknown>;

/** Profil proyek yang sedang dilayani. Melempar kalau belum ada proyek. */
export const biz: Business = new Proxy({} as Business, {
  get: (_t, key) => own()[key],
  set: (_t, key, value) => {
    own()[key] = value;
    return true;
  },
  has: (_t, key) => key in own(),
  ownKeys: () => Reflect.ownKeys(own()),
  getOwnPropertyDescriptor: (_t, key) =>
    key in own() ? { value: own()[key], writable: true, enumerable: true, configurable: true } : undefined,
});

export const dataDir = (): string => join(cfg.dataRoot, currentProject().id);
export const mediaDir = (): string => join(dataDir(), 'media');

/** Rakit konteks proyek: bibit + perubahan pemilik + baris proyek. Tanpa database. */
export function buildCtx(row: Project, overrides: Partial<Editable> = {}, stamp = 0): ProjectCtx {
  let seed = REGISTRY[row.template];
  if (!seed) {
    console.warn(`[profil] bibit "${row.template}" untuk proyek ${row.id} tidak dikenal; memakai bibit umum`);
    seed = generic;
  }
  const ctx: ProjectCtx = {
    id: row.id, row, seed, biz: { ...seed, id: row.id }, cfg: projectCfg(row, {}), stamp,
    pdfTexts: new Map(), pdfVersion: 0, rendered: null,
  };
  apply(ctx, overrides);
  return ctx;
}

/** Tes dan alat bantu: konteks dari bibit saja, tanpa database. */
export function seedCtx(template = 'gfan', id = template): ProjectCtx {
  const at = Date.now();
  return buildCtx({
    id, name: id, template, enabled: true, paused: false, transport: 'baileys', wa_number: null, sales_number: null,
    pairing_request: null, created_at: at, updated_at: at,
  });
}

/** Muat proyek dari database. Undefined kalau id-nya tidak ada. */
export async function loadProject(id: string): Promise<ProjectCtx | undefined> {
  const row = await getProject(id);
  if (!row) return undefined;
  const [data, stamp] = await Promise.all([getProfile(id), projectStamp(id)]);
  return buildCtx(row, data as Partial<Editable>, stamp);
}

/** Pakai bibit + perubahan ini sebagai profil yang berlaku (tanpa menyimpan). */
export function applyOverrides(overrides: Partial<Editable>): void {
  apply(currentProject(), overrides);
}

function apply(ctx: ProjectCtx, overrides: Partial<Editable>): void {
  const b = { ...ctx.seed, id: ctx.id } as Business;
  for (const k of EDITABLE) {
    if (overrides[k] !== undefined) (b as unknown as Record<string, unknown>)[k] = overrides[k];
  }
  // Profil yang disimpan sebelum data produk berbentuk tabel: seluruh
  // pengetahuannya satu teks. Teks itu tetap dipakai apa adanya.
  const legacy = (overrides as { knowledge?: unknown }).knowledge;
  if (typeof legacy === 'string' && overrides.catalog === undefined && overrides.notes === undefined) {
    b.catalog = [];
    b.notes = legacy;
  }
  b.lessons = Array.isArray(b.lessons) ? b.lessons : [];
  // Produk yang disimpan sebelum ada tautan marketplace: tanpa tautan.
  b.products = (b.products ?? []).map((p) => ({ ...p, links: linksOf(p.links) }));
  // Profil lama bisa menyimpan penerima dengan jalur yang sudah dihapus: hanya
  // WhatsApp dan email yang dipakai, dan penerima tanpa keduanya dibuang diam-diam.
  b.recipients = (b.recipients ?? [])
    .filter((r) => r && (r.phone || r.email))
    .map((r) => ({ name: r.name, role: r.role, phone: r.phone, email: r.email }));
  ctx.biz = b;
  syncPdfTexts(ctx);
  // Pengaturan dari dashboard menimpa bawaan .env untuk proyek ini.
  Object.assign(ctx.cfg, settingsCfg(b.settings));
}

// Isi PDF yang boleh dibaca bot (MediaFile.read), per id berkas. Teksnya ada
// di folder media sebagai <id>.txt (ditulis dashboard saat PDF diunggah).
/** Batas teks per PDF yang masuk ke prompt: lebih dari ini, tiap balasan jadi mahal. */
const PDF_TEXT_MAX = 8000;

export function setPdfText(id: string, text: string): void {
  const ctx = currentProject();
  if (ctx.pdfTexts.get(id) === text) return;
  ctx.pdfTexts.set(id, text);
  ctx.pdfVersion += 1;
}

function syncPdfTexts(ctx: ProjectCtx): void {
  const wanted = new Set(ctx.biz.files.filter((f) => isPdf(f) && f.read).map((f) => f.id));
  for (const id of [...ctx.pdfTexts.keys()]) {
    if (!wanted.has(id)) {
      ctx.pdfTexts.delete(id);
      ctx.pdfVersion += 1;
    }
  }
  for (const id of wanted) {
    if (ctx.pdfTexts.has(id)) continue;
    try {
      ctx.pdfTexts.set(id, readFileSync(join(cfg.dataRoot, ctx.id, 'media', `${id}.txt`), 'utf8'));
      ctx.pdfVersion += 1;
    } catch {
      // teksnya belum ada di mesin ini; dicoba lagi saat profil dimuat ulang
    }
  }
}

function renderPdfTexts(ctx: ProjectCtx): string {
  return ctx.biz.files
    .filter((f) => isPdf(f) && f.read && ctx.pdfTexts.get(f.id))
    .map(
      (f) =>
        `ISI PDF "${f.name}" — dibaca otomatis dari berkasnya. Susunan tabelnya bisa bergeser: kalau sebuah angka ` +
        `tidak jelas milik produk atau kolom yang mana, jangan ditebak — lampirkan PDF-nya dan serahkan ke tim.\n${(ctx.pdfTexts.get(f.id) as string).slice(0, PDF_TEXT_MAX)}`
    )
    .join('\n\n');
}

/**
 * Satu-satunya sumber jawaban bot: tabel produk + catatan bebas, sebagai teks.
 * Dirakit ulang hanya kalau profilnya berganti, jadi teksnya sama persis dari
 * panggilan ke panggilan (awalan prompt yang di-cache penyedia LLM).
 */
export function knowledgeText(): string {
  const ctx = currentProject();
  const b = ctx.biz;
  const r = ctx.rendered;
  if (r?.products !== b.products || r.catalog !== b.catalog || r.notes !== b.notes || r.files !== b.files || r.pdf !== ctx.pdfVersion) {
    const text = [renderProducts(b.products), renderCatalog(b.catalog), b.notes.trim(), renderPdfTexts(ctx)].filter(Boolean).join('\n\n');
    ctx.rendered = { products: b.products, catalog: b.catalog, notes: b.notes, files: b.files, pdf: ctx.pdfVersion, text };
  }
  return (ctx.rendered as { text: string }).text;
}

export const fileById = (id: string): MediaFile | undefined => biz.files.find((f) => f.id === id);

/** Id berkas yang masih dipakai: lampiran produk dan logo. */
export function referencedFiles(): Set<string> {
  return new Set([...biz.products.flatMap((x) => [...x.photos, x.pdf]), biz.logo].filter(Boolean));
}

/** Nama produk yang memakai berkas ini — jadi keterangan saat dikirim. */
export function productOfFile(id: string): string | null {
  return biz.products.find((x) => x.pdf === id || x.photos.includes(id))?.name ?? null;
}

/**
 * Mulai melayani satu proyek di proses ini (bot, mode latihan, eval): muat
 * dari database dan jadikan proyek bawaan proses.
 */
export async function initBiz(id = process.env.PROJECT?.trim() ?? '', opts: { requireEnabled?: boolean } = {}): Promise<ProjectCtx> {
  if (!id) throw new Error('PROJECT belum diisi (mis. PROJECT=gfan)');
  const ctx = await loadProject(id);
  if (!ctx) throw new Error(`proyek "${id}" tidak ada di database. Buat lewat dashboard, atau jalankan npm run db:seed untuk gfan.`);
  if (opts.requireEnabled !== false && !ctx.row.enabled) throw new Error(`proyek "${id}" sedang dinonaktifkan di dashboard`);
  setDefaultProject(ctx);
  mkdirSync(mediaDir(), { recursive: true });
  return ctx;
}

/** Jarak minimum antar pemeriksaan "profil berubah?" di proses bot. */
const REFRESH_EVERY_MS = 5000;
let checkedAt = 0;

/**
 * Proses bot: muat ulang proyeknya kalau profil atau baris proyeknya berubah
 * sejak dimuat (satu kueri murah, paling sering tiap 5 detik; `force`
 * melewati jeda itu). True kalau dimuat ulang.
 */
export async function refreshBiz(force = false): Promise<boolean> {
  const ctx = defaultProject();
  // Di dalam withProject (dashboard) tiap permintaan sudah memuat proyeknya sendiri.
  if (!ctx || maybeProject() !== ctx) return false;
  const t = Date.now();
  if (!force && t - checkedAt < REFRESH_EVERY_MS) return false;
  checkedAt = t;
  if ((await projectStamp(ctx.id)) === ctx.stamp) return false;
  const next = await loadProject(ctx.id);
  if (!next) return false;
  setDefaultProject(next);
  console.log(`[profil] ${ctx.id}: perubahan dari dashboard dimuat`);
  return true;
}

const text = (v: unknown, max: number, name: string, required = false): string => {
  if (typeof v !== 'string') throw new Error(`${name} harus berupa teks`);
  const s = v.replace(/\r\n/g, '\n').trim();
  if (required && !s) throw new Error(`${name} tidak boleh kosong`);
  if (s.length > max) throw new Error(`${name} terlalu panjang (maksimal ${max} karakter)`);
  return s;
};

/**
 * Periksa masukan dari dashboard. Melempar pesan yang bisa ditampilkan ke
 * pemilik. Hanya kunci yang dikenal yang lolos; sisanya dibuang diam-diam.
 */
export const LESSON_LIMITS = { rows: 40, rule: 600, example: 600 };

/** Periksa daftar pelajaran dari dashboard. Baris tanpa pelajaran dibuang. */
export function validateLessons(input: unknown): Lesson[] {
  const L = LESSON_LIMITS;
  if (!Array.isArray(input)) throw new Error('Pelajaran harus berupa daftar');
  const rows = input
    .map((raw: Record<string, unknown>) => ({
      rule: String(raw?.rule ?? '').replace(/\r\n/g, '\n').trim(),
      example: String(raw?.example ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((x) => x.rule);
  if (rows.length > L.rows) throw new Error(`Pelajaran: maksimal ${L.rows}`);
  for (const [i, x] of rows.entries()) {
    if (x.rule.length > L.rule) throw new Error(`Pelajaran ${i + 1}: maksimal ${L.rule} karakter`);
    if (x.example.length > L.example) x.example = x.example.slice(0, L.example);
  }
  return rows;
}

export function validate(input: Record<string, unknown>): Partial<Editable> {
  const out: Partial<Editable> = {};
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => void (out[k] = v);

  if ('brand' in input) set('brand', text(input.brand, 80, 'Nama bisnis', true));
  if ('persona' in input) set('persona', text(input.persona, 120, 'Peran', true));
  if ('alias' in input) set('alias', text(input.alias, 40, 'Nama admin'));
  if ('about' in input) set('about', text(input.about, 600, 'Tentang bisnis', true));
  if ('honorific' in input) set('honorific', text(input.honorific, 30, 'Sapaan', true));
  if ('greeting' in input) set('greeting', text(input.greeting, 1500, 'Salam pembuka', true));
  if ('greetingKnown' in input) {
    const g = text(input.greetingKnown, 1500, 'Salam untuk nama yang sudah diketahui');
    if (g && !g.includes('{nama}')) throw new Error('Salam untuk nama yang sudah diketahui harus memuat {nama}');
    set('greetingKnown', g);
  }
  if ('notes' in input) set('notes', text(input.notes, 30_000, 'Pengetahuan tambahan'));
  if ('products' in input) set('products', validateProducts(input.products, biz.files));
  if ('logo' in input) {
    const id = String(input.logo ?? '');
    const f = fileById(id);
    if (id && (!f || isPdf(f))) throw new Error('Logo: berkas gambarnya tidak ditemukan');
    set('logo', id);
  }
  if ('questions' in input) {
    if (!Array.isArray(input.questions) || input.questions.length > 12) throw new Error('Pertanyaan kebutuhan: maksimal 12 baris');
    set('questions', input.questions.map((q, i) => text(q, 200, `Pertanyaan baris ${i + 1}`)).filter(Boolean));
  }
  if ('lessons' in input) set('lessons', validateLessons(input.lessons));
  if ('styleRules' in input) {
    if (!Array.isArray(input.styleRules) || input.styleRules.length > 20) throw new Error('Aturan balasan: maksimal 20 baris');
    set('styleRules', input.styleRules.map((r, i) => text(r, 400, `Aturan balasan baris ${i + 1}`)).filter(Boolean));
  }
  if ('catalog' in input) {
    const catalog = validateCatalog(input.catalog);
    if (renderCatalog(catalog).length > 60_000) throw new Error('Data teknis terlalu besar (maksimal ±60.000 karakter)');
    set('catalog', catalog);
  }
  if ('advice' in input) set('advice', text(input.advice, 8000, 'Panduan rekomendasi'));
  if ('handoffTopics' in input) set('handoffTopics', text(input.handoffTopics, 400, 'Topik untuk manusia', true));
  if ('handoffLabel' in input) set('handoffLabel', text(input.handoffLabel, 40, 'Label notifikasi', true));
  if ('followupClosing' in input) set('followupClosing', text(input.followupClosing, 300, 'Kalimat follow-up', true));
  if ('forbidPrices' in input) set('forbidPrices', Boolean(input.forbidPrices));
  if ('stopAfterHuman' in input) set('stopAfterHuman', Boolean(input.stopAfterHuman));
  if ('recipients' in input) {
    if (!Array.isArray(input.recipients) || input.recipients.length > 20) throw new Error('Penerima notifikasi: maksimal 20 baris');
    const rows = input.recipients
      // Penerima dari profil lama yang jalurnya hanya jalur yang sudah dihapus: dibuang tanpa pesan.
      .filter((raw: Record<string, unknown>) => !(raw?.telegram && !String(raw?.phone ?? '').trim() && !String(raw?.email ?? '').trim()))
      .map((raw: Record<string, unknown>, i: number): Recipient => {
        const name = text(raw?.name ?? '', 40, `Nama penerima baris ${i + 1}`);
        const who = name || `baris ${i + 1}`;
        const phoneRaw = String(raw?.phone ?? '').trim();
        const phone = !phoneRaw ? '' : phoneRaw.toLowerCase() === 'self' ? 'self' : normPhone(phoneRaw);
        if (phone === null) throw new Error(`Penerima ${who}: nomor WhatsApp "${phoneRaw}" tidak sah`);
        const email = String(raw?.email ?? '').trim();
        if (email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) throw new Error(`Penerima ${who}: alamat email tidak sah`);
        return { name, role: raw?.role === 'owner' ? 'owner' : 'staff', phone, email: email.slice(0, 120) };
      })
      .filter((r) => r.name || r.phone || r.email);
    for (const r of rows) if (!r.phone && !r.email) throw new Error(`Penerima ${r.name}: isi minimal satu jalur (WhatsApp atau email)`);
    set('recipients', rows);
  }
  if ('notifyRoutes' in input) {
    const raw = (input.notifyRoutes && typeof input.notifyRoutes === 'object' ? input.notifyRoutes : {}) as Record<string, unknown>;
    const routes: Partial<Record<NotifyKind, Route>> = {};
    for (const k of ['lead', 'butuh-staf', 'wa-putus', 'kiriman-dijeda', 'kiriman-gagal', 'llm', 'bot-mati'] as const) {
      const v = raw[k];
      if (v === 'owner' || v === 'staff' || v === 'both' || v === 'none') routes[k] = v;
    }
    set('notifyRoutes', routes);
  }
  if ('settings' in input) {
    const raw = (input.settings && typeof input.settings === 'object' ? input.settings : {}) as Record<string, unknown>;
    const out: Settings = {};
    for (const k of Object.keys(TUNABLE) as TunableKey[]) {
      const v = raw[k];
      if (v === undefined || v === null || v === '') continue;
      const n = Number(v);
      const [min, max] = TUNABLE[k];
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Pengaturan ${k}: isi angka ${min}–${max}`);
      out[k] = k.startsWith('llmPrice') ? n : Math.round(n);
    }
    if (out.followupAfterHours !== undefined && out.followupAfterHoursMax !== undefined && out.followupAfterHoursMax < out.followupAfterHours) {
      throw new Error('Follow-up: "paling lama" tidak boleh lebih kecil dari "paling cepat"');
    }
    if (out.followupStartHour !== undefined && out.followupEndHour !== undefined && out.followupEndHour <= out.followupStartHour) {
      throw new Error('Jam follow-up: jam selesai harus setelah jam mulai');
    }
    if (out.quietStartHour !== undefined && out.quietEndHour !== undefined && out.quietEndHour <= out.quietStartHour) {
      throw new Error('Jam tenang: jam selesai harus setelah jam mulai');
    }
    for (const k of ['llmVision', 'followupSmart', 'transcribeVoice', 'quietEnabled', 'waWarmup'] as const) {
      if (typeof raw[k] === 'boolean') out[k] = raw[k];
    }
    if (Array.isArray(raw.onlyNumbers)) {
      const list = raw.onlyNumbers.map((x) => String(x).trim()).filter(Boolean);
      const bad = list.find((x) => !normPhone(x));
      if (bad) throw new Error(`Mode uji: "${bad}" bukan nomor yang sah`);
      if (list.length > 50) throw new Error('Mode uji: maksimal 50 nomor');
      // Daftar kosong berarti "layani semua nomor".
      out.onlyNumbers = list.map((x) => normPhone(x) as string);
    }
    set('settings', out);
  }
  if ('guardCodes' in input) set('guardCodes', Boolean(input.guardCodes));

  if ('leadFields' in input) {
    if (!Array.isArray(input.leadFields) || !input.leadFields.length || input.leadFields.length > 8) {
      throw new Error('Data pelanggan: isi 1 sampai 8 baris');
    }
    const seen = new Set<string>();
    const fields: LeadField[] = input.leadFields.map((raw: Record<string, unknown>, i: number) => {
      const key = text(raw?.key, 24, `Kunci baris ${i + 1}`, true);
      if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error(`Kunci "${key}": huruf kecil, angka, dan garis bawah saja`);
      if (seen.has(key)) throw new Error(`Kunci "${key}" dipakai dua kali`);
      seen.add(key);
      return {
        key,
        label: text(raw.label, 40, `Sebutan baris ${i + 1}`, true),
        hint: text(raw.hint ?? '', 200, `Petunjuk baris ${i + 1}`),
        isName: Boolean(raw.isName),
      };
    });
    set('leadFields', fields);
  }

  if ('replyDelayMin' in input || 'replyDelayMax' in input) {
    const min = Number(input.replyDelayMin ?? biz.replyDelayMin);
    const max = Number(input.replyDelayMax ?? biz.replyDelayMax);
    if (!(min >= 0 && max >= min && max <= 180)) throw new Error('Jeda balasan: 0 ≤ minimum ≤ maksimum ≤ 180 detik');
    set('replyDelayMin', Math.round(min));
    set('replyDelayMax', Math.round(max));
  }
  return out;
}

/** Simpan perubahan (sudah divalidasi) ke database dan langsung pakai. */
export async function saveBiz(changes: Partial<Editable>): Promise<void> {
  const ctx = currentProject();
  const next = { ...(await getProfile(ctx.id)), ...changes } as Partial<Editable>;
  const at = Date.now();
  await saveProfile(ctx.id, next as Record<string, unknown>, at);
  ctx.stamp = Math.max(ctx.stamp, at);
  apply(ctx, next);
}

/** Bagian profil yang ditampilkan dashboard. */
export function editableView(): Editable {
  const view = {} as Record<string, unknown>;
  for (const k of EDITABLE) view[k] = biz[k];
  return view as Editable;
}
