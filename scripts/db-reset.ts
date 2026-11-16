import { spawnSync } from 'node:child_process';
import { createDb, runMigrations } from '@nexora/db';
import { loadConfig } from '../apps/api/src/config';

const config = loadConfig();
if (config.isProd) {
  console.error('Refusing to reset the database with NODE_ENV=production.');
  process.exit(1);
}

const db = createDb(config.databaseUrl, { applicationName: 'nexora-reset' });
console.log('reset: dropping public schema…');
await db.queryGlobal('DROP SCHEMA IF EXISTS public CASCADE');
await db.queryGlobal('CREATE SCHEMA public');
await db.close();

console.log('reset: applying migrations…');
const result = await runMigrations(config.databaseUrl);
console.log(JSON.stringify(result));

console.log('reset: seeding demo data…');
const seed = spawnSync('npm', ['run', 'db:seed'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(seed.status ?? 1);
