import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(connectionString: string): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`SELECT pg_advisory_lock(hashtext('nexora_pos_migrations'))`);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const existing = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const byVersion = new Map(existing.rows.map((r) => [r.version, r.checksum]));

    for (const file of files) {
      const sql = await readFile(`${MIGRATIONS_DIR}${file}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = byVersion.get(file);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${file} was modified after it was applied. Add a new migration instead.`,
          );
        }
        skipped.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext('nexora_pos_migrations'))`);
    } catch {
      // Connection may be gone after a failed migration.
    }
    await client.end();
  }

  return { applied, skipped };
}

const isCli = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isCli || process.argv[1]?.endsWith('migrate.ts')) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then((result) => {
      console.log(
        JSON.stringify({ ok: true, applied: result.applied, skipped: result.skipped.length }),
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
