/** Seed: proyek gfan + brosur PDF dari catalog-pdf/ terpasang ke produknya. */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { biz, loadProject, mediaDir } from '../business';
import { cfg } from '../config';
import { withProject } from '../project';
import { closeDb, openDb } from './index';
import { seed, seedCatalogPdfs } from './seed';

// Folder data sementara: impor di atas sudah membaca DATA_DIR, jadi diatur di sini.
const tmp = mkdtempSync(join(tmpdir(), 'alice-seed-'));
cfg.dataRoot = tmp;

(async () => {
  await openDb('memory://');
  await seed();
  const ctx = await loadProject('gfan');
  assert.ok(ctx, 'proyek gfan ada');
  await withProject(ctx, async () => {
    assert.equal(biz.files.length, 6, '6 PDF katalog');
    const tanpaPdf = biz.products.filter((p) => !p.pdf).map((p) => p.name);
    assert.deepEqual(tanpaPdf, [], 'semua produk punya PDF');
    const jet = biz.products.find((p) => p.name === 'GZ-200');
    assert.equal(biz.files.find((f) => f.id === jet?.pdf)?.name, 'Jet Fan - GFan');
    assert.ok(mediaDir().startsWith(tmp), 'media di folder sementara');
    for (const f of biz.files) {
      assert.ok(existsSync(join(mediaDir(), f.file)), `${f.file} ada di media`);
      assert.ok(existsSync(join(mediaDir(), `${f.id}.txt`)), `${f.id}.txt ada`);
    }
  });
  // Diulang: tidak menambah apa pun (berkas yang ada tidak disentuh).
  assert.equal(await seedCatalogPdfs('gfan'), 0);
  const again = await loadProject('gfan');
  await withProject(again!, async () => assert.equal(biz.files.length, 6));
  await closeDb();
  rmSync(tmp, { recursive: true, force: true });
  console.log('seed: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
