-- v1.1 additions discovered while wiring the application workflows.

ALTER TABLE tenants ADD COLUMN onboarded_at timestamptz;
ALTER TABLE tenants ADD COLUMN suspended_reason text;

ALTER TABLE businesses ADD COLUMN allow_negative_stock boolean NOT NULL DEFAULT false;

ALTER TABLE sales ADD COLUMN loyalty_points integer NOT NULL DEFAULT 0;
ALTER TABLE refunds ADD COLUMN receipt_snapshot jsonb;

-- Platform plans. Prices are integer satang per interval.
INSERT INTO subscription_plans (code, name, price_satang, interval, features, max_stores, max_employees)
VALUES
  ('starter', 'Starter', 0, 'monthly',
   '{"pos": true, "inventory": true, "reports_basic": true, "purchasing": false, "loyalty": false, "multi_store": false, "offline": false}'::jsonb,
   1, 5),
  ('growth', 'Growth', 99000, 'monthly',
   '{"pos": true, "inventory": true, "reports_basic": true, "purchasing": true, "loyalty": true, "multi_store": true, "offline": true}'::jsonb,
   5, 30),
  ('scale', 'Scale', 299000, 'monthly',
   '{"pos": true, "inventory": true, "reports_basic": true, "purchasing": true, "loyalty": true, "multi_store": true, "offline": true, "priority_support": true}'::jsonb,
   25, 250)
ON CONFLICT (code) DO NOTHING;
