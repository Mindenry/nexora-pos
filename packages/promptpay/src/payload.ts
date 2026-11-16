import { crc16Hex } from './crc16';
import {
  validateIdentifier,
  type PromptPayIdentifierType,
} from './identifier';
import { encodeTemplate, encodeTlv, findTlv, parseTlv } from './tlv';

export const PROMPTPAY_AID = 'A000000677010111';
export const THAI_QR_CURRENCY = '764';
export const THAI_QR_COUNTRY = 'TH';
/** EMVCo tag 54 allows up to 13 characters, including the decimal point. */
export const MAX_PROMPTPAY_AMOUNT_SATANG = 999_999_999_999;

export type PromptPayErrorCode =
  | 'INVALID_IDENTIFIER'
  | 'INVALID_AMOUNT'
  | 'INVALID_REFERENCE'
  | 'INVALID_PAYLOAD'
  | 'CRC_MISMATCH';

export class PromptPayPayloadError extends Error {
  readonly code: PromptPayErrorCode;
  readonly reason?: string;

  constructor(code: PromptPayErrorCode, reason?: string) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = 'PromptPayPayloadError';
    this.code = code;
    this.reason = reason;
  }
}

export interface BuildPromptPayPayloadInput {
  identifierType: PromptPayIdentifierType;
  identifier: string;
  amountSatang?: number | null;
  referenceLabel?: string | null;
  pointOfInitiation?: 'static' | 'dynamic';
}

export interface DecodedPromptPayPayload {
  payload: string;
  crc: string;
  crcValid: boolean;
  payloadFormat: string;
  pointOfInitiation: 'static' | 'dynamic';
  aid: string;
  identifierType: PromptPayIdentifierType;
  identifierValue: string;
  amountSatang: number | null;
  amountText: string | null;
  currency: string;
  country: string;
  referenceLabel: string | null;
}

export function formatPromptPayAmount(amountSatang: number): string {
  if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0) {
    throw new PromptPayPayloadError('INVALID_AMOUNT', 'must_be_positive_integer_satang');
  }
  if (amountSatang > MAX_PROMPTPAY_AMOUNT_SATANG) {
    throw new PromptPayPayloadError('INVALID_AMOUNT', 'exceeds_emvco_tag_54');
  }
  const baht = Math.floor(amountSatang / 100);
  const satang = amountSatang % 100;
  const text = `${baht}.${String(satang).padStart(2, '0')}`;
  if (text.length > 13) throw new PromptPayPayloadError('INVALID_AMOUNT', 'exceeds_13_characters');
  return text;
}

export function parsePromptPayAmount(text: string): number {
  if (!/^\d{1,10}(\.\d{2})$/.test(text)) {
    throw new PromptPayPayloadError('INVALID_AMOUNT', 'malformed_amount');
  }
  const [baht, satang] = text.split('.');
  return Number(baht) * 100 + Number(satang);
}

function normalizeReferenceLabel(input: string | null | undefined): string | null {
  if (input == null) return null;
  const value = input.trim().toUpperCase();
  if (!value) return null;
  if (!/^[A-Z0-9._-]{1,25}$/.test(value)) {
    throw new PromptPayPayloadError('INVALID_REFERENCE', 'allowed_A-Z_0-9_dot_underscore_hyphen_max_25');
  }
  return value;
}

/**
 * Builds an EMVCo Merchant-Presented Mode payload for a PromptPay proxy.
 * Tag order follows EMVCo numeric order: 00, 01, 29, 53, 54, 58, 62, 63.
 * No merchant name/city is added: the payer's bank resolves the registered
 * PromptPay account name from the proxy, and inventing a name would be
 * misleading.
 */
