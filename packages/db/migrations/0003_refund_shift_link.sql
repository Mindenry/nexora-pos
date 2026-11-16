-- Refund traceability to the cash drawer and the original document.
ALTER TABLE refunds ADD COLUMN shift_id uuid REFERENCES shifts(id);
ALTER TABLE refunds ADD COLUMN original_number text NOT NULL DEFAULT '';
ALTER TABLE refunds ADD COLUMN business_date date NOT NULL DEFAULT CURRENT_DATE;
CREATE INDEX refunds_shift_idx ON refunds (tenant_id, shift_id, created_at DESC);
CREATE INDEX refunds_business_date_idx ON refunds (tenant_id, store_id, business_date);
