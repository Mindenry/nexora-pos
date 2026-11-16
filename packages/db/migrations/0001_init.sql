-- NEXORA POS — initial schema
-- Money: BIGINT satang. Time: timestamptz (UTC) + business_date in store timezone.
-- Tenancy: tenant_id on every business row, FORCE RLS at the end of this file.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Shared helpers ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % rows cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- ── Platform ────────────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  price_satang bigint NOT NULL DEFAULT 0 CHECK (price_satang >= 0),
  interval text NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly', 'yearly')),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_stores integer NOT NULL DEFAULT 1 CHECK (max_stores > 0),
  max_employees integer NOT NULL DEFAULT 5 CHECK (max_employees > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE tenant_features (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, feature_key)
);

-- ── Identity ────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  locale text NOT NULL DEFAULT 'th' CHECK (locale IN ('th', 'en')),
  is_platform_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_tenant_idx ON users (tenant_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id, expires_at DESC);

CREATE TABLE permissions (
  code text PRIMARY KEY,
  module text NOT NULL,
  label_th text NOT NULL,
  label_en text NOT NULL
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_th text NOT NULL,
  name_en text NOT NULL,
  scope text NOT NULL DEFAULT 'assigned' CHECK (scope IN ('tenant', 'assigned')),
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE role_permissions (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  legal_name text NOT NULL DEFAULT '',
  tax_id text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'THB',
  timezone text NOT NULL DEFAULT 'Asia/Bangkok',
  vat_rate_bp integer NOT NULL DEFAULT 700 CHECK (vat_rate_bp >= 0 AND vat_rate_bp <= 5000),
  prices_include_tax boolean NOT NULL DEFAULT true,
  receipt_prefix text NOT NULL DEFAULT 'R',
  receipt_footer text NOT NULL DEFAULT '',
  loyalty_earn_per_baht integer NOT NULL DEFAULT 1 CHECK (loyalty_earn_per_baht >= 0),
  offline_cash_enabled boolean NOT NULL DEFAULT false,
  discount_limit_bp integer NOT NULL DEFAULT 2000 CHECK (discount_limit_bp >= 0 AND discount_limit_bp <= 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'Asia/Bangkok',
  tax_id text NOT NULL DEFAULT '',
  receipt_prefix text NOT NULL DEFAULT 'R',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX stores_tenant_idx ON stores (tenant_id, is_active);

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_code text NOT NULL DEFAULT '',
  display_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  default_store_id uuid REFERENCES stores(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  hired_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employees_tenant_idx ON employees (tenant_id, status);

CREATE TABLE employee_roles (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, role_id)
);

CREATE TABLE employee_stores (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, store_id)
);
CREATE INDEX employee_stores_store_idx ON employee_stores (tenant_id, store_id);

-- ── Audit & notifications ───────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid,
  actor_user_id uuid,
  actor_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_time_idx ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX audit_entity_idx ON audit_logs (tenant_id, entity_type, entity_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx ON notifications (tenant_id, read_at, created_at DESC);

-- ── Catalog ─────────────────────────────────────────────────────────────────
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_unique ON categories (tenant_id, lower(name));

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX brands_name_unique ON brands (tenant_id, lower(name));

CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'simple' CHECK (type IN ('simple', 'variable')),
  tax_rate_bp integer CHECK (tax_rate_bp >= 0 AND tax_rate_bp <= 5000),
  track_inventory boolean NOT NULL DEFAULT true,
  reorder_point integer NOT NULL DEFAULT 5 CHECK (reorder_point >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_tenant_status_idx ON products (tenant_id, status);
CREATE INDEX products_tenant_name_idx ON products (tenant_id, lower(name));

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  barcode text,
  price_satang bigint NOT NULL CHECK (price_satang >= 0),
  cost_satang bigint NOT NULL DEFAULT 0 CHECK (cost_satang >= 0),
  compare_at_satang bigint CHECK (compare_at_satang >= 0),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variants_product_idx ON product_variants (tenant_id, product_id);
CREATE UNIQUE INDEX variants_sku_unique ON product_variants (tenant_id, sku) WHERE sku IS NOT NULL AND sku <> '';
CREATE UNIQUE INDEX variants_barcode_unique ON product_variants (tenant_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';

CREATE TABLE product_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, barcode)
);

-- ── Suppliers & customers ───────────────────────────────────────────────────
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  tax_id text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_code_unique ON suppliers (tenant_id, code) WHERE code IS NOT NULL AND code <> '';

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  address text NOT NULL DEFAULT '',
  tax_id text NOT NULL DEFAULT '',
  birthday date,
  tier text NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'silver', 'gold', 'platinum')),
  consent_marketing boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  total_spent_satang bigint NOT NULL DEFAULT 0 CHECK (total_spent_satang >= 0),
  last_purchase_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX customers_phone_idx ON customers (tenant_id, phone);
CREATE INDEX customers_name_idx ON customers (tenant_id, lower(name));

CREATE TABLE loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id uuid,
  points_delta integer NOT NULL,
  type text NOT NULL CHECK (type IN ('earn', 'redeem', 'adjust', 'expire')),
  reason text NOT NULL DEFAULT '',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_customer_idx ON loyalty_ledger (tenant_id, customer_id, created_at DESC);

-- ── Inventory ledger ────────────────────────────────────────────────────────
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  type text NOT NULL CHECK (type IN (
    'purchase_receipt', 'sales_deduction', 'sales_return', 'purchase_return',
    'transfer_out', 'transfer_in', 'adjustment_increase', 'adjustment_decrease',
    'stock_count', 'initial_load'
  )),
  qty_delta integer NOT NULL,
  unit_cost_satang bigint NOT NULL DEFAULT 0 CHECK (unit_cost_satang >= 0),
  reference_type text,
  reference_id uuid,
  reason text NOT NULL DEFAULT '',
  reverses_id uuid REFERENCES inventory_movements(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movements_stock_idx ON inventory_movements (tenant_id, store_id, variant_id, created_at DESC);
CREATE INDEX movements_variant_idx ON inventory_movements (tenant_id, variant_id, created_at DESC);
CREATE INDEX movements_reference_idx ON inventory_movements (tenant_id, reference_type, reference_id);

CREATE VIEW v_stock_on_hand WITH (security_invoker = true) AS
SELECT tenant_id, store_id, variant_id, sum(qty_delta)::bigint AS on_hand
FROM inventory_movements
GROUP BY tenant_id, store_id, variant_id;

CREATE TABLE stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_store_id uuid NOT NULL REFERENCES stores(id),
  to_store_id uuid NOT NULL REFERENCES stores(id),
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'dispatched', 'received', 'cancelled')),
  note text NOT NULL DEFAULT '',
  created_by uuid,
  dispatched_by uuid,
  dispatched_at timestamptz,
  received_by uuid,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_store_id <> to_store_id),
  UNIQUE (tenant_id, number)
);

