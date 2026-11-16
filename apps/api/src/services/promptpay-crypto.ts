import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const VERSION = 'v1';
const INFO_ENCRYPTION = 'nexora-promptpay-identifier-encryption-v1';
const INFO_HASH = 'nexora-promptpay-identifier-hash-v1';

let encryptionKey: Buffer | null = null;
let hashKey: Buffer | null = null;

function derive(master: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, 'nexora-promptpay', info, 32));
}

function parseConfiguredKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  const base64 = Buffer.from(trimmed, 'base64');
  if (base64.length === 32) return base64;
  throw new Error('PROMPTPAY_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
}

/**
 * Initializes the identifier encryption keys. A dedicated
 * PROMPTPAY_ENCRYPTION_KEY is preferred; without it we derive a domain-separated
 * key from SESSION_SECRET so development and tests work without extra setup.
 * Losing this key makes stored identifiers unrecoverable, so back it up with the
 * same process as other production secrets.
 */
export function configurePromptPayCrypto(options: {
  encryptionKey?: string;
  sessionSecret?: string;
}): void {
  const configured = parseConfiguredKey(options.encryptionKey);
  if (configured) {
    encryptionKey = configured;
    hashKey = derive(configured.toString('hex'), INFO_HASH);
    return;
  }
  const secret = options.sessionSecret ?? process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('SESSION_SECRET is required to derive the PromptPay encryption key');
  }
  encryptionKey = derive(secret, INFO_ENCRYPTION);
  hashKey = derive(secret, INFO_HASH);
}

function keys(): { encryption: Buffer; hash: Buffer } {
  if (!encryptionKey || !hashKey) {
    configurePromptPayCrypto({
      encryptionKey: process.env.PROMPTPAY_ENCRYPTION_KEY,
      sessionSecret: process.env.SESSION_SECRET,
    });
  }
  return { encryption: encryptionKey!, hash: hashKey! };
}

export function encryptSecret(plaintext: string): string {
  const { encryption } = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryption, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

export function decryptSecret(encoded: string): string {
  const { encryption } = keys();
  const [version, ivText, tagText, ciphertextText] = encoded.split(':');
  if (version !== VERSION || !ivText || !tagText || ciphertextText === undefined) {
    throw new Error('Unsupported PromptPay identifier ciphertext');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryption, Buffer.from(ivText, 'base64'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Deterministic keyed hash for duplicate detection. Never expose this value. */
export function hashIdentifier(normalized: string): string {
  const { hash } = keys();
  return createHmac('sha256', hash).update(normalized).digest('hex');
}

export const encryptIdentifier = encryptSecret;
export const decryptIdentifier = decryptSecret;
