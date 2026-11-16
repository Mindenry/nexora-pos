export type PromptPayIdentifierType = 'mobile' | 'national_id';

export type IdentifierFailureReason =
  | 'empty'
  | 'characters'
  | 'length'
  | 'prefix'
  | 'checksum';

export interface IdentifierFailure {
  ok: false;
  type: PromptPayIdentifierType;
  reason: IdentifierFailureReason;
}

export interface IdentifierSuccess {
  ok: true;
  type: PromptPayIdentifierType;
  /** Human-facing normalized value: 0812345678 or 1101700230708. */
  normalized: string;
  /** Value written into EMVCo tag 29: 0066812345678 or the 13-digit ID. */
  payloadValue: string;
  /** Safe display value that never reveals the full identifier. */
  masked: string;
}

export type IdentifierValidation = IdentifierSuccess | IdentifierFailure;

const MOBILE_PREFIXES = new Set(['06', '08', '09']);

function digitsOnly(input: string): string {
  return input.replace(/[\s\-().]/g, '');
}

/**
 * Thai mobile numbers used by PromptPay are 10 local digits (0[689]xxxxxxx).
 * +66 and 66-prefixed forms are accepted and normalized to the local form.
 * This validates structure only; PromptPay registration cannot be verified
 * offline.
 */
export function normalizeThaiMobile(input: string): IdentifierValidation {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, type: 'mobile', reason: 'empty' };

  let compact = raw.replace(/[\s\-().]/g, '');
  if (compact.startsWith('+')) {
    if (!/^\+66\d{9}$/.test(compact)) {
      return { ok: false, type: 'mobile', reason: 'length' };
    }
    compact = `0${compact.slice(3)}`;
  } else if (compact.startsWith('66')) {
    if (!/^66\d{9}$/.test(compact)) {
      return { ok: false, type: 'mobile', reason: 'length' };
    }
    compact = `0${compact.slice(2)}`;
  }

  if (!/^\d{10}$/.test(compact)) {
    return { ok: false, type: 'mobile', reason: /[^0-9]/.test(compact) ? 'characters' : 'length' };
  }
  if (!MOBILE_PREFIXES.has(compact.slice(0, 2))) {
    return { ok: false, type: 'mobile', reason: 'prefix' };
  }

  return {
    ok: true,
    type: 'mobile',
    normalized: compact,
    payloadValue: `0066${compact.slice(1)}`,
    masked: `${compact.slice(0, 3)}-•••-${compact.slice(-4)}`,
  };
}

/**
 * Thai national ID MOD-11 checksum. This proves only that the 13 digits are
 * structurally valid, not that the number is registered with PromptPay or
 * belongs to the person presenting it.
 */
export function thaiNationalIdChecksumValid(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(digits[index]) * (13 - index);
  }
  const expected = (11 - (sum % 11)) % 10;
  return expected === Number(digits[12]);
}

export function normalizeThaiNationalId(input: string): IdentifierValidation {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, type: 'national_id', reason: 'empty' };
  const compact = digitsOnly(raw);
  if (/[^0-9]/.test(compact)) {
    return { ok: false, type: 'national_id', reason: 'characters' };
  }
  if (!/^\d{13}$/.test(compact)) {
    return { ok: false, type: 'national_id', reason: 'length' };
  }
  if (compact[0] === '0' || !thaiNationalIdChecksumValid(compact)) {
    return { ok: false, type: 'national_id', reason: 'checksum' };
  }
  return {
    ok: true,
    type: 'national_id',
    normalized: compact,
    payloadValue: compact,
    masked: `X-XXXX-XXXXX-XX-${compact.slice(-1)}`,
  };
}

export function validateIdentifier(
  type: PromptPayIdentifierType,
  input: string,
): IdentifierValidation {
  return type === 'mobile' ? normalizeThaiMobile(input) : normalizeThaiNationalId(input);
}

/** Detect the intended identifier type from the raw input length. */
export function detectIdentifierType(input: string): PromptPayIdentifierType | null {
  const compact = digitsOnly(String(input ?? '').trim()).replace(/^\+?66/, '0').replace(/^0(?=66)/, '');
  if (/^0[689]\d{8}$/.test(compact)) return 'mobile';
  if (/^\d{13}$/.test(compact)) return 'national_id';
  return null;
}
