import { describe, expect, it } from 'vitest';
import {
  buildPromptPayPayload,
  crc16Hex,
  decodePromptPayPayload,
  detectIdentifierType,
  formatPromptPayAmount,
  isValidPromptPayPayload,
  normalizeThaiNationalId,
  normalizeThaiMobile,
  PromptPayPayloadError,
  validateIdentifier,
} from './index';

// Reference vectors below come from github.com/ultramcu/go-promptpay
// (MIT, v0.1.0 encode_test.go), which assembles them independently from the
// BOT/EMVCo TLV rules and cross-checks the Dart reference implementation.
describe('CRC16/CCITT-FALSE', () => {
  it('matches the published check vector', () => {
    expect(crc16Hex('123456789')).toBe('29B1');
  });
});

describe('Thai mobile validation', () => {
  it.each(['0812345678', '081-234-5678', '+66812345678', '66812345678'])(
    'normalizes %s',
    (input) => {
      const result = normalizeThaiMobile(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.normalized).toBe('0812345678');
      expect(result.payloadValue).toBe('0066812345678');
      expect(result.masked).toBe('081-•••-5678');
    },
  );

  it('accepts 06 and 09 prefixes', () => {
    expect(normalizeThaiMobile('0612345678').ok).toBe(true);
    expect(normalizeThaiMobile('0912345678').ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['081234567', 'length'],
    ['08123456789', 'length'],
    ['0212345678', 'prefix'],
    ['0712345678', 'prefix'],
    ['08123A5678', 'characters'],
    ['+6612345678', 'length'],
  ])('rejects %s', (input, reason) => {
    const result = normalizeThaiMobile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it('detects the identifier type without guessing', () => {
    expect(detectIdentifierType('0812345678')).toBe('mobile');
    expect(detectIdentifierType('+66812345678')).toBe('mobile');
    expect(detectIdentifierType('1101700230708')).toBe('national_id');
    expect(detectIdentifierType('12345')).toBeNull();
  });
});

describe('Thai national ID validation', () => {
  it.each(['1101700230708', '1100112345678', '1-1001-12345-67-8'])(
    'accepts a MOD-11 valid ID: %s',
    (input) => {
      const result = normalizeThaiNationalId(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payloadValue).toBe(result.normalized);
      expect(result.masked).toMatch(/^X-XXXX-XXXXX-XX-\d$/);
      expect(result.masked).not.toContain(result.normalized);
    },
  );

  it.each([
    ['', 'empty'],
    ['110170023070', 'length'],
    ['11017002307081', 'length'],
    ['1101700230709', 'checksum'],
    ['11017002307A8', 'characters'],
    ['0000000000000', 'checksum'],
  ])('rejects %s', (input, reason) => {
    const result = normalizeThaiNationalId(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });
});

describe('PromptPay payload reference vectors', () => {
  it('builds a static mobile QR exactly', () => {
    expect(
      buildPromptPayPayload({ identifierType: 'mobile', identifier: '0812345678' }),
    ).toBe('00020101021129370016A0000006770101110113006681234567853037645802TH6304823E');
  });

  it('builds a 100.00 THB dynamic QR exactly', () => {
    expect(
      buildPromptPayPayload({
        identifierType: 'mobile',
        identifier: '0812345678',
        amountSatang: 10_000,
      }),
    ).toBe('00020101021229370016A0000006770101110113006681234567853037645406100.005802TH6304F142');
  });

  it('builds a 100.50 THB dynamic QR exactly', () => {
    expect(
      buildPromptPayPayload({
        identifierType: 'mobile',
        identifier: '0812345678',
        amountSatang: 10_050,
      }),
    ).toBe('00020101021229370016A0000006770101110113006681234567853037645406100.505802TH6304FFE3');
  });

  it('builds a national ID static QR exactly', () => {
    expect(
      buildPromptPayPayload({ identifierType: 'national_id', identifier: '1101700230708' }),
    ).toBe('00020101021129370016A0000006770101110213110170023070853037645802TH6304E850');
  });

  it('builds a national ID 50.00 THB QR exactly', () => {
    expect(
      buildPromptPayPayload({
        identifierType: 'national_id',
        identifier: '1101700230708',
        amountSatang: 5_000,
      }),
    ).toBe('00020101021229370016A000000677010111021311017002307085303764540550.005802TH63045583');
  });

  it('accepts a dashed national ID and produces the same payload', () => {
    const a = buildPromptPayPayload({
      identifierType: 'national_id',
      identifier: '1-1001-12345-67-8',
    });
    const b = buildPromptPayPayload({
      identifierType: 'national_id',
      identifier: '1100112345678',
    });
    expect(a).toBe(b);
  });
});

describe('amount formatting', () => {
  it('formats exact satang without floats', () => {
    expect(formatPromptPayAmount(1)).toBe('0.01');
    expect(formatPromptPayAmount(50)).toBe('0.50');
    expect(formatPromptPayAmount(422)).toBe('4.22');
    expect(formatPromptPayAmount(100_000)).toBe('1000.00');
  });

  it('rejects zero, negative, fractional and oversized amounts', () => {
    expect(() => formatPromptPayAmount(0)).toThrow(PromptPayPayloadError);
    expect(() => formatPromptPayAmount(-1)).toThrow(PromptPayPayloadError);
    expect(() => formatPromptPayAmount(1.5)).toThrow(PromptPayPayloadError);
    expect(() => formatPromptPayAmount(1_000_000_000_000)).toThrow(PromptPayPayloadError);
  });
});

describe('payload validation and decoding', () => {
  it('round-trips a mobile payload with a reference label', () => {
    const payload = buildPromptPayPayload({
      identifierType: 'mobile',
      identifier: '0812345678',
      amountSatang: 12_345,
      referenceLabel: 'PP-7K3M9Q',
    });
    expect(payload).toContain('62130509PP-7K3M9Q');
    const decoded = decodePromptPayPayload(payload);
    expect(decoded.crcValid).toBe(true);
    expect(decoded.identifierType).toBe('mobile');
    expect(decoded.identifierValue).toBe('0066812345678');
    expect(decoded.amountSatang).toBe(12_345);
    expect(decoded.amountText).toBe('123.45');
    expect(decoded.referenceLabel).toBe('PP-7K3M9Q');
    expect(decoded.pointOfInitiation).toBe('dynamic');
    expect(isValidPromptPayPayload(payload)).toBe(true);
  });

  it('rejects a tampered CRC', () => {
    const payload = buildPromptPayPayload({ identifierType: 'mobile', identifier: '0812345678' });
    const tampered = `${payload.slice(0, -4)}0000`;
    expect(() => decodePromptPayPayload(tampered)).toThrow(/CRC_MISMATCH/);
    expect(isValidPromptPayPayload(tampered)).toBe(false);
  });

  it('rejects malformed and non-PromptPay payloads', () => {
    expect(isValidPromptPayPayload('not-a-qr')).toBe(false);
    expect(isValidPromptPayPayload('000201010211')).toBe(false);
  });

  it('rejects invalid identifiers before building', () => {
    expect(() =>
      buildPromptPayPayload({ identifierType: 'national_id', identifier: '1101700230709' }),
    ).toThrow(/INVALID_IDENTIFIER/);
    expect(() =>
      buildPromptPayPayload({ identifierType: 'mobile', identifier: '0212345678' }),
    ).toThrow(/INVALID_IDENTIFIER/);
  });

  it('rejects unsafe reference labels', () => {
    expect(() =>
      buildPromptPayPayload({
        identifierType: 'mobile',
        identifier: '0812345678',
        referenceLabel: 'ORDER #1',
      }),
    ).toThrow(/INVALID_REFERENCE/);
  });

  it('validates the chosen identifier type explicitly', () => {
    expect(validateIdentifier('mobile', '1101700230708').ok).toBe(false);
    expect(validateIdentifier('national_id', '0812345678').ok).toBe(false);
  });
});