CREATE TABLE stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  qty integer NOT NULL CHECK (qty > 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0)
);

-- ── Purchasing ──────────────────────────────────────────────────────────────
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'partially_received', 'received', 'closed', 'cancelled')),
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_date date,
  notes text NOT NULL DEFAULT '',
  subtotal_satang bigint NOT NULL DEFAULT 0 CHECK (subtotal_satang >= 0),
  tax_satang bigint NOT NULL DEFAULT 0 CHECK (tax_satang >= 0),
  total_satang bigint NOT NULL DEFAULT 0 CHECK (total_satang >= 0),
  created_by uuid,
  submitted_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE INDEX purchase_status_idx ON purchase_orders (tenant_id, store_id, status, created_at DESC);

CREATE TABLE purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL DEFAULT '',
  qty_ordered integer NOT NULL CHECK (qty_ordered > 0),
  qty_received integer NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost_satang bigint NOT NULL CHECK (unit_cost_satang >= 0),
  line_total_satang bigint NOT NULL CHECK (line_total_satang >= 0)
);

CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  number text NOT NULL,
  received_by uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE TABLE goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_item_id uuid NOT NULL REFERENCES purchase_order_items(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  qty integer NOT NULL CHECK (qty > 0),
  unit_cost_satang bigint NOT NULL CHECK (unit_cost_satang >= 0)
);

CREATE TABLE supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_order_id uuid REFERENCES purchase_orders(id),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  method text NOT NULL DEFAULT 'transfer',
  reference text NOT NULL DEFAULT '',
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Promotions ──────────────────────────────────────────────────────────────
CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  kind text NOT NULL CHECK (kind IN ('order_percent', 'order_amount', 'product_percent', 'category_percent')),
  value_bp integer CHECK (value_bp >= 0 AND value_bp <= 10000),
  value_satang bigint CHECK (value_satang >= 0),
  target_ids uuid[] NOT NULL DEFAULT '{}',
  min_subtotal_satang bigint NOT NULL DEFAULT 0 CHECK (min_subtotal_satang >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer CHECK (usage_limit >= 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  stackable boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  coupon_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX promotions_code_unique ON promotions (tenant_id, upper(code)) WHERE code IS NOT NULL AND code <> '';

CREATE TABLE promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  sale_id uuid NOT NULL,
  amount_satang bigint NOT NULL CHECK (amount_satang >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, sale_id)
);

-- ── Payments configuration ──────────────────────────────────────────────────
CREATE TABLE payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('cash', 'card', 'qr', 'transfer', 'other')),
  requires_reference boolean NOT NULL DEFAULT false,
  opens_drawer boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, code)
);

