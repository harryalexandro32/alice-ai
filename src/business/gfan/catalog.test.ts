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
assert.equal(MODEL_CODES.size, 30);

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

console.log(`katalog: OK — ${MODEL_CODES.size} model, teks prompt ${text.length} karakter`);
