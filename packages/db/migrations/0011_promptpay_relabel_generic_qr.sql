-- The original seeded generic QR tender was labelled "พร้อมเพย์ / QR". With a
-- dedicated PromptPay tender, keep the generic one clearly separate.
DO $$
DECLARE
  t record;
BEGIN
  PERFORM set_config('app.platform_admin', 'on', true);
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE payment_methods
    SET name = 'QR อื่น ๆ'
    WHERE tenant_id = t.id AND code = 'qr' AND name LIKE '%พร้อมเพย์%';
  END LOOP;
  PERFORM set_config('app.platform_admin', '', true);
  PERFORM set_config('app.tenant_id', '', true);
END $$;
