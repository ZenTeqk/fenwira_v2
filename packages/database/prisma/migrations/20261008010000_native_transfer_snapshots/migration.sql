-- A retry must use the original contact snapshot and destination, never a new payload.
CREATE FUNCTION public.fenwira_native_transfer_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.connection_id IS DISTINCT FROM OLD.connection_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.request IS DISTINCT FROM OLD.request
     OR (OLD.snapshot_ciphertext IS NOT NULL AND NEW.snapshot_ciphertext IS DISTINCT FROM OLD.snapshot_ciphertext)
     OR (OLD.status = 'SUCCEEDED' AND NEW.status <> 'SUCCEEDED') THEN
    RAISE EXCEPTION 'native transfer identity, destination and snapshot are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER native_transfer_immutable BEFORE UPDATE ON public.native_transfers
FOR EACH ROW EXECUTE FUNCTION public.fenwira_native_transfer_immutable();
