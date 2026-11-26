/**
 * `npm run db:seed`: isi awal yang aman dijalankan berulang kali.
 *
 * Membuat proyek `gfan` (bibit profil GFAN di kode) beserta profil kosongnya
 * kalau belum ada. Baris yang sudah ada TIDAK pernah ditimpa. Dashboard juga
 * memanggilnya saat start, dan memakai ensureProject untuk "Proyek baru".
 */

import 'dotenv/config';

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { matchProducts, pdfPlain, squash } from '../admin/pdftext';
import { biz, loadProject, mediaDir, saveBiz } from '../business';
import type { MediaFile } from '../business/types';
import { withProject } from '../project';
import { createProject, type NewProject } from '../store';
import { closeDb, openDb } from './index';

/**
 * Brosur PDF GFAN di repo; dipasang ke proyek gfan sekali, saat profilnya belum
 * punya berkas. Hanya berkas .pdf langsung di folder ini (subfolder harga/
 * berisi price list sumber harga, bukan brosur untuk pelanggan). PDF hasil
 * pindai tidak punya teks: taruh transkripsinya di <nama>.txt di sampingnya,
 * dan teks itu yang dipakai untuk mencocokkan produk dan "bot membaca PDF".
 */
export const CATALOG_PDF_DIR = join(__dirname, '..', '..', 'catalog-pdf');

/** Teks sebuah PDF katalog: dari PDF-nya, atau dari <nama>.txt kalau PDF-nya hasil pindai. */
export async function catalogPdfText(dir: string, name: string, data: Buffer): Promise<string> {
  const text = await pdfPlain(data);
  if (text) return text;
  const sidecar = join(dir, `${basename(name, '.pdf')}.txt`);
  return existsSync(sidecar) ? readFileSync(sidecar, 'utf8').trim() : '';
}

/** Pastikan proyek ini ada. True kalau baru dibuat. */
export function ensureProject(
  id: string,
  template: string,
  name: string,
  extra: Omit<NewProject, 'id' | 'template' | 'name'> = {}
): Promise<boolean> {
  return createProject({ id, template, name, ...extra });
}

/**
 * Pasang brosur PDF dari `dir` ke proyek ini: salin ke folder media, simpan
 * teksnya (<id>.txt, untuk pencocokan dan tombol "bot membaca PDF"), lalu
 * pasangkan tiap PDF ke produk yang namanya disebut di dalamnya. Hanya berjalan
 * kalau profil proyek belum punya berkas sama sekali, jadi berkas yang diatur
 * pemilik lewat dashboard tidak pernah disentuh. Mengembalikan jumlah PDF.
 */
export async function seedCatalogPdfs(projectId: string, dir = CATALOG_PDF_DIR): Promise<number> {
  const ctx = await loadProject(projectId);
  if (!ctx || !existsSync(dir)) return 0;
  return withProject(ctx, async () => {
    if (biz.files.length) return 0;
    const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
    if (!pdfs.length) return 0;
    mkdirSync(mediaDir(), { recursive: true });

    const files: MediaFile[] = [];
    const pdfOf = new Map<string, string>();
    const names = biz.products.map((p) => p.name);
    for (const name of pdfs) {
      const data = readFileSync(join(dir, name));
      // Id dari nama berkasnya: seed yang diulang menghasilkan id yang sama.
      const id = `d${createHash('sha1').update(name).digest('hex').slice(0, 8)}`;
      const file: MediaFile = { id, file: `${id}.pdf`, name: basename(name, '.pdf') };
      writeFileSync(join(mediaDir(), file.file), data);
      const text = await catalogPdfText(dir, name, data);
      if (text) writeFileSync(join(mediaDir(), `${id}.txt`), text.slice(0, 200_000));
      files.push(file);
      for (const product of matchProducts(squash(text), names)) if (!pdfOf.has(product)) pdfOf.set(product, id);
    }
    const products = biz.products.map((p) => (!p.pdf && pdfOf.has(p.name) ? { ...p, pdf: pdfOf.get(p.name) as string } : p));
    await saveBiz({ files, products });
    console.log(`[db] ${projectId}: ${files.length} PDF katalog dipasang, ${pdfOf.size} produk dipasangkan`);
    return files.length;
  });
}

export async function seed(): Promise<void> {
  if (await ensureProject('gfan', 'gfan', 'GFAN Indonesia')) console.log('[db] proyek gfan dibuat');
  await seedCatalogPdfs('gfan');
}

if (require.main === module) {
  openDb()
    .then(seed)
    .then(async () => {
      console.log('[db] seed selesai');
      await closeDb();
    })
    .catch((e) => {
      console.error(`[db] seed gagal: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}
