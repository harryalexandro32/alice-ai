/**
 * Profil bisnis yang sedang dipakai.
 *
 * Satu proses melayani satu bisnis (env BUSINESS). `biz` adalah SATU objek
 * yang isinya diperbarui di tempat: modul lain cukup membaca `biz.x` dan
 * selalu mendapat nilai terbaru, tanpa perlu tahu kapan dashboard menyimpan.
 *
 * Perubahan pemilik disimpan di data/<id>/profile.json. File itu dibaca ulang
 * begitu berubah, jadi dashboard boleh berjalan di proses lain (`npm run
 * admin`) dan bot yang sedang jalan tetap ikut tanpa restart.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applySettings, cfg, normPhone, TUNABLE, type Settings, type TunableKey } from '../config';
import { isPdf, renderCatalog, renderProducts, validateCatalog, validateProducts } from './catalog';
import { gfan } from './gfan/profile';
import {
  EDITABLE, type BotSwitch, type Business, type Editable, type LeadField, type MediaFile, type NotifyKind, type Recipient, type Route,
} from './types';

const REGISTRY: Record<string, Business> = { gfan };

const seed = REGISTRY[cfg.business];
if (!seed) {
  throw new Error(
    `BUSINESS="${cfg.business}" tidak dikenal. Yang ada: ${Object.keys(REGISTRY).join(', ')}`
  );
}

export const biz: Business = { ...seed };

export const dataDir = (): string => join(cfg.dataRoot, biz.id);
export const mediaDir = (): string => join(dataDir(), 'media');
const profileFile = (): string => join(dataDir(), 'profile.json');

let enabled = false;
let loadedMtime = 0;

/** Pakai bibit + perubahan ini sebagai profil yang berlaku (tanpa menyimpan). */
export function applyOverrides(overrides: Partial<Editable>): void {
  apply(overrides);
}

/**
 * Ganti seluruh perubahan lokal dengan `overrides` — dipakai saat menarik
 * profil dari penyimpanan bersama, yang merupakan sumber kebenarannya.
 */
