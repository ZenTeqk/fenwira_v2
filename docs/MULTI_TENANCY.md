# Multi-Tenancy

## Scope

How tenant data is isolated. It covers the database roles, the RLS policy template, how application code binds tenant context, and the **complete** list of code paths that legitimately cross tenants. Any path not listed here is a bug.

## Decisions

### Model

- **Tenant** is the unit of isolation (UI label: *Workspace*).
- **User** is global. One user can belong to many tenants through `memberships` (one role per membership).
- Every row of tenant data has `tenant_id uuid NOT NULL REFERENCES tenants(id)`.
- Shared database, shared schema, and row-level isolation enforced by PostgreSQL RLS (ADR-0005, ADR-0011).

### Table classes

| Class | RLS | Examples |
| --- | --- | --- |
| **Tenant-owned** | Standard policy (below) | contacts, conversations, messages, campaigns, … (everything with `tenant_id`) |
| **Tenant root** | Custom policy | `tenants` |
| **Membership** | Standard policy + a user-visibility read clause | `memberships` |
| **Global identity** | No RLS; accessed only through `identity` module services | `users`, `sessions`, `email_verification_tokens`, `password_reset_tokens`, `two_factor_credentials` |
| **Global reference** | No RLS; read-only for `fenwira_app` | `roles`, `permissions`, `role_permissions`, `plans`, `plan_entitlements`, `price_book_entries` |

### Database roles

| Role | Attributes | Used by |
| --- | --- | --- |
| `postgres` | Superuser | Container init only |
| `fenwira_owner` | LOGIN, owns schema and tables, **not** superuser | `prisma migrate` (the `migrate` compose service) |
| `fenwira_app` | LOGIN, `NOSUPERUSER NOBYPASSRLS`, DML only (no DDL) | api and worker at runtime |
| `fenwira_system` | **NOLOGIN**, `BYPASSRLS`, table grants only where a `system.*` function needs them | Owner of the `system.*` SECURITY DEFINER functions. `fenwira_owner` is a member only so that post-migrate can assign that ownership. |

`FORCE ROW LEVEL SECURITY` is set on every RLS table, so even `fenwira_owner` is subject to the policies at runtime.

### Standard policy (applied to every tenant-owned table)

```sql
ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {t} FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON {t}
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
```

`nullif(..., '')` makes the policy **fail closed**. When no tenant is bound, or after `RESET`, the GUC is `NULL` or `''`, and the comparison yields no rows instead of raising a cast error.

The policy is applied by `public.fenwira_apply_tenant_policy(regclass)`. `packages/database/sql/post-migrate.sql` (run after every migration) **automatically applies it to every `public` table that has a `tenant_id` column**, so a new tenant table is protected even if its author forgets. The migrate step then runs the RLS coverage check and fails on any violation.

### Special policies

```sql
-- tenants: writes only to the bound tenant (tenant_self); reads also allow tenants the
-- current user is an ACTIVE member of (tenant_member_read). Split per command so that membership
-- never grants UPDATE/DELETE on another tenant row (tested in tenant-matrix.int.test.ts).
CREATE POLICY tenant_self ON tenants
  USING      (id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_member_read ON tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM memberships
                WHERE user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
                  AND status = 'ACTIVE'));

-- memberships: standard policy + let a user read their own memberships (tenant list before a tenant is chosen)
CREATE POLICY membership_self_read ON memberships FOR SELECT
  USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
```

Creating a tenant (at registration) binds the new tenant's ID before inserting, so the `WITH CHECK` passes.

### Append-only tables

`REVOKE UPDATE, DELETE, TRUNCATE` from `fenwira_app` on `audit_logs`, `security_events`, `contact_activities`, `automation_execution_steps`, `wallet_transactions`, `usage_events` and `analytics_events` (applied by post-migrate.sql as each table appears). `roles`, `permissions` and `role_permissions` are read-only for `fenwira_app`.

### Binding tenant context in application code

`packages/database` exports:

```ts
withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>, opts?: { userId?: string }): Promise<T>
withUser<T>(userId: string, fn: (tx: UserTx) => Promise<T>): Promise<T>   // only for listing the user's own memberships/tenants
withGlobal<T>(fn: (tx) => Promise<T>): Promise<T>                          // global tables only (users, sessions, tokens); tenant tables read empty
```

Implementation: a Prisma interactive transaction whose first statement is `SELECT set_config('app.current_tenant_id', $1, true), set_config('app.current_user_id', $2, true)`. The `true` flag gives transaction-local scope (the `SET LOCAL` semantics). This is safe with connection pooling because the setting dies with the transaction.

- The raw `PrismaClient` is exported only from `packages/database/internal`. An ESLint rule forbids importing it outside `packages/database` and the `system` gateway.
- A Prisma client extension also injects `tenant_id` into `create` calls and adds `where: { tenantId }` to queries. This is **defense in depth**; RLS remains the actual guarantee.
- Nest's request context (AsyncLocalStorage) holds `auth` and `tenant` (`{tenantId, membershipId, role, permissions}`), set by the guards. Feature code reaches tenant data only through `TenantDb.run(fn)`, which binds the verified tenant and user to the transaction.
- **Membership queries always filter `tenantId` explicitly.** Inside `withTenant(A, …, {userId})`, the `membership_self_read` policy also exposes the user's memberships in *other* tenants, so `where: { tenantId, userId }` is mandatory (see `TenantAccessService`).
- Long jobs, such as imports and campaign snapshots, run as many short `withTenant` transactions (batches of at most 1,000 rows). They never hold one transaction open for the whole job.

### Tenant selection (HTTP and WS)

- HTTP: the `X-Tenant-Id` header on every tenant-scoped request. The tenant guard verifies an ACTIVE membership. A missing or unrelated tenant returns **404 `TENANT_NOT_FOUND`**, never 403, so tenant existence isn't leaked.
- API keys: the key belongs to one tenant, and the `X-Tenant-Id` header is ignored.
- WebSocket: the tenant is given in the handshake `auth.tenantId`, membership is verified before the socket joins `tenant:{id}`, and `tenant.switch` repeats the check and leaves the old rooms.
- Web client: switching tenant clears the whole TanStack Query cache and reconnects the socket.

### Data residency

No per-tenant data residency in v2 (decision T1). All tenants live in the one configured production region.

### Tenant deletion (decisions T2 and T3)

- **Pending deletion.** The OWNER deletes a workspace with `DELETE /workspace`. That is a soft delete: `tenants.deleted_at` and `purge_after = deleted_at + 30 days` are set, and the tenant resolves as `TENANT_NOT_FOUND` for everyone except its OWNER's restore call. Sends, schedulers and automations for the tenant stop. A tenant pending deletion is **never** purged.
- **Restore.** Only a workspace OWNER can restore, with `POST /workspaces/:id/restore` during the grace period. It clears `deleted_at` and `purge_after` and is audited.
- **Final deletion** runs after `purge_after`, one tenant at a time. Due tenants come from a `system.*` function, and the work runs inside `withTenant`. The steps, in order:
  1. Disconnect and revoke Fenwira-managed Meta/WhatsApp connections: unsubscribe webhooks, and wipe or revoke the credentials.
  2. Purge customer data, conversations, contacts, messages, files, campaigns, automations, operational data and tenant-specific secrets.
  3. Minimize and anonymize/pseudonymize the records that must be kept (legal, financial, billing, fraud prevention, security, audit), per `DATA_RETENTION.md`.
  4. Leave a pseudonymized tenant tombstone and a purge record.
- **Safety.** The purge is **idempotent and safe to retry**: every step is keyed on the tenant and step, and records its completion in `tenant_purges`. A crash resumes at the first incomplete step. Each step is audited (platform audit, without personal data). The purge deletes by tenant ID, table by table, in batches. There is never an unrestricted database-wide cascade hard delete.
- **Retention categories** live in `DATA_RETENTION.md`, so a period can change without redesigning deletion.

### Cross-tenant code paths (complete list)

