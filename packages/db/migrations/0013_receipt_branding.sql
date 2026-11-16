-- Tenant receipt branding. Snapshots copy these values at sale time so later
-- edits never change historical receipts.

ALTER TABLE businesses
  ADD COLUMN receipt_accent text NOT NULL DEFAULT '#2AA78C'
    CHECK (receipt_accent ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN receipt_logo_url text NOT NULL DEFAULT '',
  ADD COLUMN receipt_header_note text NOT NULL DEFAULT '',
  ADD COLUMN receipt_show_cashier boolean NOT NULL DEFAULT true,
  ADD COLUMN receipt_show_tax_id boolean NOT NULL DEFAULT true,
  ADD COLUMN receipt_paper_width text NOT NULL DEFAULT '80mm'
    CHECK (receipt_paper_width IN ('80mm', 'a4'));
