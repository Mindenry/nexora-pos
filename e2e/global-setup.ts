import { execSync } from 'node:child_process';

/**
 * E2E runs against the demo tenant. Rebuilding it before the suite keeps
 * customer points, stock and shifts deterministic and never touches production.
 */
export default async function globalSetup(): Promise<void> {
  execSync('npm run db:seed', { stdio: 'inherit', cwd: process.cwd() });
}
