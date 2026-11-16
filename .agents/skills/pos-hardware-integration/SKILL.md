---
name: pos-hardware-integration
description: >
  Integrates POS peripherals behind a testable abstraction: barcode scanners (HID/GS1), ESC/POS
  receipt printers including Thai code pages, cash drawers, scales, customer displays, EDC terminals
  and kiosks, with health checks, print queues, failure recovery and device security. Use for
  "printer not printing", "barcode wrong item", "drawer won't open", Thai text garbled on receipt,
  เครื่องพิมพ์ใบเสร็จ, บาร์โค้ด, or peripheral timeouts. Not for payment confirmation logic
  (pos-payment-reconciliation) or receipt content rules (pos-thailand-commerce).
---

# POS hardware integration

Store hardware fails constantly and in boring ways: paper out, cover open, USB re-enumerated, a
scanner typing into the wrong field, a scale that never stabilises, an EDC on a different subnet.
Design for that, not for the demo table.

## When to use

- Adding a scanner, printer, drawer, scale, display, EDC or kiosk.
- Printing is slow, duplicated, cut off, or Thai text is garbled.
- Barcodes resolve to the wrong item, or scanned characters are lost.
- A peripheral disappears after sleep, reboot or USB re-plug.
- Designing a hardware abstraction, diagnostics screen or remote device config.

**Not this skill:** whether a payment is confirmed (`pos-payment-reconciliation`); what a receipt
must legally contain (`pos-thailand-commerce`); queue/sync of business data
(`pos-offline-sync-engine`).

## Architecture: ports and adapters

```text
domain (sale, tender, receipt document)
        │  depends only on these interfaces
        ▼
ports: ScannerPort · PrinterPort · DrawerPort · ScalePort · DisplayPort · EdcPort
        │
adapters: hid-scanner · escpos-usb · escpos-network · serial-scale · edc-serial · edc-cloud
        │
transport: WebUSB/WebHID · node-usb · serialport · TCP 9100 · vendor SDK · OS print spooler
```

Rules:

1. **Business logic never imports a vendor SDK.** A receipt is a structured document; rendering is an
   adapter concern.
2. **Every adapter exposes `capabilities()`, `health()`, `open()`, `close()`** and typed errors.
3. **Failures are recoverable and visible.** A printer error must not fail the sale; it queues and
   alerts.
4. **One device can have multiple adapters** (USB printer with a network fallback); selection is
   configuration with a deterministic order.
5. **All I/O is bounded**: timeouts on every call, no unbounded retries, no blocking the UI thread.

```ts
type DeviceState = 'uninitialized' | 'ready' | 'busy' | 'degraded' | 'offline' | 'error';

interface PrinterPort {
  capabilities(): { width: 58 | 80; thai: 'native' | 'raster' | 'none'; cutter: boolean; drawerKick: boolean };
  health(): Promise<{ state: DeviceState; detail?: string }>;
  print(doc: ReceiptDocument, opts: { jobId: string; reprint?: boolean }): Promise<PrintResult>;
  openDrawer?(): Promise<void>;
  on(event: 'paper-out' | 'cover-open' | 'offline' | 'error', cb: (e: DeviceError) => void): () => void;
}
```

## Receipt printing (ESC/POS)

### Document, not strings

Build a structured receipt (`lines[]`, `totals[]`, `tax[]`, `barcode`, `qr`, `cuts`) and let the
adapter render. This makes width, encoding and layout testable without a printer.

### Character encoding and Thai

This is the most common Thai POS defect.

