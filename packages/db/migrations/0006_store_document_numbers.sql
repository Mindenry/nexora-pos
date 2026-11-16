-- Document numbers are sequential per store (the legal sequence owner), not per tenant.
-- Sales already used (tenant, store, number); align the other document tables.
ALTER TABLE refunds DROP CONSTRAINT refunds_tenant_id_number_key;
ALTER TABLE refunds ADD CONSTRAINT refunds_store_number_key UNIQUE (tenant_id, store_id, number);

ALTER TABLE stock_transfers DROP CONSTRAINT stock_transfers_tenant_id_number_key;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_store_number_key UNIQUE (tenant_id, from_store_id, number);

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_tenant_id_number_key;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_store_number_key UNIQUE (tenant_id, store_id, number);

ALTER TABLE goods_receipts DROP CONSTRAINT goods_receipts_tenant_id_number_key;
ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_store_number_key UNIQUE (tenant_id, store_id, number);
