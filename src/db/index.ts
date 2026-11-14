/**
 * Sambungan database: PostgreSQL lewat Drizzle.
 *
 * DATABASE_URL menentukan wujudnya:
 *   postgres://… / postgresql://…  server PostgreSQL sungguhan (produksi);
 *   pglite://<folder>              PostgreSQL di dalam proses, disimpan di
 *                                  folder itu (pengembangan tanpa server);
 *   memory://                      PostgreSQL di dalam proses, di memori
 *                                  (tes dan mode latihan).
 *
 * Begitu tersambung, migrasi di drizzle/ dijalankan (yang sudah pernah
 * dijalankan dilewati), jadi database selalu sama bentuknya dengan kode.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Folder migrasi, dihitung dari letak berkas ini (src/db/ -> akar repo). */
const MIGRATIONS = join(__dirname, '..', '..', 'drizzle');

let current: Db | null = null;
let closer: (() => Promise<void>) | null = null;

/** Database yang sedang terbuka. Melempar kalau openDb belum dipanggil. */
export function db(): Db {
  if (!current) throw new Error('database belum dibuka (openDb)');
  return current;
}

export function dbOpen(): boolean {
  return current !== null;
}

/** Buka (atau buka ulang) database, lalu jalankan migrasi. */
export async function openDb(url = process.env.DATABASE_URL?.trim() ?? ''): Promise<Db> {
  await closeDb();
  if (!url) throw new Error('DATABASE_URL belum diisi (postgres://…, pglite://<folder>, atau memory://)');

  if (/^postgres(ql)?:\/\//.test(url)) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: url, max: 5 });
    const d = drizzle(pool, { schema });
    await migrate(d, { migrationsFolder: MIGRATIONS });
    current = d as unknown as Db;
    closer = () => pool.end();
  } else if (url === 'memory://' || url === ':memory:' || url.startsWith('pglite://')) {
    // Dimuat saat dipakai: produksi tidak perlu memuat PostgreSQL versi WASM.
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const dir = url.startsWith('pglite://') ? url.slice('pglite://'.length) : '';
    if (dir) mkdirSync(dir, { recursive: true });
    const client = dir ? new PGlite(dir) : new PGlite();
    const d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: MIGRATIONS });
    current = d as unknown as Db;
    closer = () => client.close();
  } else {
    throw new Error(`DATABASE_URL tidak dikenal: "${url.replace(/\/\/[^@]*@/, '//***@')}"`);
  }
  return current;
}

export async function closeDb(): Promise<void> {
  const close = closer;
  current = null;
  closer = null;
  if (close) await close().catch(() => {});
}

/** Tes: kosongkan semua tabel (lebih cepat daripada membuka database baru). */
export async function clearDb(): Promise<void> {
  await db().execute(
    sql.raw(
      'TRUNCATE contacts, messages, pauses, bot_off, human_seen, alerts, errors, outbox, llm_usage, project_status, profiles, projects RESTART IDENTITY CASCADE'
    )
  );
}