Everything that must run before a tenant is known, or across tenants, goes through a **named SECURITY DEFINER function in schema `system`**, owned by `fenwira_system`, with `SET search_path = pg_catalog, public`. The app can only `EXECUTE` these functions, and no ad hoc cross-tenant SQL exists.

| # | Path | Function | Returns | Why safe |
| --- | --- | --- | --- | --- |
| X1 | Login / `auth/me` tenant list | *(policy `membership_self_read` + `tenant_root`, via `withUser`)* | The user's own memberships and tenants | Scoped to `app.current_user_id` |
| X2 | Webhook tenant resolution | `system.resolve_tenant_by_phone_number_id(text)` → `(tenant_id, phone_id)`; `system.resolve_tenant_by_waba_id(text)` → `tenant_id` for WABA-level fields (templates, account updates) | IDs or no row | Called only **after** the platform HMAC is verified. Only live (non-DISCONNECTED) numbers and accounts resolve. |
| X3 | Outbox relay | `system.claim_outbox_events(batch int)` | Claimed rows (id, tenant_id, type, payload) | Only the relay calls it. Each handler then re-enters `withTenant`. |
| X4 | Scheduled campaign activation | `system.due_scheduled_campaigns(now timestamptz, limit int)` | `(tenant_id, campaign_id)[]` | IDs only. Processing is per tenant; a conditional update makes one scheduler win. |
| X15 | Campaign recovery and completion | `system.active_campaigns(limit int)` | `(tenant_id, campaign_id, status)[]` for PREPARING/RUNNING | IDs and status only. Each re-drive re-enters `withTenant`. |
| X5 | Phone number sync fan-out | `system.phone_numbers_due_for_sync(older_than timestamptz, limit int)` | `(tenant_id, phone_id)[]` (row IDs) | IDs only. Each sync job re-enters `withTenant`. |
| X6 | Invitation acceptance | `system.resolve_invitation(token_hash bytea)` | `(tenant_id, invitation_id)` | Hash of a 256-bit token |
| X7 | API key authentication | `system.resolve_api_key(prefix text)` | `(tenant_id, api_key_id, key_hash, scopes, revoked_at, expires_at)` | The hash is verified in app code with a constant-time compare (`docs/API_KEYS.md`). Column-level `GRANT SELECT` on `api_keys` includes `prefix` even though it isn't returned, since it's referenced in the function's `WHERE` clause — a column a query only filters on still needs the grant. |
| X8 | Automation inbound webhook trigger | `system.resolve_flow_webhook(token_hash bytea)` | `(tenant_id, flow_id)` | Hash of a 256-bit token |
| X16 | Automation recovery (delays whose job Redis lost, stalled runs) | `system.due_automation_executions(now timestamptz, stale timestamptz, limit int)` | `(tenant_id, execution_id)[]` for WAITING past `wait_until` and RUNNING idle since `stale` | IDs only. Each execution re-enters `withTenant` under a row lock and re-checks its state. |
| X17 | Stale-reservation recovery (`BILLING.md` → Reservations) | `system.stale_reservations(older_than timestamptz, limit int)` | `(tenant_id, message_id)[]` for ACTIVE reservations created before `older_than` whose message is FAILED, SENT, DELIVERED or READ, or missing | IDs only. Each recovery re-enters `withTenant` and re-checks the reservation. |
| X18 | Daily ledger check | `system.wallet_ledger_drift(limit int)` | `(tenant_id, wallet_id)[]` whose cached balance or holds differ from the ledger | IDs only. Figures are read per tenant inside `withTenant`; nothing is corrected. |
| X9 | Maintenance and retention | `system.purge_expired(now)` | Row counts | Deletes by age only, with no data returned. Phase 11 adds the analytics part: `system.purge_analytics_events(tenant_id uuid, before timestamptz)` → row count, deleting one workspace's append-only analytics events older than its retention (nothing else is reachable). |
| X10 | Analytics rollups | `system.tenants_with_activity(since timestamptz, limit int)` | `tenant_id[]` with pending recompute marks or analytics events since `since` | IDs only. Rollups run per tenant inside `withTenant`. |
| X19 | Webhook delivery retention (Phase 11 Step 3, `docs/WEBHOOKS.md`) | `system.tenants_with_stale_webhook_deliveries(before timestamptz, limit int)` → `tenant_id[]`; `system.purge_webhook_deliveries(tenant_id uuid, before timestamptz)` → row count | IDs, then a row count | A dedicated pair, not reused from X9/X10 — it was initially (and incorrectly) attempted with X10's `tenants_with_activity`, which checks analytics-specific dirty marks that have nothing to do with webhook deliveries. Age-only delete, per tenant. |
| X20 | Subscription lifecycle (Phase 11 Step 4, `docs/BILLING.md` → Subscription) | `system.subscriptions_due(now timestamptz, limit int)` | `tenant_id[]`: TRIALING with `trial_ends_at` within 3 days, or ACTIVE whose `current_period_end` has passed | IDs only (column-level grant on four columns). Each tenant is then stepped inside `withTenant`, which re-reads and conditionally updates its own row, so a rerun is a no-op. |
| X11 | Phone number uniqueness at connect | `system.phone_number_owner_exists(phone_number_id text, tenant_id uuid)` | boolean: live in a tenant other than the caller's | Doesn't reveal which tenant. The partial unique index `whatsapp_phone_numbers_active_number_unique` is the real guarantee. |
| X12 | Platform (tenant-less) events, for example `system.ping.requested` | `system.emit_platform_event(event_type, payload, correlation_id)` | Event ID | Writes only `tenant_id = NULL` rows, which no tenant context can read. Tenant events are always inserted inside `withTenant()`. |
| X14 | Template sync fan-out | `system.wabas_due_for_template_sync(older_than timestamptz, limit int)` | `(tenant_id, waba_id)[]` (row IDs) for ACTIVE/RESTRICTED WABAs not synced since `older_than` | IDs only. Each sync re-enters `withTenant`. |
| X13 | Inbox maintenance (snooze expiry, idle takeover release) | `system.inbox_maintenance_due(now timestamptz, limit int)` | `(tenant_id, conversation_id, kind)[]`, kind `UNSNOOZE` or `RELEASE_TAKEOVER` | IDs only. Each change re-enters `withTenant` and re-checks the condition. |

