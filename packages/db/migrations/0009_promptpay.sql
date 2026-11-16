-- ── PromptPay accounts, sessions, verification and audit ────────────────────
-- Identifiers are never stored in plaintext. `encrypted_identifier` holds
-- AES-256-GCM ciphertext; `identifier_hash` is an HMAC used only for duplicate
-- detection; `masked_identifier` is the only value ever returned to clients.

CREATE TABLE promptpay_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (identifier_type IN ('mobile', 'national_id')),
  encrypted_identifier text NOT NULL,
  identifier_hash text NOT NULL,
  masked_identifier text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX promptpay_accounts_identifier_unique
  ON promptpay_accounts (tenant_id, identifier_hash)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX promptpay_accounts_one_default
  ON promptpay_accounts (tenant_id)
  WHERE is_default AND is_active AND deleted_at IS NULL;
CREATE INDEX promptpay_accounts_tenant_idx
  ON promptpay_accounts (tenant_id, is_active, display_name);

CREATE TABLE payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  account_id uuid NOT NULL REFERENCES promptpay_accounts(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  reference text NOT NULL,
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
  payload_hash text NOT NULL,
  payload_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'failed', 'refunded')),
  expires_at timestamptz NOT NULL,
  account_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id),
  failure_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference)
);
CREATE UNIQUE INDEX payment_sessions_one_open_per_operation
  ON payment_sessions (tenant_id, operation_id)
  WHERE status = 'pending';
CREATE UNIQUE INDEX payment_sessions_one_sale
  ON payment_sessions (tenant_id, sale_id)
  WHERE sale_id IS NOT NULL;
CREATE INDEX payment_sessions_store_time_idx
  ON payment_sessions (tenant_id, store_id, created_at DESC);
CREATE INDEX payment_sessions_status_idx
  ON payment_sessions (tenant_id, store_id, status, created_at DESC);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_session_id uuid NOT NULL REFERENCES payment_sessions(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  payment_method text NOT NULL DEFAULT 'promptpay',
  verification_method text NOT NULL DEFAULT 'manual'
    CHECK (verification_method IN ('manual', 'provider_webhook', 'slip_verification', 'statement_import')),
  verified_by uuid NOT NULL REFERENCES users(id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'voided', 'refunded')),
  reference text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT 'manual',
  provider_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_session_id)
);
CREATE INDEX payment_transactions_sale_idx
  ON payment_transactions (tenant_id, sale_id);
CREATE INDEX payment_transactions_verifier_idx
  ON payment_transactions (tenant_id, verified_by, verified_at DESC);

CREATE TABLE payment_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_session_id uuid NOT NULL REFERENCES payment_sessions(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid REFERENCES users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_audit_logs_session_idx
  ON payment_audit_logs (tenant_id, payment_session_id, created_at);

-- The sale-level payment row can point at the verified PromptPay session. The
-- partial unique index makes double-spending one QR impossible.
ALTER TABLE payments
  ADD COLUMN promptpay_session_id uuid REFERENCES payment_sessions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX payments_promptpay_session_unique
  ON payments (promptpay_session_id)
  WHERE promptpay_session_id IS NOT NULL;

-- Every store gets a PromptPay tender. Existing stores only; fresh databases
-- receive the same row from the seed.
INSERT INTO payment_methods
  (tenant_id, store_id, code, name, type, requires_reference, opens_drawer, sort_order)
SELECT tenant_id, id, 'promptpay', 'พร้อมเพย์', 'qr', true, false, 25
FROM stores
ON CONFLICT (tenant_id, store_id, code) DO NOTHING;

-- New permission catalogue entries.
INSERT INTO permissions (code, module, label_th, label_en) VALUES
  ('promptpay.accounts.read', 'promptpay', 'ดูบัญชีพร้อมเพย์', 'View PromptPay accounts'),
  ('promptpay.accounts.manage', 'promptpay', 'จัดการบัญชีพร้อมเพย์', 'Manage PromptPay accounts')
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module, label_th = EXCLUDED.label_th, label_en = EXCLUDED.label_en;

-- Existing tenants: owners/managers manage accounts, cashiers/accountants may
-- read the masked list. A cashier can confirm money receipt because they hold
-- payments.confirm, but cannot change receiving accounts.
INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM roles r
JOIN permissions p ON p.code IN ('promptpay.accounts.read', 'promptpay.accounts.manage')
WHERE r.code IN ('owner', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM roles r
JOIN permissions p ON p.code = 'promptpay.accounts.read'
WHERE r.code IN ('cashier', 'accountant')
ON CONFLICT DO NOTHING;

-- ── RLS and updated_at triggers ─────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'promptpay_accounts', 'payment_sessions', 'payment_transactions', 'payment_audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.platform_admin', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $f$, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['promptpay_accounts', 'payment_sessions'] LOOP
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
