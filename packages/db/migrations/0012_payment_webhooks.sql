-- Automatic settlement adapter boundary. A webhook provider is a real bank/PSP
-- integration: the POS cannot verify incoming funds without one. Manual
-- confirmation remains the default. `payment_transactions.verified_by` becomes
-- nullable because a signed provider event has no staff actor.

ALTER TABLE payment_transactions ALTER COLUMN verified_by DROP NOT NULL;

CREATE TABLE payment_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'generic_webhook'
    CHECK (provider IN ('generic_webhook')),
  display_name text NOT NULL DEFAULT 'Webhook provider',
  public_id text NOT NULL,
  secret_encrypted text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  auto_confirm boolean NOT NULL DEFAULT true,
  last_event_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (public_id)
);
CREATE UNIQUE INDEX payment_provider_configs_tenant_wide
  ON payment_provider_configs (tenant_id, provider)
  WHERE store_id IS NULL;
CREATE UNIQUE INDEX payment_provider_configs_per_store
  ON payment_provider_configs (tenant_id, store_id, provider)
  WHERE store_id IS NOT NULL;

CREATE TABLE payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  config_id uuid NOT NULL REFERENCES payment_provider_configs(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  session_id uuid REFERENCES payment_sessions(id) ON DELETE SET NULL,
  status text NOT NULL
    CHECK (status IN ('processed', 'already_paid', 'ignored', 'rejected')),
  reason text NOT NULL DEFAULT '',
  amount_satang bigint,
  reference text NOT NULL DEFAULT '',
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (config_id, event_id)
);
CREATE INDEX payment_webhook_events_config_idx
  ON payment_webhook_events (tenant_id, config_id, created_at DESC);

INSERT INTO permissions (code, module, label_th, label_en) VALUES
  ('promptpay.providers.manage', 'promptpay', 'จัดการการตรวจรับเงินอัตโนมัติ', 'Manage automatic settlement')
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module, label_th = EXCLUDED.label_th, label_en = EXCLUDED.label_en;

DO $$
DECLARE
  t record;
BEGIN
  PERFORM set_config('app.platform_admin', 'on', true);
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    INSERT INTO role_permissions (tenant_id, role_id, permission_code)
    SELECT t.id, r.id, 'promptpay.providers.manage'
    FROM roles r
    WHERE r.tenant_id = t.id AND r.code IN ('owner', 'manager')
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.platform_admin', '', true);
  PERFORM set_config('app.tenant_id', '', true);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_provider_configs', 'payment_webhook_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.platform_admin', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $f$, t);
  END LOOP;
  CREATE TRIGGER payment_provider_configs_updated_at
    BEFORE UPDATE ON payment_provider_configs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
END $$;
