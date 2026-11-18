/**
 * Data produk berbentuk tabel -> teks yang dibaca LLM, dan pemeriksaan masukan
 * dari dashboard.
 *
 * Pemilik mengisi tabel (baris = produk, kolom = spesifikasi); LLM tetap
 * membaca teks polos. Rakitannya di sini satu-satunya, jadi apa yang terlihat
 * di tabel dashboard sama persis dengan yang diketahui bot.
 */

import { MARKET_LABELS, MARKETS, type CatalogSection, type CatalogTable, type Market, type MediaFile, type Product } from './types';

export const isPdf = (f: Pick<MediaFile, 'file'>): boolean => f.file.endsWith('.pdf');

/** Marketplace yang tautannya terisi untuk produk ini, berurutan. */
export const marketsOf = (p: Pick<Product, 'links'>): Market[] => MARKETS.filter((m) => p.links[m]);

/**
 * Pesan tautan beli satu produk: `text` dikirim ke pelanggan, `mark` dicatat
 * di riwayat ("[link:<produk>] …"), supaya LLM tahu tautannya sudah terkirim.
 * Null kalau produk ini tidak punya tautan.
 */
export function buyMessage(p: Pick<Product, 'name' | 'links'>): { text: string; mark: string } | null {
  const lines = marketsOf(p).map((m) => `${MARKET_LABELS[m]}: ${p.links[m]}`);
  if (!lines.length) return null;
  return { text: `*${p.name}*\n${lines.join('\n')}`, mark: `[link:${p.name}] ${lines.join(' | ')}` };
}

/**
 * Daftar produk sebagai teks buat prompt. Kolom Foto dan PDF berisi id berkas
 * yang boleh dilampirkan LLM; kolom Beli hanya menyebut marketplace-nya, karena
 * tautannya dikirim kode, bukan ditulis LLM. "-" berarti datanya belum ada.
 */
export function renderProducts(products: readonly Product[]): string {
  if (!products.length) return '';
  const v = (s: string): string => s || '-';
  const buy = (x: Product): string => marketsOf(x).map((m) => MARKET_LABELS[m]).join(', ');
  return (
    'DAFTAR PRODUK — daftar ini LENGKAP: nama/kode yang tidak tertulis sebagai baris di sini tidak ada, ' +
    'jangan menurunkan kode baru dari pola nama. ("-" = belum ada datanya)\nNama | Keterangan | Harga | Stok | Foto | PDF | Beli\n' +
    products.map((x) => [x.name, v(x.description), v(x.price), v(x.stock), v(x.photos.join(', ')), v(x.pdf), v(buy(x))].join(' | ')).join('\n')
  );
}

export const PRODUCT_LIMITS = { rows: 300, name: 120, description: 600, price: 60, stock: 60, photos: 6, link: 400 };

/** Alamat situs yang sah untuk tiap marketplace (termasuk tautan pendeknya). */
const MARKET_HOSTS: Record<Market, RegExp> = {
  tokopedia: /(^|\.)(tokopedia\.com|tokopedia\.link)$/i,
  shopee: /(^|\.)(shopee\.co\.id|shp\.ee|shope\.ee)$/i,
};

/** Tautan marketplace dari data mentah; yang tidak ada jadi ''. Tanpa pemeriksaan. */
export function linksOf(raw: unknown): Record<Market, string> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(MARKETS.map((m) => [m, typeof o[m] === 'string' ? (o[m] as string).trim() : ''])) as Record<Market, string>;
}

/** Satu tautan marketplace yang sudah diperiksa: https, di situs marketplace itu, tanpa spasi. */
function checkLink(name: string, m: Market, url: string): string {
  if (!url) return '';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Produk "${name}": tautan ${MARKET_LABELS[m]} tidak sah`);
  }
  if (u.protocol !== 'https:' || !MARKET_HOSTS[m].test(u.hostname) || /\s/.test(url)) {
    throw new Error(`Produk "${name}": tautan ${MARKET_LABELS[m]} harus https:// di situs ${MARKET_LABELS[m]}`);
  }
  if (url.length > PRODUCT_LIMITS.link) throw new Error(`Produk "${name}": tautan ${MARKET_LABELS[m]} terlalu panjang`);
  return url;
}

/** Periksa daftar produk dari dashboard. Lampiran hanya boleh merujuk berkas yang ada. */
export function validateProducts(input: unknown, files: readonly MediaFile[]): Product[] {
  const L = PRODUCT_LIMITS;
  if (!Array.isArray(input)) throw new Error('Daftar produk harus berupa daftar');
  const images = new Set(files.filter((f) => !isPdf(f)).map((f) => f.id));
  const pdfs = new Set(files.filter(isPdf).map((f) => f.id));
  const rows = input
    .map((raw: Record<string, unknown>): Product => ({
      name: cell(raw?.name),
      description: cell(raw?.description),
      price: cell(raw?.price),
      stock: cell(raw?.stock),
      photos: [...new Set((Array.isArray(raw?.photos) ? raw.photos : []).filter((id): id is string => typeof id === 'string' && images.has(id)))].slice(0, L.photos),
      pdf: typeof raw?.pdf === 'string' && pdfs.has(raw.pdf) ? raw.pdf : '',
      links: linksOf(raw?.links),
    }))
    .filter((x) => x.name || x.description || x.price || x.stock || x.photos.length || x.pdf || marketsOf(x).length);
  if (rows.length > L.rows) throw new Error(`Daftar produk: maksimal ${L.rows} baris`);
  for (const [i, x] of rows.entries()) {
    if (!x.name) throw new Error(`Daftar produk: baris ${i + 1} belum diberi nama`);
    if (x.name.length > L.name) throw new Error(`Produk "${x.name.slice(0, 30)}…": nama terlalu panjang`);
    if (x.description.length > L.description) throw new Error(`Produk "${x.name}": keterangan terlalu panjang (maksimal ${L.description} karakter)`);
    if (x.price.length > L.price || x.stock.length > L.stock) throw new Error(`Produk "${x.name}": harga/stok terlalu panjang`);
    for (const m of MARKETS) x.links[m] = checkLink(x.name, m, x.links[m]);
  }
  return rows;
}

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
function cell(v: unknown): string {
  return String(v ?? '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

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
