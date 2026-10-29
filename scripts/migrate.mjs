// Amar Dokan POS — apply migrations/*.sql in filename order to DATABASE_URL.
// Place in the repo at scripts/migrate.mjs, then run on the Render Shell:
//   node scripts/migrate.mjs
// Uses only the production dependency `pg` (drizzle-kit is a dev dependency
// and is NOT installed in Render production builds, so it cannot be used here).
// Safe to re-run: every migration statement uses IF NOT EXISTS.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.error('No .sql files found in', dir);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const dbHost = new URL(process.env.DATABASE_URL).hostname;
const isLocalDb = ['localhost', '127.0.0.1', '::1'].includes(dbHost);
const wantsSsl = !isLocalDb || process.env.DATABASE_URL.includes('sslmode=require');
// Local clusters (like a sandbox PostgreSQL) often have no SSL support,
// so only request SSL for hosted databases (e.g. Render) or when the
// URL explicitly asks for it. Forcing SSL everywhere breaks non-SSL
// servers with "The server does not support SSL connections".
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ...(wantsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

for (const f of files) {
  console.log('Applying', f, '...');
  await pool.query(readFileSync(join(dir, f), 'utf8'));
  console.log('Done', f);
}
await pool.end();
console.log('All migrations applied:', files.join(', '));
