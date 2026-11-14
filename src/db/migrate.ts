/** `npm run db:migrate`: jalankan migrasi di drizzle/ lalu keluar (dipakai deploy/deploy.sh). */

import 'dotenv/config';

import { closeDb, openDb } from './index';

openDb()
  .then(async () => {
    console.log('[db] migrasi selesai');
    await closeDb();
  })
  .catch((e) => {
    console.error(`[db] migrasi gagal: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
