-- Retention/offboarding purge mode.
-- Ledger rows stay append-only for normal traffic; a tenant deletion performed by
-- platform offboarding may remove them only when the server explicitly sets
-- app.allow_purge = 'on' inside the transaction. Updates are still forbidden.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'APPEND_ONLY: % rows cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;