Implemented so far: X1 (policies plus `withUser`), X2 (Phase 5), X3 (`claim_outbox_events`, plus `mark_outbox_dispatched` and `mark_outbox_retry`, which only touch rows by ID), X5 and X11 (Phase 4), X6 (`resolve_invitation`), X12, X13 (Phase 7), X14 (Phase 8), X4 and X15 (Phase 9), X8 and X16 (Phase 10), X17 and X18 (Phase 11 Step 1), X10 plus the analytics part of X9 (Phase 11 Step 2), X7 plus X19 (Phase 11 Step 3), and X20 (Phase 11 Step 4). The rest arrive with their phases.

Adding a row to this table requires an ADR amendment and a security review.

### Testing requirements

- The integration tests run as `fenwira_app` against real Postgres.
- CI check: every table with a `tenant_id` column has `relrowsecurity AND relforcerowsecurity` and a `tenant_isolation` policy (queried from `pg_class`/`pg_policies`). New tables fail CI until this is true.
- A generated matrix per tenant-owned resource checks that Tenant A cannot read, update, delete, search, export or subscribe (WS) to Tenant B's data.
- A no-context query returns 0 rows. An `INSERT` with a foreign `tenant_id` fails `WITH CHECK`.
- Each `system.*` function has a test proving it returns no columns beyond those listed.

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.

### X21 — Platform commercial operations (Step 5)

Platform grants are global identities, runtime read-only. `withPlatform` rechecks the active grant/identity and binds `app.platform_operator_id` only for platform audit reads. It never binds a tenant or membership. Tenant commercial queries/mutations require a separate authorized `withTenant(target)` transaction; ordinary tenant services and sockets still require membership. Platform audit has forced RLS for SELECT and append-only runtime grants; sanitized failed attempts may INSERT without an operator. Provisioning uses restricted migration credentials and records reason/actor in the grant and an immutable event.
