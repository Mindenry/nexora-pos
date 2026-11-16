-- A fully completed sale is immutable in every later state (partially refunded,
-- refunded, voided). Previously the guard stopped applying once status moved away
-- from 'completed', which allowed money edits after a partial refund.
CREATE OR REPLACE FUNCTION guard_sale_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
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