-- ── Shifts & cash ───────────────────────────────────────────────────────────
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  terminal_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_cash_satang bigint NOT NULL DEFAULT 0 CHECK (opening_cash_satang >= 0),
  expected_cash_satang bigint,
  counted_cash_satang bigint CHECK (counted_cash_satang >= 0),
  variance_satang bigint,
  closing_note text NOT NULL DEFAULT '',
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shifts_one_open_per_employee ON shifts (tenant_id, store_id, employee_id) WHERE status = 'open';
CREATE INDEX shifts_store_idx ON shifts (tenant_id, store_id, status, opened_at DESC);

CREATE TABLE cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  shift_id uuid NOT NULL REFERENCES shifts(id),
  employee_id uuid,
  type text NOT NULL CHECK (type IN ('opening', 'cash_in', 'cash_out', 'safe_drop', 'sale_cash', 'refund_cash')),
  amount_satang bigint NOT NULL,
  reason text NOT NULL DEFAULT '',
  reference_type text,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_shift_idx ON cash_movements (tenant_id, shift_id, created_at);

-- ── Sales ───────────────────────────────────────────────────────────────────
CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  shift_id uuid NOT NULL REFERENCES shifts(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  customer_id uuid REFERENCES customers(id),
  number text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided', 'partially_refunded', 'refunded')),
  subtotal_satang bigint NOT NULL CHECK (subtotal_satang >= 0),
  discount_satang bigint NOT NULL DEFAULT 0 CHECK (discount_satang >= 0),
  tax_satang bigint NOT NULL DEFAULT 0 CHECK (tax_satang >= 0),
  total_satang bigint NOT NULL CHECK (total_satang >= 0),
  cost_satang bigint NOT NULL DEFAULT 0 CHECK (cost_satang >= 0),
  refunded_satang bigint NOT NULL DEFAULT 0 CHECK (refunded_satang >= 0),
  change_satang bigint NOT NULL DEFAULT 0 CHECK (change_satang >= 0),
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  business_date date NOT NULL,
  occurred_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  receipt_snapshot jsonb NOT NULL,
  operation_id uuid NOT NULL,
  device_id text,
  source text NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'offline')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_id),
  UNIQUE (tenant_id, store_id, number),
  CHECK (refunded_satang <= total_satang)
);
CREATE INDEX sales_store_date_idx ON sales (tenant_id, store_id, business_date DESC);
CREATE INDEX sales_customer_idx ON sales (tenant_id, customer_id, occurred_at DESC);
CREATE INDEX sales_employee_idx ON sales (tenant_id, employee_id, business_date DESC);

CREATE TABLE sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  product_name text NOT NULL,
  variant_name text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  qty integer NOT NULL CHECK (qty > 0),
  unit_price_satang bigint NOT NULL CHECK (unit_price_satang >= 0),
  unit_cost_satang bigint NOT NULL CHECK (unit_cost_satang >= 0),
  discount_satang bigint NOT NULL DEFAULT 0 CHECK (discount_satang >= 0),
  tax_rate_bp integer NOT NULL CHECK (tax_rate_bp >= 0),
  tax_satang bigint NOT NULL DEFAULT 0 CHECK (tax_satang >= 0),
  line_total_satang bigint NOT NULL CHECK (line_total_satang >= 0),
  cost_satang bigint NOT NULL CHECK (cost_satang >= 0),
  refunded_qty integer NOT NULL DEFAULT 0 CHECK (refunded_qty >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_qty <= qty)
);
CREATE INDEX sale_items_sale_idx ON sale_items (tenant_id, sale_id);
CREATE INDEX sale_items_variant_idx ON sale_items (tenant_id, variant_id, created_at DESC);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method text NOT NULL,
  method_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'authorized', 'paid', 'failed', 'cancelled', 'partially_refunded', 'refunded')),
  amount_satang bigint NOT NULL CHECK (amount_satang >= 0),
  tendered_satang bigint CHECK (tendered_satang >= 0),
  change_satang bigint NOT NULL DEFAULT 0 CHECK (change_satang >= 0),
  reference text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT 'manual',
  provider_ref text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_sale_idx ON payments (tenant_id, sale_id);