export function replaceOverrides(overrides: Partial<Editable>): void {
  mkdirSync(dataDir(), { recursive: true });
  const tmp = `${profileFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(overrides, null, 2));
  renameSync(tmp, profileFile());
  loadedMtime = statSync(profileFile()).mtimeMs;
  apply(overrides);
}

function apply(overrides: Partial<Editable>): void {
  Object.assign(biz, seed);
  for (const k of EDITABLE) {
    if (overrides[k] !== undefined) (biz as unknown as Record<string, unknown>)[k] = overrides[k];
  }
  // Profil yang disimpan sebelum data produk berbentuk tabel: seluruh
  // pengetahuannya satu teks. Teks itu tetap dipakai apa adanya.
  const legacy = (overrides as { knowledge?: unknown }).knowledge;
  if (typeof legacy === 'string' && overrides.catalog === undefined && overrides.notes === undefined) {
    biz.catalog = [];
    biz.notes = legacy;
  }
  syncPdfTexts();
  applySettings(biz.settings);
}

// Isi PDF yang boleh dibaca bot (MediaFile.read), per id berkas. Di mesin bot
// teksnya ada di folder media sebagai <id>.txt (ditulis dashboard, ditarik
// bersama PDF-nya); di dashboard online diisi lewat setPdfText().
const pdfTexts = new Map<string, string>();
/** Batas teks per PDF yang masuk ke prompt: lebih dari ini, tiap balasan jadi mahal. */
const PDF_TEXT_MAX = 8000;
let pdfVersion = 0;

export function setPdfText(id: string, text: string): void {
  if (pdfTexts.get(id) === text) return;
  pdfTexts.set(id, text);
  pdfVersion += 1;
}

function syncPdfTexts(): void {
  const wanted = new Set(biz.files.filter((f) => isPdf(f) && f.read).map((f) => f.id));
  for (const id of [...pdfTexts.keys()]) {
    if (!wanted.has(id)) {
      pdfTexts.delete(id);
      pdfVersion += 1;
    }
  }
  if (!enabled) return;
  for (const id of wanted) {
    if (pdfTexts.has(id)) continue;
    try {
      setPdfText(id, readFileSync(join(mediaDir(), `${id}.txt`), 'utf8'));
    } catch {
      // teksnya belum sampai di mesin ini; dicoba lagi saat profil dimuat ulang
    }
  }
}

function renderPdfTexts(): string {
  return biz.files
    .filter((f) => isPdf(f) && f.read && pdfTexts.get(f.id))
    .map(
      (f) =>
        `ISI PDF "${f.name}" — dibaca otomatis dari berkasnya. Susunan tabelnya bisa bergeser: kalau sebuah angka ` +
        `tidak jelas milik produk atau kolom yang mana, jangan ditebak — lampirkan PDF-nya dan serahkan ke tim.\n${(pdfTexts.get(f.id) as string).slice(0, PDF_TEXT_MAX)}`
    )
    .join('\n\n');
}

let rendered: { products: unknown; catalog: unknown; notes: string; files: unknown; pdf: number; text: string } | null = null;

/**
 * Satu-satunya sumber jawaban bot: tabel produk + catatan bebas, sebagai teks.
 * Dirakit ulang hanya kalau profilnya berganti, jadi teksnya sama persis dari
 * panggilan ke panggilan (awalan prompt yang di-cache penyedia LLM).
 */
export function knowledgeText(): string {
  if (
    rendered?.products !== biz.products || rendered.catalog !== biz.catalog || rendered.notes !== biz.notes ||
    rendered.files !== biz.files || rendered.pdf !== pdfVersion
  ) {
    const text = [renderProducts(biz.products), renderCatalog(biz.catalog), biz.notes.trim(), renderPdfTexts()].filter(Boolean).join('\n\n');
    rendered = { products: biz.products, catalog: biz.catalog, notes: biz.notes, files: biz.files, pdf: pdfVersion, text };
  }
  return rendered.text;
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

function read(): Partial<Editable> {
  try {
    return JSON.parse(readFileSync(profileFile(), 'utf8')) as Partial<Editable>;
  } catch {
    return {};
  }
}

/**
 * Mulai memakai perubahan pemilik. Dipanggil sekali oleh bot, dashboard, dan
 * mode latihan. Tes tidak memanggilnya, jadi tes selalu berjalan di atas bibit.
 */
export function initBiz(): void {
  enabled = true;
  mkdirSync(mediaDir(), { recursive: true });
  refreshBiz(true);
}

/** Baca ulang kalau file profil berubah sejak terakhir dibaca. Murah: satu stat. */
export function refreshBiz(force = false): void {
  if (!enabled) return;
  const mtime = existsSync(profileFile()) ? statSync(profileFile()).mtimeMs : 0;
  if (!force && mtime === loadedMtime) return;
  loadedMtime = mtime;
  apply(mtime ? read() : {});
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
export function validate(input: Record<string, unknown>): Partial<Editable> {
  const out: Partial<Editable> = {};
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => void (out[k] = v);

  if ('brand' in input) set('brand', text(input.brand, 80, 'Nama bisnis', true));
  if ('persona' in input) set('persona', text(input.persona, 120, 'Peran', true));
  if ('alias' in input) set('alias', text(input.alias, 40, 'Nama admin'));
  if ('about' in input) set('about', text(input.about, 600, 'Tentang bisnis', true));
  if ('honorific' in input) set('honorific', text(input.honorific, 30, 'Sapaan', true));
  if ('greeting' in input) set('greeting', text(input.greeting, 1500, 'Salam pembuka', true));
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
      .map((raw: Record<string, unknown>, i: number): Recipient => {
        const name = text(raw?.name ?? '', 40, `Nama penerima baris ${i + 1}`);
        const who = name || `baris ${i + 1}`;
        const phoneRaw = String(raw?.phone ?? '').trim();
        const phone = !phoneRaw ? '' : phoneRaw.toLowerCase() === 'self' ? 'self' : normPhone(phoneRaw);
        if (phone === null) throw new Error(`Penerima ${who}: nomor WhatsApp "${phoneRaw}" tidak sah`);
        const email = String(raw?.email ?? '').trim();
        if (email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) throw new Error(`Penerima ${who}: alamat email tidak sah`);
        const telegram = String(raw?.telegram ?? '').trim();
        if (telegram && !/^-?\d{4,20}$/.test(telegram)) throw new Error(`Penerima ${who}: id chat Telegram harus berupa angka`);
        return { name, role: raw?.role === 'owner' ? 'owner' : 'staff', phone, email: email.slice(0, 120), telegram };
      })
      .filter((r) => r.name || r.phone || r.email || r.telegram);
    for (const r of rows) if (!r.phone && !r.email && !r.telegram) throw new Error(`Penerima ${r.name}: isi minimal satu jalur (WhatsApp, email, atau Telegram)`);
    set('recipients', rows);
  }
  if ('notifyRoutes' in input) {
    const raw = (input.notifyRoutes && typeof input.notifyRoutes === 'object' ? input.notifyRoutes : {}) as Record<string, unknown>;
    const routes: Partial<Record<NotifyKind, Route>> = {};
    for (const k of ['lead', 'butuh-staf', 'wa-putus', 'kiriman-dijeda', 'llm', 'bot-mati'] as const) {
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
    if (out.followupStartHour !== undefined && out.followupEndHour !== undefined && out.followupEndHour <= out.followupStartHour) {
      throw new Error('Jam follow-up: jam selesai harus setelah jam mulai');
    }
    if (typeof raw.llmVision === 'boolean') out.llmVision = raw.llmVision;
    if (Array.isArray(raw.onlyNumbers)) {
      const list = raw.onlyNumbers.map((x) => String(x).trim()).filter(Boolean);
      const bad = list.find((x) => !normPhone(x));
      if (bad) throw new Error(`Mode uji: "${bad}" bukan nomor yang sah`);
      if (list.length > 50) throw new Error('Mode uji: maksimal 50 nomor');
      // Daftar kosong berarti "layani semua nomor", walaupun .env mengisi ONLY_NUMBERS.
      out.onlyNumbers = list.map((x) => normPhone(x) as string);
    }
    set('settings', out);
  }
  if ('botSwitch' in input) {
    const raw = (input.botSwitch && typeof input.botSwitch === 'object' ? input.botSwitch : {}) as Record<string, Partial<BotSwitch>>;
    const entries = Object.entries(raw)
      .filter(([phone, v]) => /^(\+\d{8,15}|lid:\d{5,20})$/.test(phone) && (v?.mode === 'on' || v?.mode === 'off') && Number.isFinite(v.at))
      .map(([phone, v]) => [phone, { mode: v.mode, at: Math.round(Number(v.at)) }] as [string, BotSwitch])
      // Yang terbaru saja yang disimpan; perintah lama sudah dijalankan bot.
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 300);
    set('botSwitch', Object.fromEntries(entries));
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

/** Simpan perubahan (sudah divalidasi) dan langsung pakai. */
export function saveBiz(changes: Partial<Editable>): void {
  mkdirSync(dataDir(), { recursive: true });
  const next = { ...read(), ...changes };
  // Tulis ke file sementara lalu ganti nama: proses lain yang sedang membaca
  // tidak pernah melihat file setengah jadi.
  const tmp = `${profileFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, profileFile());
  loadedMtime = statSync(profileFile()).mtimeMs;
  apply(next);
}

/** Bagian profil yang ditampilkan dashboard. */
export function editableView(): Editable {
  const view = {} as Record<string, unknown>;
  for (const k of EDITABLE) view[k] = biz[k];
  return view as Editable;
}
