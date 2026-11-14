import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/** Hanya untuk `npm run db:generate` (membuat berkas migrasi dari skema). */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost/alice' },
});
