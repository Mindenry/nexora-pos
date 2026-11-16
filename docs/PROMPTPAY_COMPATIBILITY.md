# PromptPay Compatibility

Version: 1.0  
Verified: 2026-11-16

## 1. Summary

The generated payload is checked against:

- EMVCo MPM TLV structure and CRC-16/CCITT-FALSE.
- The BOT/Thai QR tag 29 layout and PromptPay AID.
- Five published payload vectors from an independent implementation.
- The application's own strict decoder.
- PNG/SVG rendering at scan-friendly sizes.
- End-to-end POS flows at desktop and iPad viewports.

It has **not** been scanned with a real Thai mobile banking application in this
environment. No bank is claimed as tested or certified.

## 2. What was verified

| Area | Evidence | Result |
| --- | --- | --- |
| TLV parsing and lengths | `packages/promptpay/src/payload.test.ts` | Pass |
| CRC check vector `123456789 -> 29B1` | same | Pass |
| Mobile static vector | exactly matches S5 | Pass |
| Mobile 100.00 / 100.50 vectors | exactly matches S5 | Pass |
| National ID static / 50.00 vectors | exactly matches S5 | Pass |
| Phone normalization forms | `0812345678`, dashed, `+66`, `66` | Pass |
| Invalid phone length/prefix/characters | test matrix | Rejected |
| National ID MOD-11 | valid and invalid vectors | Pass/Rejected |
| Amount 0.01, 0.50, 4.22, 100.00 | formatting tests | Pass |
| Zero/negative/fractional/oversized amount | throws | Rejected |
| Tampered CRC | decode fails | Rejected |
| Static QR (no amount) | API test + strict decode | Pass |
| Dynamic QR (fixed amount) | reference vectors + POS E2E | Pass |
| PNG data URL / SVG | API test asserts prefixes and `<svg` | Pass |
| QR not returned after paid/expired | session tests | Pass |
| POS integration | E2E sale with staff confirmation | Pass |
| Checkout blocked before verification | E2E | Pass |
| Duplicate confirmation | concurrency test | One transaction |
| Reuse of a verified session | API test | 409 |
| iPad layout | 1194×834 touch viewport | Pass |
| Signed webhook auto-confirm | API tests + E2E synthetic signed event | Pass |
| Webhook signature/replay rejection | forged HMAC, stale timestamp | Rejected |
| POS polls and updates automatically | E2E auto-detection journey | Pass |

## 3. What was not verified

- **No real bank application scan.** The device/bank account set required for a
  meaningful test was not available. Compliance is structural, not certified.
- **No cross-border QR** (Thailand–Cambodia/Laos/Malaysia/Singapore/Vietnam etc.).
- **No merchant bill payment (tag 30)**, e-wallet proxy, OTA, or card rails.
- **No real bank/PSP webhook**. The signed receiver is tested with synthetic
  events, but a contracted provider must be configured and certified.
- **No real thermal printer or scanner**. Print output is browser print; a
  scan test with a physical printer is recommended before deployment.
- **No production performance/load test** for the QR endpoint.

## 4. Compatibility risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Proxy not registered with PromptPay | Bank app cannot resolve the recipient | UI tells the operator to verify in their banking app; no offline registration lookup is possible |
| National ID checksum passes but ID is not the shop's | Money goes to another person | Mandatory staff verification; explicit warning that checksum is not ownership |
| Bank app ignores or displays tag 62 differently | Reference not visible on the slip | Staff can still match amount/time and enter the slip reference manually |
| Dynamic QR (`01=12`) paid twice | Duplicate incoming funds | POS binds one verified session to one sale; a second payment must be refunded manually by the merchant |
| Bank-specific amount limits | Transfer fails above a limit | Treat limits as bank policy; split or use another tender |
| Thai font/encoding in printed slip | Garbled text on some printers | QR image itself is ASCII; printing uses the browser and system fonts |
| Clock skew | Expiry countdown differs from real time | Server stores `expires_at`; staff can override with an audit note |
| Amount changed after QR creation | QR no longer matches cart | Checkout compares the server-priced total and session amount, then rejects with `DOMAIN_PROMPTPAY_AMOUNT_MISMATCH` |

## 5. Recommended real-device acceptance test

Before using real money:

1. Register the shop's own PromptPay proxy in a banking app and confirm the
   displayed account name.
2. Add that proxy in **PromptPay → Receiving accounts**.
3. Generate a 1 THB static QR and a 1 THB POS QR.
4. Scan each with at least three Thai banking apps used by staff/customers.
5. Confirm the app shows the expected recipient name, amount and reference.
6. Pay 1 THB from each app, one at a time.
7. Confirm the app/statement shows the money before pressing **Verify payment**.
8. Complete the sale and check the receipt, payment history, audit timeline and
   shift totals.
9. Issue a refund and confirm the PromptPay session becomes `refunded` when the
   sale is fully refunded.
10. Repeat on the actual tablet/printer/scanner hardware.

Record the bank names, app versions, device models and results. Do not publish a
compatibility claim from a single successful scan.

## 6. Reference vectors

The exact five payloads used in automated tests are listed in
`docs/PROMPTPAY_SPECIFICATION.md` §8. They can be rendered and decoded by any
EMVCo-compliant tool to reproduce the structural check without scanning.

## 7. Conclusion

The implementation is **structurally compatible** with the documented Thai QR
Payment PromptPay credit-transfer profile. Real bank acceptance must be
established by the merchant on real devices before production use. The POS
workflow is deliberately independent of bank compatibility: even if a bank app
accepts the QR, the sale is not marked paid until a staff member verifies the
incoming funds.