export function buildPromptPayPayload(input: BuildPromptPayPayloadInput): string {
  const identifier = validateIdentifier(input.identifierType, input.identifier);
  if (!identifier.ok) {
    throw new PromptPayPayloadError('INVALID_IDENTIFIER', `${identifier.type}_${identifier.reason}`);
  }

  const hasAmount = input.amountSatang != null;
  const pointOfInitiation =
    input.pointOfInitiation ?? (hasAmount ? 'dynamic' : 'static');
  const referenceLabel = normalizeReferenceLabel(input.referenceLabel);

  const merchantAccount = encodeTemplate('29', [
    encodeTlv('00', PROMPTPAY_AID),
    encodeTlv(identifier.type === 'mobile' ? '01' : '02', identifier.payloadValue),
  ]);

  const fields = [
    encodeTlv('00', '01'),
    encodeTlv('01', pointOfInitiation === 'dynamic' ? '12' : '11'),
    merchantAccount,
    encodeTlv('53', THAI_QR_CURRENCY),
    hasAmount ? encodeTlv('54', formatPromptPayAmount(input.amountSatang!)) : '',
    encodeTlv('58', THAI_QR_COUNTRY),
    referenceLabel
      ? encodeTemplate('62', [encodeTlv('05', referenceLabel)])
      : '',
  ].filter(Boolean);

  const withoutCrc = fields.join('') + '6304';
  const crc = crc16Hex(withoutCrc);
  return `${withoutCrc}${crc}`;
}

export function decodePromptPayPayload(payload: string): DecodedPromptPayPayload {
  if (!payload.startsWith('000201')) {
    throw new PromptPayPayloadError('INVALID_PAYLOAD', 'missing_payload_format');
  }
  const fields = parseTlv(payload);
  const crcField = fields[fields.length - 1];
  if (!crcField || crcField.tag !== '63' || crcField.length !== 4) {
    throw new PromptPayPayloadError('INVALID_PAYLOAD', 'missing_crc');
  }
  const expectedCrc = crc16Hex(payload.slice(0, -4));
  const crcValid = expectedCrc === crcField.value;
  if (!crcValid) {
    throw new PromptPayPayloadError('CRC_MISMATCH', `${crcField.value}_expected_${expectedCrc}`);
  }

  const format = findTlv(fields, '00')?.value;
  const poi = findTlv(fields, '01')?.value;
  const merchant = findTlv(fields, '29');
  const currency = findTlv(fields, '53')?.value;
  const amount = findTlv(fields, '54')?.value;
  const country = findTlv(fields, '58')?.value;
  const additional = findTlv(fields, '62');

  if (format !== '01') throw new PromptPayPayloadError('INVALID_PAYLOAD', 'payload_format');
  if (poi !== '11' && poi !== '12') {
    throw new PromptPayPayloadError('INVALID_PAYLOAD', 'point_of_initiation');
  }
  if (!merchant) throw new PromptPayPayloadError('INVALID_PAYLOAD', 'missing_merchant_account');
  if (currency !== THAI_QR_CURRENCY) {
    throw new PromptPayPayloadError('INVALID_PAYLOAD', 'currency');
  }
  if (country !== THAI_QR_COUNTRY) {
    throw new PromptPayPayloadError('INVALID_PAYLOAD', 'country');
  }

  const merchantFields = parseTlv(merchant.value);
  const aid = findTlv(merchantFields, '00')?.value;
  if (aid !== PROMPTPAY_AID) {
    throw new PromptPayPayloadError('INVALID_PAYLOAD', 'promptpay_aid');
  }
  const mobile = findTlv(merchantFields, '01')?.value;
  const nationalId = findTlv(merchantFields, '02')?.value;
  if (Boolean(mobile) === Boolean(nationalId)) {
    throw new PromptPayPayloadError('INVALID_PAYLOAD', 'exactly_one_proxy_required');
  }

  let referenceLabel: string | null = null;
  if (additional) {
    referenceLabel = findTlv(parseTlv(additional.value), '05')?.value ?? null;
  }

  return {
    payload,
    crc: crcField.value,
    crcValid,
    payloadFormat: format,
    pointOfInitiation: poi === '12' ? 'dynamic' : 'static',
    aid,
    identifierType: mobile ? 'mobile' : 'national_id',
    identifierValue: mobile ?? nationalId!,
    amountSatang: amount ? parsePromptPayAmount(amount) : null,
    amountText: amount ?? null,
    currency,
    country,
    referenceLabel,
  };
}

export function isValidPromptPayPayload(payload: string): boolean {
  try {
    decodePromptPayPayload(payload);
    return true;
  } catch {
    return false;
  }
}
