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

import { cfg } from '../config';
import { renderCatalog, validateCatalog } from './catalog';
import { gfan } from './gfan/profile';
import { EDITABLE, type Business, type Editable, type LeadField } from './types';

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
}

let rendered: { catalog: unknown; notes: string; text: string } | null = null;

/**
 * Satu-satunya sumber jawaban bot: tabel produk + catatan bebas, sebagai teks.
 * Dirakit ulang hanya kalau profilnya berganti, jadi teksnya sama persis dari
 * panggilan ke panggilan (awalan prompt yang di-cache penyedia LLM).
 */
export function knowledgeText(): string {
  if (rendered?.catalog !== biz.catalog || rendered.notes !== biz.notes) {
    const text = [renderCatalog(biz.catalog), biz.notes.trim()].filter(Boolean).join('\n\n');
    rendered = { catalog: biz.catalog, notes: biz.notes, text };
  }
  return rendered.text;
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
  if ('catalog' in input) {
    const catalog = validateCatalog(input.catalog);
    if (renderCatalog(catalog).length > 60_000) throw new Error('Data produk terlalu besar (maksimal ±60.000 karakter)');
    set('catalog', catalog);
  }
  if ('advice' in input) set('advice', text(input.advice, 8000, 'Panduan rekomendasi'));
  if ('handoffTopics' in input) set('handoffTopics', text(input.handoffTopics, 400, 'Topik untuk manusia', true));
  if ('handoffLabel' in input) set('handoffLabel', text(input.handoffLabel, 40, 'Label notifikasi', true));
  if ('followupClosing' in input) set('followupClosing', text(input.followupClosing, 300, 'Kalimat follow-up', true));
  if ('forbidPrices' in input) set('forbidPrices', Boolean(input.forbidPrices));
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
