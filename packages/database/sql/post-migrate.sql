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

-- tenants: the tenant root has no tenant_id column, so it gets its own policies. Writes only to
-- the bound tenant; reads also allow tenants the current user is an ACTIVE member of (the tenant
-- list before a tenant is chosen, docs/MULTI_TENANCY.md X1). Split per command so that membership
-- never grants UPDATE/DELETE on another tenant row.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.tenants'::regclass AND polname = 'tenant_self') THEN
    CREATE POLICY tenant_self ON public.tenants
      USING      (id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.tenants'::regclass AND polname = 'tenant_member_read') THEN
    CREATE POLICY tenant_member_read ON public.tenants FOR SELECT
      USING (id IN (SELECT m.tenant_id FROM public.memberships m
                    WHERE m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
                      AND m.status = 'ACTIVE'));
  END IF;
  -- memberships: standard tenant_isolation (auto-applied above) + a user may read their own rows.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.memberships'::regclass AND polname = 'membership_self_read') THEN
    CREATE POLICY membership_self_read ON public.memberships FOR SELECT
      USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
  END IF;
END $$;

-- Invariants Prisma cannot express.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_active_owner
  ON public.memberships (tenant_id) WHERE role = 'OWNER' AND status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS invitations_one_pending_per_email
  ON public.invitations (tenant_id, email) WHERE status = 'PENDING';
-- Phase 4: one tenant per live phone number (a DISCONNECTED number may be connected elsewhere),
-- one default number per tenant, one live credential per WABA.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_phone_numbers_active_number_unique
  ON public.whatsapp_phone_numbers (phone_number_id) WHERE status <> 'DISCONNECTED';
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_phone_numbers_one_default
  ON public.whatsapp_phone_numbers (tenant_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS meta_credentials_one_live_per_waba
  ON public.meta_credentials (waba_id) WHERE status IN ('VALID', 'EXPIRING');
-- Re-entry AFTER_COMPLETION (docs/AUTOMATION_ENGINE.md): one active execution per flow and
-- conversation, or per flow and contact when there is no conversation (contact/webhook triggers).
CREATE UNIQUE INDEX IF NOT EXISTS automation_executions_one_active_conversation
  ON public.automation_executions (flow_id, conversation_id)
  WHERE status IN ('RUNNING', 'WAITING') AND conversation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS automation_executions_one_active_contact
  ON public.automation_executions (flow_id, contact_id)
  WHERE status IN ('RUNNING', 'WAITING') AND conversation_id IS NULL;
-- One live template per (WABA, name, language), like Meta (docs/DATABASE.md → Templates).
CREATE UNIQUE INDEX IF NOT EXISTS templates_live_identity
  ON public.templates (tenant_id, waba_id, name, language) WHERE deleted_at IS NULL;
-- Phase 5: one live contact per phone, one message per Meta id, one message per idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_live_per_phone
  ON public.contacts (tenant_id, phone_e164) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_unique
  ON public.messages (tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_unique
  ON public.messages (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Phase 6: contact search (CONTAINS on name/phone/email uses ILIKE) and one open segment name.
CREATE INDEX IF NOT EXISTS contacts_name_trgm ON public.contacts USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_phone_trgm ON public.contacts USING gin (phone_e164 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_email_trgm ON public.contacts USING gin ((email::text) gin_trgm_ops);

-- Phase 7: inbox search. Full-text over message text and captions ('simple' config: no
-- stemming, works across languages). Generated, so Prisma never writes it.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS text_search tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(content->>'text', '') || ' ' || coalesce(content->>'caption', ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS messages_text_search_idx ON public.messages USING gin (text_search);

-- Outbound status ordering (docs/MESSAGING_ENGINE.md): a status applies only when its rank is
-- higher than the current one. FAILED and RECEIVED sit outside the ladder.
CREATE OR REPLACE FUNCTION public.fenwira_message_status_rank(s public.message_status)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'CREATED' THEN 0 WHEN 'QUEUED' THEN 1 WHEN 'SENDING' THEN 2
    WHEN 'SENT' THEN 3 WHEN 'DELIVERED' THEN 4 WHEN 'READ' THEN 5
    ELSE -1 END;
$$;

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
    'audit_logs', 'security_events', 'contact_activities', 'automation_execution_steps',
    'wallet_transactions', 'usage_events', 'analytics_events'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM fenwira_app', t);
    END IF;
  END LOOP;
END $$;

-- Global reference tables are seeded by the migrate step (from @fenwira/contracts) and read-only
-- at runtime (docs/MULTI_TENANCY.md → Table classes).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.roles, public.permissions, public.role_permissions FROM fenwira_app;

-- Price book (decisions B1, P9-D2: configuration, never code). DEVELOPMENT PLACEHOLDERS, flagged
-- as such: final commercial pricing, markup and tax are set in Phase 11 by changing rows.
INSERT INTO public.price_book_entries
  (id, category, country, currency, customer_price_minor, provider_cost_minor, markup_bps, is_placeholder, note)
SELECT gen_random_uuid(), v.category, NULL, 'INR', v.price, NULL, 0, true,
       'Development placeholder, not commercial pricing (P9-D2).'
FROM (VALUES ('MARKETING', 88), ('UTILITY', 13), ('AUTHENTICATION', 13), ('SERVICE', 0)) AS v(category, price)
WHERE NOT EXISTS (
  SELECT 1 FROM public.price_book_entries p WHERE p.category = v.category AND p.country IS NULL
);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.price_book_entries FROM fenwira_app;

-- Plans (Phase 11 Step 4): global configuration, seeded by the migrate step, read-only at runtime.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.plans, public.plan_entitlements, public.plan_prices FROM fenwira_app;

-- Wallet ledger → balance cache (docs/BILLING.md → Wallet): the only writer of balance_minor.
CREATE OR REPLACE FUNCTION public.fenwira_wallet_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.wallets SET balance_minor = NEW.balance_after_minor, updated_at = now()
  WHERE id = NEW.wallet_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wallet_transactions_apply ON public.wallet_transactions;
CREATE TRIGGER wallet_transactions_apply AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fenwira_wallet_apply();

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

-- X6: invitation acceptance. Resolves the SHA-256 of a 256-bit token to IDs only; the caller then
-- re-enters withTenant(tenant_id) for everything else.
GRANT SELECT (id, tenant_id, token_hash, status) ON public.invitations TO fenwira_system;
CREATE OR REPLACE FUNCTION system.resolve_invitation(p_token_hash bytea)
RETURNS TABLE (tenant_id uuid, invitation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.tenant_id, i.id FROM public.invitations i WHERE i.token_hash = p_token_hash LIMIT 1;
$$;

-- X11: phone number uniqueness at connect. Answers only "is this number live in another tenant",
-- never which one. The partial unique index is the real guarantee; this gives a clean 409 first.
GRANT SELECT (tenant_id, phone_number_id, status) ON public.whatsapp_phone_numbers TO fenwira_system;
CREATE OR REPLACE FUNCTION system.phone_number_owner_exists(p_phone_number_id text, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_phone_numbers p
    WHERE p.phone_number_id = p_phone_number_id AND p.tenant_id <> p_tenant_id
      AND p.status <> 'DISCONNECTED'
  );
$$;

-- X5: phone number sync fan-out. IDs only; each sync job re-enters withTenant(tenant_id).
GRANT SELECT (id, tenant_id, status, last_synced_at) ON public.whatsapp_phone_numbers TO fenwira_system;
CREATE OR REPLACE FUNCTION system.phone_numbers_due_for_sync(p_older_than timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid, phone_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.tenant_id, p.id FROM public.whatsapp_phone_numbers p
  WHERE p.status <> 'DISCONNECTED' AND p.status <> 'PENDING'
    AND (p.last_synced_at IS NULL OR p.last_synced_at < p_older_than)
  ORDER BY p.last_synced_at NULLS FIRST
  LIMIT p_limit;
$$;

-- X14: template sync fan-out (docs/TEMPLATE_ENGINE.md → Sync from Meta). IDs only; each WABA's
-- sync re-enters withTenant.
GRANT SELECT (id, tenant_id, status, templates_synced_at) ON public.whatsapp_business_accounts TO fenwira_system;
CREATE OR REPLACE FUNCTION system.wabas_due_for_template_sync(p_older_than timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid, waba_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT w.tenant_id, w.id FROM public.whatsapp_business_accounts w
  WHERE w.status IN ('ACTIVE', 'RESTRICTED')
    AND (w.templates_synced_at IS NULL OR w.templates_synced_at < p_older_than)
  ORDER BY w.templates_synced_at NULLS FIRST
  LIMIT p_limit;
$$;

-- X4: due scheduled campaigns (docs/CAMPAIGN_ENGINE.md → Scheduling). IDs only; the transition
-- SCHEDULED → PREPARING is a conditional update inside withTenant, so two schedulers can't both win.
GRANT SELECT (id, tenant_id, status, schedule_at, deleted_at) ON public.campaigns TO fenwira_system;
CREATE OR REPLACE FUNCTION system.due_scheduled_campaigns(p_now timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid, campaign_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.tenant_id, c.id FROM public.campaigns c
  WHERE c.status = 'SCHEDULED' AND c.schedule_at <= p_now AND c.deleted_at IS NULL
  ORDER BY c.schedule_at
  LIMIT p_limit;
$$;

-- X15: campaigns with work in flight (crash recovery, completion). IDs and status only.
CREATE OR REPLACE FUNCTION system.active_campaigns(p_limit integer)
RETURNS TABLE (tenant_id uuid, campaign_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.tenant_id, c.id, c.status::text FROM public.campaigns c
  WHERE c.status IN ('PREPARING', 'RUNNING') AND c.deleted_at IS NULL
  ORDER BY c.id
  LIMIT p_limit;
$$;

-- X8: automation inbound webhook → (tenant, flow). The token is 256-bit; only its hash is stored.
GRANT SELECT (id, tenant_id, status, webhook_token_hash, deleted_at) ON public.flows TO fenwira_system;
CREATE OR REPLACE FUNCTION system.resolve_flow_webhook(p_token_hash bytea)
RETURNS TABLE (tenant_id uuid, flow_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT f.tenant_id, f.id FROM public.flows f
  WHERE f.webhook_token_hash = p_token_hash AND f.deleted_at IS NULL
  LIMIT 1;
$$;

-- X16: automation recovery (Redis lost a delayed job, or a worker died mid-run). IDs only.
GRANT SELECT (id, tenant_id, status, wait_until, updated_at) ON public.automation_executions TO fenwira_system;
CREATE OR REPLACE FUNCTION system.due_automation_executions(p_now timestamptz, p_stale timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid, execution_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT e.tenant_id, e.id FROM public.automation_executions e
  WHERE (e.status = 'WAITING' AND e.wait_until <= p_now)
     OR (e.status = 'RUNNING' AND e.updated_at < p_stale)
  ORDER BY e.id
  LIMIT p_limit;
$$;

-- X2: webhook tenant resolution. Called only after the platform HMAC is verified; returns IDs of
-- the live number (or, for WABA-level events, of the WABA's tenant) and nothing else.
GRANT SELECT (id, tenant_id, phone_number_id, status) ON public.whatsapp_phone_numbers TO fenwira_system;
GRANT SELECT (id, tenant_id, waba_id, status) ON public.whatsapp_business_accounts TO fenwira_system;
CREATE OR REPLACE FUNCTION system.resolve_tenant_by_phone_number_id(p_phone_number_id text)
RETURNS TABLE (tenant_id uuid, phone_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.tenant_id, p.id FROM public.whatsapp_phone_numbers p
  WHERE p.phone_number_id = p_phone_number_id AND p.status <> 'DISCONNECTED'
  LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION system.resolve_tenant_by_waba_id(p_waba_id text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT w.tenant_id FROM public.whatsapp_business_accounts w
  WHERE w.waba_id = p_waba_id AND w.status <> 'DISCONNECTED'
  LIMIT 1;
$$;

-- X13: inbox maintenance. Conversations whose snooze ended (→ OPEN) or whose takeover should be
-- released (RESOLVED, tenant opted in, no agent message for N hours). IDs only; the job re-enters
-- withTenant for each.
GRANT SELECT (id, tenant_id, status, snoozed_until, automation_state, updated_at)
  ON public.conversations TO fenwira_system;
GRANT SELECT (id, takeover_auto_release_hours) ON public.tenants TO fenwira_system;
GRANT SELECT (conversation_id, source, created_at) ON public.messages TO fenwira_system;
CREATE OR REPLACE FUNCTION system.inbox_maintenance_due(p_now timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid, conversation_id uuid, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  (SELECT c.tenant_id, c.id, 'UNSNOOZE'::text FROM public.conversations c
    WHERE c.status = 'SNOOZED' AND c.snoozed_until IS NOT NULL AND c.snoozed_until <= p_now
    LIMIT p_limit)
  UNION ALL
  (SELECT c.tenant_id, c.id, 'RELEASE_TAKEOVER'::text FROM public.conversations c
    JOIN public.tenants t ON t.id = c.tenant_id
    WHERE c.automation_state = 'AGENT_TAKEOVER' AND c.status = 'RESOLVED'
      AND t.takeover_auto_release_hours IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.conversation_id = c.id AND m.source = 'INBOX'
          AND m.created_at > p_now - make_interval(hours => t.takeover_auto_release_hours))
    LIMIT p_limit);
$$;

-- X17: stale-reservation recovery (docs/BILLING.md → Reservations). ACTIVE reservations older
-- than p_older_than whose message is final (FAILED, or SENT/DELIVERED/READ, when Meta's pricing
-- normally arrives) or missing. IDs only; recovery re-enters withTenant and re-checks.
GRANT SELECT (id, tenant_id, message_id, status, created_at) ON public.wallet_reservations TO fenwira_system;
GRANT SELECT (id, status) ON public.messages TO fenwira_system;
CREATE OR REPLACE FUNCTION system.stale_reservations(p_older_than timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid, message_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.tenant_id, r.message_id FROM public.wallet_reservations r
  LEFT JOIN public.messages m ON m.id = r.message_id
  WHERE r.status = 'ACTIVE' AND r.created_at < p_older_than
    AND (m.id IS NULL OR m.status IN ('FAILED', 'SENT', 'DELIVERED', 'READ'))
  ORDER BY r.created_at
  LIMIT p_limit;
$$;

-- X18: daily ledger check (docs/BILLING.md → Wallet). Wallets whose cached balance differs from
-- the ledger sum, or whose cached holds differ from their ACTIVE reservations. IDs only; the
-- check re-enters withTenant for the figures. Never corrects anything.
GRANT SELECT (id, tenant_id, balance_minor, reserved_minor) ON public.wallets TO fenwira_system;
GRANT SELECT (wallet_id, amount_minor) ON public.wallet_transactions TO fenwira_system;
GRANT SELECT (wallet_id, status, amount_minor) ON public.wallet_reservations TO fenwira_system;
CREATE OR REPLACE FUNCTION system.wallet_ledger_drift(p_limit integer)
RETURNS TABLE (tenant_id uuid, wallet_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT w.tenant_id, w.id FROM public.wallets w
  WHERE w.balance_minor <> COALESCE(
          (SELECT sum(t.amount_minor) FROM public.wallet_transactions t WHERE t.wallet_id = w.id), 0)
     OR w.reserved_minor <> COALESCE(
          (SELECT sum(r.amount_minor) FROM public.wallet_reservations r
            WHERE r.wallet_id = w.id AND r.status = 'ACTIVE'), 0)
  ORDER BY w.id
  LIMIT p_limit;
$$;

-- X10: analytics work fan-out (docs/ANALYTICS.md). Workspaces with pending recompute marks, or
-- with analytics activity since p_since. IDs only; each rollup re-enters withTenant.
GRANT SELECT (tenant_id) ON public.analytics_dirty TO fenwira_system;
GRANT SELECT (tenant_id, last_event_at) ON public.analytics_tenant_state TO fenwira_system;
CREATE OR REPLACE FUNCTION system.tenants_with_activity(p_since timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT x.tenant_id FROM (
    SELECT d.tenant_id FROM public.analytics_dirty d
    UNION
    SELECT s.tenant_id FROM public.analytics_tenant_state s WHERE s.last_event_at >= p_since
  ) x
  ORDER BY x.tenant_id
  LIMIT p_limit;
$$;

-- X9 (analytics part): analytics retention for one workspace (P11-D15). analytics_events is
-- append-only for the runtime role, so the purge runs here: by age only, for that workspace only,
-- returning a count. Nothing else (ledger, audit, messages) is reachable through it.
GRANT SELECT (tenant_id, occurred_at), DELETE ON public.analytics_events TO fenwira_system;
CREATE OR REPLACE FUNCTION system.purge_analytics_events(p_tenant_id uuid, p_before timestamptz)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH d AS (
    DELETE FROM public.analytics_events
    WHERE tenant_id = p_tenant_id AND occurred_at < p_before
    RETURNING 1
  )
  SELECT count(*)::integer FROM d;
$$;

-- X7: API key authentication (docs/API_KEYS.md). The hash is verified in app code with a
-- constant-time compare against a server-side pepper; this function never touches the secret.
-- `prefix` is granted too even though it isn't returned: it's referenced in the WHERE clause, and
-- column-level privileges cover every column a query touches, not only the ones it selects out.
GRANT SELECT (id, tenant_id, key_hash, scopes, revoked_at, expires_at, prefix)
  ON public.api_keys TO fenwira_system;
CREATE OR REPLACE FUNCTION system.resolve_api_key(p_prefix text)
RETURNS TABLE (tenant_id uuid, api_key_id uuid, key_hash bytea, scopes text[],
               revoked_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT k.tenant_id, k.id, k.key_hash, k.scopes, k.revoked_at, k.expires_at
  FROM public.api_keys k WHERE k.prefix = p_prefix
  LIMIT 1;
$$;

-- Webhook delivery retention (docs/WEBHOOKS.md → Retention, 30 days): which workspaces have
-- deliveries older than the cutoff, then a tenant-scoped, age-only purge for each.
GRANT SELECT (tenant_id, created_at), DELETE ON public.webhook_deliveries TO fenwira_system;
CREATE OR REPLACE FUNCTION system.tenants_with_stale_webhook_deliveries(p_before timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT DISTINCT d.tenant_id FROM public.webhook_deliveries d
  WHERE d.created_at < p_before
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION system.purge_webhook_deliveries(p_tenant_id uuid, p_before timestamptz)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH d AS (
    DELETE FROM public.webhook_deliveries
    WHERE tenant_id = p_tenant_id AND created_at < p_before
    RETURNING 1
  )
  SELECT count(*)::integer FROM d;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'system.emit_platform_event(text, jsonb, text)',
    'system.claim_outbox_events(integer, integer)',
    'system.mark_outbox_dispatched(uuid[])',
    'system.mark_outbox_retry(uuid, text, integer)',
    'system.resolve_invitation(bytea)',
    'system.phone_number_owner_exists(text, uuid)',
    'system.phone_numbers_due_for_sync(timestamptz, integer)',
    'system.resolve_tenant_by_phone_number_id(text)',
    'system.resolve_tenant_by_waba_id(text)',
    'system.inbox_maintenance_due(timestamptz, integer)',
    'system.wabas_due_for_template_sync(timestamptz, integer)',
    'system.due_scheduled_campaigns(timestamptz, integer)',
    'system.active_campaigns(integer)',
    'system.resolve_flow_webhook(bytea)',
    'system.due_automation_executions(timestamptz, timestamptz, integer)',
    'system.stale_reservations(timestamptz, integer)',
    'system.wallet_ledger_drift(integer)',
    'system.tenants_with_activity(timestamptz, integer)',
    'system.purge_analytics_events(uuid, timestamptz)',
    'system.resolve_api_key(text)',
    'system.purge_webhook_deliveries(uuid, timestamptz)',
    'system.tenants_with_stale_webhook_deliveries(timestamptz, integer)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO fenwira_system', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO fenwira_app', f);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA system TO fenwira_app;
