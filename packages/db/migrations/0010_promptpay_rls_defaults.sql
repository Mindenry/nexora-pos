-- 0009 inserted PromptPay defaults with a cross-tenant INSERT. Because every
-- tenant table is FORCE ROW LEVEL SECURITY, that statement saw no stores and
-- granted no role permissions when the migration ran. This follow-up performs
-- the same work one tenant at a time with the RLS context set.

DO $$
DECLARE
  s record;
BEGIN
  PERFORM set_config('app.platform_admin', 'on', true);
  FOR s IN SELECT id, tenant_id FROM stores LOOP
    PERFORM set_config('app.tenant_id', s.tenant_id::text, true);
    INSERT INTO payment_methods
      (tenant_id, store_id, code, name, type, requires_reference, opens_drawer, sort_order)
    VALUES (s.tenant_id, s.id, 'promptpay', 'พร้อมเพย์', 'qr', true, false, 25)
    ON CONFLICT (tenant_id, store_id, code) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.platform_admin', '', true);
  PERFORM set_config('app.tenant_id', '', true);
END $$;

DO $$
DECLARE
  t record;
  r record;
BEGIN
  PERFORM set_config('app.platform_admin', 'on', true);
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    FOR r IN
      SELECT id, code FROM roles
      WHERE tenant_id = t.id AND code IN ('owner', 'manager', 'cashier', 'accountant')
    LOOP
      INSERT INTO role_permissions (tenant_id, role_id, permission_code)
      SELECT t.id, r.id, p.code
      FROM permissions p
      WHERE p.code IN ('promptpay.accounts.read', 'promptpay.accounts.manage')
        AND (r.code IN ('owner', 'manager') OR p.code = 'promptpay.accounts.read')
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.platform_admin', '', true);
  PERFORM set_config('app.tenant_id', '', true);
END $$;
