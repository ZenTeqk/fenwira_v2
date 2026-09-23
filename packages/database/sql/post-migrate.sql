-- Fenwira post-migrate SQL (ADR-0016). Idempotent: runs after every `prisma migrate deploy`,
-- as fenwira_owner. Holds everything Prisma cannot express: RLS policies, grants, partial
-- indexes, triggers and the system.* SECURITY DEFINER functions (docs/MULTI_TENANCY.md).

SET search_path = public;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- RFC 9562 UUIDv7 for rows created inside SQL (PG16 has no built-in uuidv7). App-created rows
-- use @fenwira/config uuidv7() / Prisma uuid(7); both sort by creation time (ADR-0017).
CREATE OR REPLACE FUNCTION public.fenwira_uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  b bytea := uuid_send(gen_random_uuid());
BEGIN
  b := overlay(b PLACING substring(int8send(unix_ms) FROM 3) FROM 1 FOR 6);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);  -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);  -- variant 10
  RETURN encode(b, 'hex')::uuid;
END $$;

-- Standard tenant isolation policy. Fail-closed: an unset or RESET GUC is NULL/'' -> no rows.
CREATE OR REPLACE FUNCTION public.fenwira_apply_tenant_policy(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = tbl AND polname = 'tenant_isolation') THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s
         USING      (tenant_id = nullif(current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      tbl);
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- RLS: every public table with a tenant_id column gets the standard policy automatically.
-- Special policies (tenants, memberships) are added below as their tables arrive (Phase 3).
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    PERFORM public.fenwira_apply_tenant_policy(t.tbl);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Grants for the runtime role (DML only, never DDL)
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO fenwira_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fenwira_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fenwira_app;
REVOKE ALL ON TABLE public._prisma_migrations FROM fenwira_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fenwira_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fenwira_app;

-- Append-only tables (docs/DATABASE.md "AO"): created in later phases; revoked when present.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_logs', 'contact_activities', 'automation_execution_steps',
    'wallet_transactions', 'usage_events', 'analytics_events'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM fenwira_app', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Outbox (ADR-0013)
-- ---------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON public.outbox_events (available_at, id) WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION public.fenwira_notify_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox_new', '');
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS outbox_events_notify ON public.outbox_events;
CREATE TRIGGER outbox_events_notify
  AFTER INSERT ON public.outbox_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.fenwira_notify_outbox();

-- ---------------------------------------------------------------------------------------------
-- system.* — the complete, audited set of cross-tenant code paths (docs/MULTI_TENANCY.md).
-- Owned by fenwira_system (NOLOGIN, BYPASSRLS, minimal grants); fenwira_app may only EXECUTE.
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO fenwira_system;
GRANT SELECT, INSERT, UPDATE ON public.outbox_events TO fenwira_system;

-- X12: tenant-less platform events (e.g. system.ping.requested). Tenant events never use this.
CREATE OR REPLACE FUNCTION system.emit_platform_event(
  p_event_type text, p_payload jsonb, p_correlation_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE new_id uuid := public.fenwira_uuid_v7();
BEGIN
  IF p_event_type !~ '^[a-z_]+(\.[a-z_]+)+$' THEN
    RAISE EXCEPTION 'invalid event type %', p_event_type USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.outbox_events (id, tenant_id, event_type, payload, correlation_id, status, attempts, available_at, created_at)
  VALUES (new_id, NULL, p_event_type, coalesce(p_payload, '{}'::jsonb), p_correlation_id, 'PENDING', 0, now(), now());
  RETURN new_id;
END $$;

-- X3: outbox relay claim. Leases rows (available_at = now + lease) so a crashed relay's
-- events become claimable again; SKIP LOCKED lets several relays run safely.
CREATE OR REPLACE FUNCTION system.claim_outbox_events(p_batch integer, p_lease_seconds integer)
RETURNS TABLE (
  id uuid, tenant_id uuid, event_type text, payload jsonb,
  correlation_id text, attempts integer, created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH picked AS (
    SELECT o.id
    FROM public.outbox_events o
    WHERE o.status = 'PENDING' AND o.available_at <= now()
    ORDER BY o.available_at, o.id
    LIMIT least(greatest(p_batch, 1), 1000)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_events o
     SET attempts = o.attempts + 1,
         available_at = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.id, o.tenant_id, o.event_type, o.payload, o.correlation_id, o.attempts, o.created_at;
$$;

CREATE OR REPLACE FUNCTION system.mark_outbox_dispatched(p_ids uuid[]) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH done AS (
    UPDATE public.outbox_events
       SET status = 'DISPATCHED', dispatched_at = now(), last_error = NULL
     WHERE id = ANY(p_ids) AND status = 'PENDING'
    RETURNING 1
  )
  SELECT count(*)::integer FROM done;
$$;

-- Backoff: 2^attempts seconds, capped at 5 minutes; FAILED after p_max_attempts.
-- Returns rows updated (0 or 1). An early version returned void, which Prisma cannot
-- deserialize; the return type cannot change in place, so drop that version first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'system' AND p.proname = 'mark_outbox_retry' AND p.prorettype = 'void'::regtype
  ) THEN
    DROP FUNCTION system.mark_outbox_retry(uuid, text, integer);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION system.mark_outbox_retry(p_id uuid, p_error text, p_max_attempts integer)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH retried AS (
    UPDATE public.outbox_events
       SET last_error = left(p_error, 1000),
           status = CASE WHEN attempts >= p_max_attempts THEN 'FAILED'::outbox_status ELSE 'PENDING'::outbox_status END,
           available_at = now() + make_interval(secs => least(power(2, attempts), 300))
     WHERE id = p_id AND status = 'PENDING'
    RETURNING 1
  )
  SELECT count(*)::integer FROM retried;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'system.emit_platform_event(text, jsonb, text)',
    'system.claim_outbox_events(integer, integer)',
    'system.mark_outbox_dispatched(uuid[])',
    'system.mark_outbox_retry(uuid, text, integer)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO fenwira_system', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO fenwira_app', f);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA system TO fenwira_app;