CREATE INDEX payments_status_idx ON payments (tenant_id, status, created_at DESC);

CREATE TABLE payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_payment_idx ON payment_events (tenant_id, payment_id, created_at);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  number text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  cost_satang bigint NOT NULL DEFAULT 0 CHECK (cost_satang >= 0),
  tax_satang bigint NOT NULL DEFAULT 0 CHECK (tax_satang >= 0),
  reason text NOT NULL,
  restock boolean NOT NULL DEFAULT true,
  method text NOT NULL DEFAULT 'original',
  created_by uuid NOT NULL REFERENCES employees(id),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_id),
  UNIQUE (tenant_id, number)
);
CREATE INDEX refunds_sale_idx ON refunds (tenant_id, sale_id, created_at DESC);
CREATE INDEX refunds_store_idx ON refunds (tenant_id, store_id, created_at DESC);

CREATE TABLE refund_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  refund_id uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES sale_items(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  qty integer NOT NULL CHECK (qty > 0),
  amount_satang bigint NOT NULL CHECK (amount_satang >= 0),
  cost_satang bigint NOT NULL DEFAULT 0 CHECK (cost_satang >= 0)
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  number text NOT NULL,
  type text NOT NULL DEFAULT 'sale' CHECK (type IN ('sale', 'reprint')),
  snapshot jsonb NOT NULL,
  printed_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipts_sale_idx ON receipts (tenant_id, sale_id, created_at DESC);

CREATE TABLE held_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  label text NOT NULL DEFAULT '',
  cart jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX held_store_idx ON held_sales (tenant_id, store_id, created_at DESC);

-- ── Command safety ──────────────────────────────────────────────────────────
CREATE TABLE document_sequences (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  period text NOT NULL DEFAULT '',
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (tenant_id, store_id, doc_type, period)
);

CREATE OR REPLACE FUNCTION next_document_number(
  p_tenant uuid, p_store uuid, p_doc_type text, p_period text
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_next integer;
BEGIN
  INSERT INTO document_sequences (tenant_id, store_id, doc_type, period, next_number)
  VALUES (p_tenant, p_store, p_doc_type, p_period, 2)
  ON CONFLICT (tenant_id, store_id, doc_type, period)
  DO UPDATE SET next_number = document_sequences.next_number + 1
  RETURNING next_number - 1 INTO v_next;
  RETURN v_next;
END $$;

CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  scope text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('processing', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, operation_id)
);

-- ── Updated-at triggers ─────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','subscription_plans','subscriptions','users','businesses','stores','employees',
    'products','product_variants','suppliers','customers','purchase_orders','promotions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ── Append-only enforcement ─────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_movements','cash_movements','loyalty_ledger','payment_events','audit_logs'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_mutation()', t, t);
  END LOOP;
END $$;

-- Completed sales are immutable; only refund/void bookkeeping may change.
CREATE OR REPLACE FUNCTION guard_sale_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.subtotal_satang <> OLD.subtotal_satang
     OR NEW.discount_satang <> OLD.discount_satang
     OR NEW.tax_satang <> OLD.tax_satang
     OR NEW.total_satang <> OLD.total_satang
     OR NEW.cost_satang <> OLD.cost_satang
     OR NEW.number <> OLD.number
     OR NEW.business_date <> OLD.business_date
     OR NEW.occurred_at <> OLD.occurred_at
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.store_id <> OLD.store_id
     OR NEW.shift_id <> OLD.shift_id
     OR NEW.employee_id <> OLD.employee_id THEN
    RAISE EXCEPTION 'SALE_IMMUTABLE: completed sale money and identity are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.refunded_satang > OLD.total_satang THEN
    RAISE EXCEPTION 'REFUND_EXCEEDS_SALE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_immutable BEFORE UPDATE ON sales
FOR EACH ROW EXECUTE FUNCTION guard_sale_immutability();

CREATE OR REPLACE FUNCTION guard_sale_item_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.qty <> OLD.qty
     OR NEW.unit_price_satang <> OLD.unit_price_satang
     OR NEW.unit_cost_satang <> OLD.unit_cost_satang
     OR NEW.discount_satang <> OLD.discount_satang
     OR NEW.line_total_satang <> OLD.line_total_satang
     OR NEW.tax_satang <> OLD.tax_satang
     OR NEW.variant_id <> OLD.variant_id THEN
    RAISE EXCEPTION 'SALE_ITEM_IMMUTABLE: sold line content is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.refunded_qty > OLD.qty OR NEW.refunded_qty < OLD.refunded_qty THEN
    RAISE EXCEPTION 'REFUND_QTY_INVALID';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_items_immutable BEFORE UPDATE ON sale_items
FOR EACH ROW EXECUTE FUNCTION guard_sale_item_immutability();

-- ── Row-level security ──────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscriptions','tenant_features','roles','role_permissions','businesses','stores','employees',
    'employee_roles','employee_stores','notifications','categories','brands','units','products',
    'product_variants','product_barcodes','suppliers','customers','loyalty_ledger',
    'inventory_movements','stock_transfers','stock_transfer_items','purchase_orders',
    'purchase_order_items','goods_receipts','goods_receipt_items','supplier_payments','promotions',
    'promotion_redemptions','payment_methods','shifts','cash_movements','sales','sale_items',
    'payments','payment_events','refunds','refund_items','receipts','held_sales',
    'document_sequences','idempotency_keys'
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

  -- Audit rows may be platform-level (tenant null) and are read-only for tenant users.
  ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON audit_logs
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR tenant_id IS NULL
           OR current_setting('app.platform_admin', true) = 'on')
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR tenant_id IS NULL
           OR current_setting('app.platform_admin', true) = 'on');
