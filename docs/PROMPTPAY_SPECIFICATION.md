# PromptPay / Thai QR Payload Specification

Version: 1.0  
Reference date: 2026-11-16

This document describes exactly what NEXORA generates. It is limited to
PromptPay person-to-person credit transfer QR (EMVCo Merchant-Presented Mode,
tag 29, AID `A000000677010111`). It does not define merchant bill payment
(tag 30), payment innovation (tag 31), card rails, or cross-border payloads.

## 1. Encoding rules

Every field is ASCII TLV:

```
tag (2 decimal digits) | length (2 decimal digits) | value (exactly length chars)
```

- Length is decimal, zero-padded, not hexadecimal.
- A single field value is at most 99 characters.
- Templates (`29`, `62`) contain nested TLV.
- The final field is always tag `63` with length `04`.

## 2. Top-level fields used

| Tag | Name | Required | Value in this implementation |
| --- | --- | --- | --- |
| `00` | Payload Format Indicator | yes | `01` |
| `01` | Point of Initiation Method | yes | `11` static, `12` dynamic |
| `29` | Merchant Account Information (PromptPay) | yes | Nested PromptPay template |
| `53` | Transaction Currency | yes | `764` (THB) |
| `54` | Transaction Amount | when fixed amount | Decimal string with exactly two decimals, e.g. `129.00` |
| `58` | Country Code | yes | `TH` |
| `62` | Additional Data Field Template | optional | Contains `05` reference label when a POS session reference exists |
| `63` | CRC | yes | Four uppercase hex characters |

Not emitted intentionally:

- `52` merchant category code, `59` merchant name, `60` merchant city: a personal
  PromptPay proxy resolves the registered account name from the bank directory.
  Writing an arbitrary shop name into those tags would be misleading.
- `55`–`57` tip/convenience fee fields: not supported.
- `64` language template: not supported.

Field order used by this implementation is numeric:
`00, 01, 29, 53, 54, 58, 62, 63`.

EMVCo parsers are TLV-based, and both reference implementations in
`docs/PROMPTPAY_RESEARCH.md` use slightly different valid orders (`58`/`53`/`54`).
The numeric order above is deliberate and is covered by reference vectors.

## 3. Tag 29 — PromptPay credit transfer

```
29 LL
   00 16 A000000677010111      Application Identifier
   01 13 0066812345678         Mobile proxy (only for mobile)
   02 13 1101700230708         National ID / tax ID proxy (only for national ID)
```

Exactly one of `01` or `02` is emitted. `03` (e-wallet), `04` (bank account) and
`05` (OTA) are intentionally unsupported in this version.

### 3.1 Mobile proxy

Accepted input forms:

```
0812345678
081-234-5678
+66812345678
66812345678
```

Normalization:

1. Remove spaces, dashes, dots and parentheses.
2. Convert a leading `+66` or `66` to a leading `0`.
3. Require exactly 10 digits.
4. Require the first two digits to be `06`, `08` or `09`.
5. Encode as `0066` + the last 9 digits.

```
0812345678 -> 0066812345678
```

Rejected: empty input, wrong length, landline/service prefixes, letters, and
strings that only look like a phone number.

This validates structure only. Registration with PromptPay is a separate bank
process and is not checked.

### 3.2 National ID proxy

Accepted input:

```
1101700230708
1-1001-12345-67-8
```

Rules:

1. Remove spaces and dashes; reject any other non-digit character.
2. Require exactly 13 digits.
3. Require the first digit to be `1`–`9`.
4. Verify the MOD-11 check digit:

```
sum = Σ digit[i] × (13 - i), i = 0..11
expected = (11 - (sum mod 11)) mod 10
valid = expected == digit[12]
```

5. Encode the 13 digits as-is in tag `29-02`.

The checksum is a format check, not proof of identity or PromptPay registration.

## 4. Amount

The public API and database use integer satang. Encoding:

```
baht = floor(satang / 100)
satangRemainder = satang % 100
value = `${baht}.${padStart(satangRemainder, 2)}`
```

Examples:

| Satang | Tag 54 value |
| --- | --- |
| 1 | `0.01` |
| 50 | `0.50` |
| 422 | `4.22` |
| 10 000 | `100.00` |
| 12 345 | `123.45` |

Rejected: zero, negative, non-integer, and values whose encoded string exceeds
13 characters. Maximum accepted: `999999999999` satang
(9,999,999,999.99 THB).

## 5. Static and dynamic

| Use | Tag 01 | Tag 54 | Session |
| --- | --- | --- | --- |
| Reusable receiving QR (payer enters amount) | `11` | absent | none |
| POS sale QR (fixed amount) | `12` | present | `payment_sessions` row |

The dynamic marker expresses intent only. It is not an expiry or a single-use
token. The POS therefore never treats `01=12` as proof of payment.

## 6. Additional data (tag 62)

When a POS session is created, tag 62 contains:

```
62 LL
   05 LL REFERENCE
```

The reference is generated server-side, uppercase, and limited to
`A-Z0-9._-`, e.g. `PP-04F8A1755AE3`. It is also stored in
`payment_sessions.reference`. It is not personal data and is not the same as a
bank slip reference.

Static QR has no tag 62.

## 7. CRC-16

Algorithm: CRC-16/CCITT-FALSE.

- Polynomial `0x1021`
- Initial value `0xFFFF`
- No input reflection
- No output reflection
- No final XOR
- Computed over the full payload **including** the literal `6304`
- Appended as four uppercase hexadecimal characters

Check vector:

```
CRC16_CCITT_FALSE("123456789") = 0x29B1
```

Construction:

```
withoutCrc = fields.join("") + "6304"
payload = withoutCrc + crc16Hex(withoutCrc)
```

No CRC value is hardcoded anywhere.

## 8. Reference vectors

These vectors come from `ultramcu/go-promptpay` v0.1.0 `encode_test.go` (MIT),
which assembles them independently from the TLV rules. They match this engine
byte-for-byte.

### 8.1 Mobile, no amount

Input: `0812345678`

```
00020101021129370016A0000006770101110113006681234567853037645802TH6304823E
```

### 8.2 Mobile, 100.00 THB

Input: `0812345678`, amount 10 000 satang

```
00020101021229370016A0000006770101110113006681234567853037645406100.005802TH6304F142
```

### 8.3 Mobile, 100.50 THB

Input: `0812345678`, amount 10 050 satang

```
00020101021229370016A0000006770101110113006681234567853037645406100.505802TH6304FFE3
```

### 8.4 National ID, no amount

Input: `1101700230708`

```
00020101021129370016A0000006770101110213110170023070853037645802TH6304E850
```

### 8.5 National ID, 50.00 THB

Input: `1101700230708`, amount 5 000 satang

```
00020101021229370016A000000677010111021311017002307085303764540550.005802TH63045583
```

The engine's test suite asserts all five strings exactly, plus the
`123456789 -> 29B1` CRC vector.

## 9. Validation performed on decode

`decodePromptPayPayload` fails closed unless:

1. Payload starts with `000201`.
2. The entire string parses as complete TLV with no leftover bytes.
3. The last field is `63`, length 4.
4. CRC matches.
5. `00` is `01`.
6. `01` is `11` or `12`.
7. Tag `29` exists and its `00` is `A000000677010111`.
8. Exactly one of `29-01` or `29-02` exists.
9. Currency is `764`.
10. Country is `TH`.
11. Tag `54`, if present, parses as a positive amount with two decimals.

The POS API never returns a QR image if the payload could not be generated from
validated identifier input. The rendering step is downstream of this validation.

## 10. Compatibility caveats

- A payload that follows this specification is structurally a Thai QR Payment
  payload. No claim of certification or bank-by-bank acceptance is made.
- Some banking apps may display or ignore tag 62 differently. The reference is
  an aid for staff reconciliation, not a required field.
- Per-bank transaction limits, slip presentation and duplicate-payment handling
  are outside the payload.
- Static and dynamic QR both remain payable after expiry; expiry is enforced by
  the POS workflow, not by the QR itself.
