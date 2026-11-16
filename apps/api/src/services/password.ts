import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!n || !r || !p || !saltRaw || !hashRaw) return false;
  const expected = Buffer.from(hashRaw, 'base64url');
  const derived = await scryptAsync(password, Buffer.from(saltRaw, 'base64url'), expected.length, {
    N: n,
    r,
    p,
  });
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/** A real hash so a missing user costs the same as a wrong password. */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$b5ZXLcaJ0m1Vv9nHc8iQ1g$5Yh1V0m8b0m8K0n3i0K0m8b0m8K0n3i0K0m8b0m8K0n3i0K0m8b0m8K0n3i0K0m8b0m8K0n3i0K0m8b0m8K0n3i0K0m8b0m8K0n3iA';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