END $$;

-- ── Permission catalogue ────────────────────────────────────────────────────
INSERT INTO permissions (code, module, label_th, label_en) VALUES
  ('products.read', 'products', 'ดูสินค้า', 'View products'),
  ('products.create', 'products', 'เพิ่มสินค้า', 'Create products'),
  ('products.update', 'products', 'แก้ไขสินค้า', 'Edit products'),
  ('products.delete', 'products', 'เก็บสินค้า', 'Archive products'),
  ('inventory.read', 'inventory', 'ดูสต๊อก', 'View inventory'),
  ('inventory.adjust', 'inventory', 'ปรับสต๊อก', 'Adjust stock'),
  ('inventory.transfer', 'inventory', 'โอนสินค้า', 'Transfer stock'),
  ('inventory.count', 'inventory', 'ตรวจนับสต๊อก', 'Count stock'),
  ('sales.read', 'sales', 'ดูยอดขาย', 'View sales'),
  ('sales.create', 'sales', 'ขายสินค้า', 'Create sales'),
  ('sales.cancel', 'sales', 'ยกเลิกการขาย', 'Void sales'),
  ('refunds.create', 'refunds', 'คืนสินค้า', 'Create refunds'),
  ('payments.read', 'payments', 'ดูการชำระเงิน', 'View payments'),
  ('payments.confirm', 'payments', 'ยืนยันการชำระเงิน', 'Confirm payments'),
  ('shifts.read', 'shifts', 'ดูกะ', 'View shifts'),
  ('shifts.open', 'shifts', 'เปิดกะ', 'Open shifts'),
  ('shifts.close', 'shifts', 'ปิดกะ', 'Close shifts'),
  ('shifts.cash', 'shifts', 'รับ/จ่ายเงินสด', 'Cash in/out'),
  ('customers.read', 'customers', 'ดูลูกค้า', 'View customers'),
  ('customers.manage', 'customers', 'จัดการลูกค้า', 'Manage customers'),
  ('promotions.manage', 'promotions', 'จัดการโปรโมชั่น', 'Manage promotions'),
  ('purchasing.read', 'purchasing', 'ดูใบสั่งซื้อ', 'View purchase orders'),
  ('purchasing.manage', 'purchasing', 'จัดการใบสั่งซื้อ', 'Manage purchase orders'),
  ('purchasing.approve', 'purchasing', 'อนุมัติใบสั่งซื้อ', 'Approve purchase orders'),
  ('suppliers.manage', 'suppliers', 'จัดการผู้จำหน่าย', 'Manage suppliers'),
  ('employees.manage', 'employees', 'จัดการพนักงาน', 'Manage employees'),
  ('reports.view', 'reports', 'ดูรายงาน', 'View reports'),
  ('reports.export', 'reports', 'ส่งออกรายงาน', 'Export reports'),
  ('settings.manage', 'settings', 'จัดการการตั้งค่า', 'Manage settings'),
  ('audit.view', 'audit', 'ดูประวัติการทำงาน', 'View audit log'),
  ('platform.manage', 'platform', 'จัดการแพลตฟอร์ม', 'Manage platform')
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, label_th = EXCLUDED.label_th, label_en = EXCLUDED.label_en;
