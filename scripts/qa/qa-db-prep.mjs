// QA-only: applies the app's canonical migration set to the local PGlite QA DB.
// PGlite has gen_random_uuid() built in but no pgcrypto extension module, so
// the CREATE EXTENSION line from migration 0001 is skipped here.
// Production (Railway, real Postgres) runs migrations unchanged via the API.
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { ALL_MIGRATIONS } from './migration-list.mjs';

const connectionString = process.env.QA_PG_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';
const client = new Client({ connectionString });
await client.connect();
await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, filename text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
for (const migration of ALL_MIGRATIONS) {
  const applied = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [migration.id]);
  if (applied.rows.length > 0) { console.log('skip', migration.filename); continue; }
  const sql = readFileSync(`migrations/${migration.filename}`, 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/g, '');
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations (id, filename) VALUES ($1, $2)', [migration.id, migration.filename]);
  console.log('OK  ', migration.filename);
}
await client.end();
console.log('QA DB ready.');
