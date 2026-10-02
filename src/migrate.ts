import { readFile } from 'node:fs/promises';
import { pool, transaction } from './db';

async function main() {
  const sql = await readFile('migrations/001_initial.sql', 'utf8');
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(764312)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const existing = await db.query('SELECT 1 FROM schema_migrations WHERE version = 1');
    if (!existing.rowCount) {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations(version) VALUES (1)');
    }
  });
  console.log('Migrations applied');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
