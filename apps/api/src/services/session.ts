import type { Db } from '@nexora/db';
import { randomToken, sha256 } from './password';

export const SESSION_COOKIE = 'nexora_session';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: Db,
  userId: string,
  opts: { remember?: boolean; ip?: string; userAgent?: string },
): Promise<CreatedSession> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (opts.remember ? 30 : 7) * DAY_MS);
  await db.queryGlobal(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, sha256(token), expiresAt, opts.ip ?? null, opts.userAgent ?? null],
  );
  return { token, expiresAt };
}

export function sessionCookieOptions(isProd: boolean, remember: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
    ...(remember ? { maxAge: 30 * DAY_MS } : {}),
  };
}