- ESC/POS printers use single-byte code pages. Thai is **TIS-620/CP874**; select it explicitly
  (`ESC t <n>` where `n` is the printer's CP874 slot — vendor-specific, verify from the manual).
- Many cheap thermal printers have **no Thai font**. Two options: (a) printer-side Thai font if the
  model supports it; (b) **rasterise** the Thai text to a bitmap and print as an image
  (`GS v 0`). Rasterising is reliable but slower and larger; batch lines into one image.
- Never rely on the OS spooler to transliterate Thai. Test with vowels, tone marks and stacked
  characters (น้ำ, กิ่ง, ญี่ปุ่น) at the real printer.
- Mixed Thai/English lines need width calculation in **display cells**, not `String.length`: Thai
  combining marks are zero-width, CJK/full-width glyphs are double-width. Write a `displayWidth()`
  helper and test it.
- If a line overflows, wrap on display width and never split a combining sequence.

### Job handling

```text
complete sale (DB commit)
  → enqueue print job (durable, with jobId = saleId + kind)
  → worker prints with timeout
  → on success: mark printed, store printer + template version
  → on failure: mark failed, show operator banner, allow retry/reprint, never block selling
```

- **Idempotency by `jobId`**: a retry after an unknown result must not produce two receipts unless
  the operator explicitly reprints.
- The sale stores `printed_at`, `print_attempts`, `printer_id`, `template_version` for audit.
- Reprints are marked `REPRINT #n` and audited; they never allocate a new document number.
- Keep the last N jobs locally so a printer that comes back online can be reconciled, not flooded.
- Cutter, beeper and drawer kick are commands in the same job; if the cutter fails, the receipt is
  still valid.

### Typical ESC/POS primer

| Function | Command | Notes |
| --- | --- | --- |
| Initialise | `ESC @` | Reset state |
| Code page | `ESC t n` | Vendor-specific mapping |
| Align | `ESC a 0/1/2` | Left/centre/right |
| Bold | `ESC E 1/0` | |
| Font size | `GS ! n` | Width/height multipliers |
| Feed | `ESC d n` | |
| Cut | `GS V 0/1` | Partial/full, model-dependent |
| Drawer kick | `ESC p m t1 t2` | Usually pin 2, 100/200 ms |
| Raster image | `GS v 0 m xL xR yL yR data` | Thai fallback |

Always check the specific printer's programming manual; commands and code-page slots differ.

## Barcode scanners

### HID keyboard wedge

The common mode is a keyboard emulation device. Consequences:

- The scanner types into whatever has focus. **Never rely on focus**; use a global scan buffer that
  only accepts input when a scan context is active, and validate the terminator.
- Detect scans by **keystroke timing** (e.g. inter-key < 30 ms) plus a terminator (Enter/Tab). Test
  with human typing so a fast typist is not mistaken for a scan.
- Set the scanner prefix/suffix (e.g. `\x1D` terminator) and strip it. Configure once via the
  scanner's programming barcode, and document it.
- **Keyboard layout**: a Thai layout can map characters differently. Prefer scanners configured for
  US layout and restrict symbologies to digits/alphanumerics you expect.
- Handle key repeat, dropped characters on slow devices, and the cashier scanning while a modal is
  open (queue one scan, don't lose it).
- Debounce duplicate scans within ~300 ms (same code) unless quantity scanning is intended.

### Symbologies and GS1

- Retail: EAN-13, UPC-A, EAN-8; internal: Code 128, ITF-14 (cases), QR/DataMatrix (2D).
- **GS1-128 / GS1 DataBar**: parse Application Identifiers (AI) — `01` GTIN, `10` batch, `17` expiry
  (YYMMDD), `30` qty, `21` serial. Use FNC1 as separator; naive splitting breaks on variable-length
  AIs.
- **Weighed items**: an in-store barcode often encodes price or weight (prefix 2x). Decode by
  store-specific rules, never guess: a misread prefix can price a steak at ฿1.
- Validate the check digit for EAN/UPC; reject and rescan if invalid.
- Unknown barcode → explicit "not found" flow with manual search, never a silent no-op.
- Scanner configuration is per device model: document symbology enablement, prefix/suffix, keyboard
  layout, and a factory-reset recovery procedure.

## Cash drawer

- Usually opened via the printer's kick command (RJ11/RJ12), not a separate driver.
- Sense pin (if wired) reports open/closed; use it for "drawer left open" alerts, not as proof of a
  cash count.
- Provide a manual key override; log every open (sale, no-sale, change, drop) with the reason.
- A failed kick must not fail the sale: show "open drawer manually" and log the hardware error.
- Test with the real solenoid: some 24 V drawers do not fire reliably from a 12 V port.

## Scales

- Serial (RS-232/USB-serial) with a vendor protocol; parse stable-weight frames only.
- Timeout with a clear message; allow manual weight entry only with permission and a reason.
- Tare and zeroing are hardware operations; mirror the values, don't fake them.
- **Legal-for-trade**: if the weight is used for pricing in a regulated context, use a certified scale
  and retain the raw reading; confirm requirements with the authority. Never round a weight to make a
  price look nicer.
- Disconnect detection: on error, disable weighing rather than silently pricing 0 kg.

## Customer display, KDS and kiosks

- Treat as read-only projections of the current cart; failures must not affect checkout.
- Display amounts in the customer's language and include VAT breakdown where required.
- Kiosk mode: lock the shell (kiosk browser/OS account), disable shortcuts, auto-relaunch on crash,
  hide the taskbar, and monitor heartbeat.
- Never expose admin functions on a customer-facing surface; separate credentials and network zone.

## EDC terminals

- Two integration modes: **semi-integrated** (POS sends amount to the terminal, cashier completes on
  the terminal, result keyed or read back) and **standalone** (cashier types the result into the POS).
- Prefer semi-integrated with a **verified result** from the terminal/provider; a cashier-typed
  "approved" is a claim, not proof (`pos-payment-reconciliation`).
- POS must never see or store PAN/CVV. Do not scrape terminal screens.
- Match POS sale to terminal transaction by amount + reference + time window; mismatches go to review.
- Handle: terminal offline, timeout, cancelled by customer, partial approval, duplicate approval.
- Reconciliation of EDC batches is a daily finance task; the POS records references, not settlements.

## Device lifecycle and configuration

1. **Enrol** the device (code → certificate/token) and record model, serial, firmware, adapters.
2. **Discover** capabilities at startup and store them; don't assume.
3. **Health check** every N seconds; surface state in the UI header (printer, scanner, network, sync).
4. **Reconnect** with backoff on USB/serial/network loss; never spin.
5. **Diagnostics screen**: print test page, scan test, open drawer, scale reading, adapter logs export.
6. **Remote config** with versioning and rollback; a bad printer width setting must be fixable
   without a site visit.
7. **Firmware/driver updates** staged, with a rollback path and a compatibility matrix.
8. **Retire** a device: drain print queue, confirm outbox synced, revoke token, wipe local data.

## Workflow: integrate a peripheral

1. **Get the hardware and its manual.** Exact model, firmware, command set, code-page table, cable and
   power. "A thermal printer" is not a specification.
2. **Write the port and a simulator first**, so the UI and domain can be built without the device.
3. **Implement the adapter** with bounded timeouts, typed errors, reconnect and capability discovery.
4. **Prove the transport** in isolation: a test page, a test scan, a test weight. Capture the bytes.
5. **Integrate with the domain** through the port; keep vendor SDK types out of the domain modules.
6. **Design the failure UX**: state in the header, a clear message, a retry and a manual fallback.
7. **Add the queue** for printing and the debounce for scanning; make retries idempotent by job ID.
8. **Test on the real device** in the real store: Thai text, paper width, USB hub, sleep/resume,
   network printer, EDC.
9. **Add diagnostics and remote config**, then document the configuration in the store runbook.
10. **Stage the rollout**: one store, one shift, with a rollback to the previous adapter.

## Business rules

- Hardware failure never invalidates a completed sale; the receipt is queued and reprinted.
- A print job is bound to one sale and one template version; reprints are explicitly marked.
- A scanned barcode resolves through the variant/barcode table; ambiguous barcodes are configuration
  errors, blocked at setup.
- Manual entry is always available for barcode and weight with permission and reason.
- Prices and totals on the customer display must match the sale snapshot.
- One physical drawer maps to one active shift; one printer may serve one or two drawers.
- Device time is not authoritative for money (`pos-domain-expert` TIME-01).

## Edge cases

| Case | Handling |
| --- | --- |
| Printer paper out mid-receipt | Job fails partially; reprint full receipt with `REPRINT`, never a half duplicate |
| USB printer re-enumerates with a new path | Match by serial/vendor ID, not `/dev/usb/lp0` |
| Two scans of the same item in 100 ms | Debounce; second scan is a quantity increment only if intended |
| Barcode contains GS1 AIs | Parse with FNC1 rules; never split on `*` |
| Thai text shows as `????` | Wrong code page or no font; switch to CP874 or rasterise |
| Line too long with Thai vowels | Wrap by display width, not `length` |
| Scale reads unstable weight | Wait for stable flag or timeout with message |
| Drawer opens but sensor says closed | Treat sensor as advisory; log discrepancy |
| EDC approved but POS timed out | Do not take cash again; verify with provider, resolve in review |
| Network printer on another subnet offline | Fall back to USB adapter if configured; else queue |

## Security

- Allowlist USB devices by vendor/product/serial; block mass storage and HID keyboards from unknown
  devices where the OS supports it.
- Never install drivers or firmware from an unverified source; sign and verify update packages.
- Restrict who can open the diagnostics screen or reconfigure a scanner/printer.
- Sanitise data sent to printers: escape sequences in product names could alter formatting or trigger
  commands. Strip control characters (`0x00–0x1F`) from user-controlled text.
- Do not log raw device payloads containing customer data; redact.
- EDC integration never handles card data; keep the terminal on a segmented network.
- Kiosk devices run a locked-down OS image with full-disk encryption and remote wipe.

## Error handling

| Code | Meaning | Operator action |
| --- | --- | --- |
| `HW_PRINTER_OFFLINE` | No response | Check cable/power; print queued |
| `HW_PAPER_OUT` | Sensor | Replace paper, retry |
| `HW_COVER_OPEN` | Sensor | Close cover |
| `HW_PRINTER_TIMEOUT` | Slow/blocked | Retry once, then queue |
| `HW_UNSUPPORTED_ENCODING` | No Thai code page | Switch to raster mode |
| `HW_SCANNER_NO_INPUT` | No terminator/keys | Test scan, check focus/config |
| `HW_BARCODE_INVALID` | Check digit/symbology | Rescan or manual entry |
| `HW_SCALE_TIMEOUT` | No stable weight | Re-weigh, manual with reason |
| `HW_DRAWER_KICK_FAILED` | Solenoid/port | Open manually, log |
| `HW_EDC_NO_RESPONSE` | Terminal issue | Check connection, do not assume failure |

Errors shown to staff must say what to do, in Thai and English, with a retry button.

## Testing requirements

- **Adapter contract tests** against a simulator for every port: happy path, timeout, disconnect,
  partial write, garbage response.
- **Golden receipt** tests: byte-level output for 58 mm and 80 mm, Thai + English, long names,
  discounts, tax breakdown, reprint marking. Snapshot review by a human for the first run.
- **Encoding tests** with Thai combining marks and mixed-width strings.
- **Scanner tests**: HID timing, terminator, GS1 AI parsing, invalid check digit, duplicate debounce,
  Thai keyboard layout.
- **Chaos**: unplug printer/scanner mid-sale; sleep/resume; USB re-enumeration; network printer loss.
- **Soak**: 500 receipts / 2,000 scans with no memory growth or queue drift.
- **Performance**: first line printed < 300 ms after commit on local USB; queue drain < 2 s.
- **Security**: escape-sequence injection in product name does not execute; disallowed USB device is
  blocked.

## Anti-patterns

- Rendering receipts by concatenating strings with ESC/POS bytes in domain code.
- Blocking sale completion on printing.
- Assuming `String.length` equals printed width.
- Relying on input focus for scanner input.
- Hard-coding Thai into a Latin code page and shipping "????".
- Guessing barcode formats, especially weighted/price-embedded codes.
- Treating a cashier-typed EDC approval as verified payment.
- Unbounded retry loops on a dead printer.
- Re-enumerating devices by list index.
- Storing card data from the EDC "for convenience".

## Cross-skill references

Receipt legal content: `pos-thailand-commerce`. Sale print timing and reprints:
`pos-sales-checkout`. Payment result verification: `pos-payment-reconciliation`. Print queue durability
and offline behaviour: `pos-offline-sync-engine`. Drawer/shift rules:
`pos-shift-cash-management`. Device enrolment and secrets: `pos-multi-tenant-saas`. Device data
retention and wipe: `pos-backup-recovery`.
