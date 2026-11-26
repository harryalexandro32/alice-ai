/** Katalog: bentuknya utuh dan jumlah modelnya cocok dengan PDF. */

import assert from 'node:assert/strict';

import { catalogText, MODEL_CODES, SERIES, unknownModels } from './catalog';

const count = (id: string) =>
  new Set(SERIES.find((s) => s.id === id)?.tables.flatMap((t) => t.rows.map((r) => r[0]))).size;

// Jumlah model per lembar, dihitung dari PDF-nya.
assert.equal(count('GFC-B4'), 2);
assert.equal(count('GFC-A'), 5);
assert.equal(count('GFAF-A'), 8);
assert.equal(count('GFAF-AB'), 6);
assert.equal(count('GAI'), 6);
assert.equal(count('GZ'), 3);
assert.equal(count('MHB'), 5);
assert.equal(MODEL_CODES.size, 35);

// Tiap baris punya sel sebanyak kolomnya — baris yang bergeser satu kolom
// adalah cara termudah bot menjawab salah dengan yakin.
for (const s of SERIES) {
  for (const t of s.tables) {
    for (const r of t.rows) {
      assert.equal(r.length, t.columns.length, `${s.id} / ${t.title} / ${r[0]}`);
      assert.ok(r.every((c) => c.trim() !== ''), `${s.id} / ${t.title} / ${r[0]}: sel kosong`);
    }
    // Setiap model seri itu muncul di setiap tabelnya.
    assert.equal(new Set(t.rows.map((r) => r[0])).size, count(s.id), `${s.id} / ${t.title}`);
  }
}

// Titik-titik yang dicek ulang ke PDF.
const text = catalogText();
for (const line of [
  'GFC15-20A | 220 | 50 | 52 | 330 | 45',
  'GFAF-60A | 24" | 220/380 | 50 | 300 | 6900 | 72 x 29 x 72 | 1 | 16 | 67',
  'GFAF-45AB | 18" | 220/380 | 50 | 230 | 5700 | 61 x 29 x 61 | 1 | 11 | 64',
  'GAI-250 | 220/50 | 165/225 | 1064/1405 | 371/488 | 58/66 | 1850/2450 | 0,75/1,2',
  'GZ-300 | 3000 | 240 | 2900 | 0.55 | 380/50 | 69 | 32',
  'MHB-10-C | GAC-10-C | 16000 | 680 | 220/50 | ≤ 58 | 100 | 8–10 | 100–180 | 48 / 51 | 870 x 870 x 2100',
  'MHB-23-H | GAC-23-H | 23000 | 1800 | 220/50 | ≤ 80 | 260 | 5–10 | 150–180 | 82 / 85 | 1100 x 1100 x 2200',
]) {
  assert.ok(text.includes(line), `tidak ada di teks katalog: ${line}`);
}
assert.ok(!/\bRp\b|harga/i.test(text), 'katalog tidak boleh memuat harga');

// Model karangan tertangkap; yang asli (dengan ejaan apa pun) lolos.
assert.deepEqual(unknownModels('Kami sarankan GFAF-40A atau GAI-200, juga GFC10-12B4.'), []);
assert.deepEqual(unknownModels('gfaf 40a dan gz200 tersedia'), []);
assert.deepEqual(unknownModels('Seri GFC, GAI Series dan GZ cocok'), []);
assert.deepEqual(unknownModels('Ada GFAF-70A dan GZ-400'), ['GFAF-70A', 'GZ-400']);
assert.deepEqual(unknownModels('GFC20-30A'), ['GFC20-30A']);
assert.deepEqual(unknownModels('GAI-100.'), []);
assert.deepEqual(unknownModels('Air cooler MHB-18-H (GAC-18-H), mhb10a, dan MHB-10C'), []);
assert.deepEqual(unknownModels('Ada MHB-30-H dan GAC-10-D'), ['MHB-30-H', 'MHB-10-D']);

console.log(`katalog: OK — ${MODEL_CODES.size} model, teks prompt ${text.length} karakter`);
