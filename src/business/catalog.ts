/**
 * Data produk berbentuk tabel -> teks yang dibaca LLM, dan pemeriksaan masukan
 * dari dashboard.
 *
 * Pemilik mengisi tabel (baris = produk, kolom = spesifikasi); LLM tetap
 * membaca teks polos. Rakitannya di sini satu-satunya, jadi apa yang terlihat
 * di tabel dashboard sama persis dengan yang diketahui bot.
 */

import type { CatalogSection, CatalogTable } from './types';

export const CATALOG_LIMITS = { sections: 40, tables: 6, columns: 16, rows: 200, cell: 120, facts: 3000 };

/** Katalog sebagai teks polos buat prompt. Sama persis tiap panggilan. */
export function renderCatalog(sections: readonly CatalogSection[]): string {
  return sections
    .map((s) => {
      const tables = s.tables
        .map((t) => `${t.title}:\n${t.columns.join(' | ')}\n` + t.rows.map((r) => r.join(' | ')).join('\n'))
        .join('\n\n');
      const facts = s.facts.map((f) => `- ${f}`).join('\n');
      return [`### ${s.name}`, facts].filter(Boolean).join('\n') + (tables ? `\n\n${tables}` : '');
    })
    .join('\n\n');
}

/** Satu sel: satu baris teks, tanpa pemisah kolom. */
const cell = (v: unknown): string =>
  String(v ?? '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Periksa dan rapikan katalog dari dashboard. Melempar pesan yang bisa
 * ditampilkan ke pemilik. Baris yang seluruhnya kosong dibuang; baris yang
 * kode/modelnya (kolom pertama) kosong ditolak.
 */
export function validateCatalog(input: unknown): CatalogSection[] {
  const L = CATALOG_LIMITS;
  if (!Array.isArray(input)) throw new Error('Data produk harus berupa daftar kelompok');
  if (input.length > L.sections) throw new Error(`Data produk: maksimal ${L.sections} kelompok`);

  return input.map((rawS: Record<string, unknown>, si: number): CatalogSection => {
    const name = cell(rawS?.name);
    const where = name || `kelompok ke-${si + 1}`;
    if (!name) throw new Error(`Kelompok produk ke-${si + 1} belum diberi nama`);
    if (name.length > L.cell) throw new Error(`Nama kelompok "${name.slice(0, 30)}…" terlalu panjang`);

    const rawFacts = Array.isArray(rawS.facts) ? rawS.facts : String(rawS.facts ?? '').split('\n');
    const facts = rawFacts.map((f) => cell(String(f).replace(/^\s*-\s*/, ''))).filter(Boolean);
    if (facts.join('\n').length > L.facts) throw new Error(`${where}: keterangan terlalu panjang (maksimal ${L.facts} karakter)`);

    const rawTables = Array.isArray(rawS.tables) ? rawS.tables : [];
    if (rawTables.length > L.tables) throw new Error(`${where}: maksimal ${L.tables} tabel`);

    const tables = rawTables.map((rawT: Record<string, unknown>, ti: number): CatalogTable => {
      const title = cell(rawT?.title) || 'Spesifikasi';
      const at = `${where} / ${title}`;
      const columns = (Array.isArray(rawT.columns) ? rawT.columns : []).map(cell);
      if (!columns.length || columns.length > L.columns) throw new Error(`${at}: isi 1 sampai ${L.columns} kolom`);
      if (columns.some((c) => !c)) throw new Error(`${at}: ada judul kolom yang kosong`);
      if (new Set(columns.map((c) => c.toLowerCase())).size !== columns.length) throw new Error(`${at}: ada judul kolom yang sama`);

      const rows = (Array.isArray(rawT.rows) ? rawT.rows : [])
        .map((r: unknown) => columns.map((_, i) => cell(Array.isArray(r) ? r[i] : '')))
        .filter((r: string[]) => r.some(Boolean));
      if (rows.length > L.rows) throw new Error(`${at}: maksimal ${L.rows} baris`);
      for (const [ri, r] of rows.entries()) {
        if (!r[0]) throw new Error(`${at}: baris ${ri + 1} belum diisi ${columns[0]}`);
        if (r.some((c: string) => c.length > L.cell)) throw new Error(`${at}: baris "${r[0]}" punya isi yang terlalu panjang`);
      }
      void ti;
      return { title: title.slice(0, L.cell), columns, rows };
    });

    return { name, facts, tables };
  });
}
