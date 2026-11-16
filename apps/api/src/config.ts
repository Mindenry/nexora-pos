import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

function findEnvFile(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = findEnvFile();
if (envFile) dotenv.config({ path: envFile });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  isProd: boolean;
  databaseUrl: string;
  sessionSecret: string;
  port: number;
  webOrigin: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    isProd: value.NODE_ENV === 'production',
    databaseUrl: value.DATABASE_URL,
    sessionSecret: value.SESSION_SECRET,
    port: value.API_PORT,
    webOrigin: value.WEB_ORIGIN,
    logLevel: value.LOG_LEVEL,
  };
}
