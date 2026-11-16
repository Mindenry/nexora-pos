-- Loyalty redemption: points are a configured monetary value, captured on the sale.
ALTER TABLE businesses
  ADD COLUMN point_value_satang bigint NOT NULL DEFAULT 100 CHECK (point_value_satang >= 0);

ALTER TABLE businesses
  ADD COLUMN loyalty_redemption_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE sales
  ADD COLUMN points_redeemed integer NOT NULL DEFAULT 0 CHECK (points_redeemed >= 0);

ALTER TABLE sales
  ADD COLUMN points_discount_satang bigint NOT NULL DEFAULT 0 CHECK (points_discount_satang >= 0);
