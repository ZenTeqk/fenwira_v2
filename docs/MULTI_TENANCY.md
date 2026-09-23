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
-- tenants: visible if bound, or if the current user is a member
CREATE POLICY tenant_root ON tenants
  USING (
    id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
    OR id IN (SELECT tenant_id FROM memberships
              WHERE user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
                AND status = 'ACTIVE'))
  WITH CHECK (id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- memberships: standard policy + let a user read their own memberships (tenant list before a tenant is chosen)
CREATE POLICY membership_self_read ON memberships FOR SELECT
  USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
```

Creating a tenant (at registration) binds the new tenant's ID before inserting, so the `WITH CHECK` passes.

### Append-only tables

`REVOKE UPDATE, DELETE ON audit_logs, wallet_transactions, analytics_events FROM fenwira_app;`

### Binding tenant context in application code

`packages/database` exports:

```ts
withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>, opts?: { userId?: string }): Promise<T>
withUser<T>(userId: string, fn: (tx: UserTx) => Promise<T>): Promise<T>   // only for listing the user's own memberships/tenants
```

Implementation: a Prisma interactive transaction whose first statement is `SELECT set_config('app.current_tenant_id', $1, true), set_config('app.current_user_id', $2, true)`. The `true` flag gives transaction-local scope (the `SET LOCAL` semantics). This is safe with connection pooling because the setting dies with the transaction.

- The raw `PrismaClient` is exported only from `packages/database/internal`. An ESLint rule forbids importing it outside `packages/database` and the `system` gateway.
- A Prisma client extension also injects `tenant_id` into `create` calls and adds `where: { tenantId }` to queries. This is **defense in depth**; RLS remains the actual guarantee.
- Nest's `TenantContext` (AsyncLocalStorage) holds `{tenantId, userId, permissions, correlationId}`, and services pull the tenant from it rather than from arguments.
- Long jobs, such as imports and campaign snapshots, run as many short `withTenant` transactions (batches of at most 1,000 rows). They never hold one transaction open for the whole job.

### Tenant selection (HTTP and WS)

- HTTP: the `X-Tenant-Id` header on every tenant-scoped request. The tenant guard verifies an ACTIVE membership. A missing or unrelated tenant returns **404 `TENANT_NOT_FOUND`**, never 403, so tenant existence isn't leaked.
- API keys: the key belongs to one tenant, and the `X-Tenant-Id` header is ignored.
- WebSocket: the tenant is given in the handshake `auth.tenantId`, membership is verified before the socket joins `tenant:{id}`, and `tenant.switch` repeats the check and leaves the old rooms.
- Web client: switching tenant clears the whole TanStack Query cache and reconnects the socket.

### Cross-tenant code paths (complete list)

Everything that must run before a tenant is known, or across tenants, goes through a **named SECURITY DEFINER function in schema `system`**, owned by `fenwira_system`, with `SET search_path = pg_catalog, public`. The app can only `EXECUTE` these functions, and no ad hoc cross-tenant SQL exists.

| # | Path | Function | Returns | Why safe |
| --- | --- | --- | --- | --- |
| X1 | Login / `auth/me` tenant list | *(policy `membership_self_read` + `tenant_root`, via `withUser`)* | The user's own memberships and tenants | Scoped to `app.current_user_id` |
| X2 | Webhook tenant resolution | `system.resolve_tenant_by_phone_number_id(text)` | `tenant_id` or NULL | Called only **after** the platform HMAC is verified. Returns only the ID. |
| X3 | Outbox relay | `system.claim_outbox_events(batch int)` | Claimed rows (id, tenant_id, type, payload) | Only the relay calls it. Each handler then re-enters `withTenant`. |
| X4 | Scheduled campaign activation | `system.due_scheduled_campaigns(now timestamptz)` | `(tenant_id, campaign_id)[]` | IDs only. Processing is per tenant. |
| X5 | Phone number sync fan-out | `system.phone_numbers_due_for_sync(now)` | `(tenant_id, phone_number_id)[]` | IDs only |
| X6 | Invitation acceptance | `system.resolve_invitation(token_hash bytea)` | `(tenant_id, invitation_id)` | Hash of a 256-bit token |
| X7 | API key authentication | `system.resolve_api_key(prefix text)` | `(tenant_id, api_key_id, key_hash, scopes, revoked_at)` | The hash is verified in app code with a constant-time compare |
| X8 | Automation inbound webhook trigger | `system.resolve_flow_webhook(token_hash bytea)` | `(tenant_id, flow_id)` | Hash of a 256-bit token |
| X9 | Maintenance and retention | `system.purge_expired(now)` | Row counts | Deletes by age only, with no data returned |
| X10 | Analytics rollups | `system.tenants_with_activity(since)` | `tenant_id[]` | IDs only. Rollups run per tenant. |
| X11 | Phone number uniqueness at connect | `system.phone_number_owner_exists(text)` | boolean | Doesn't reveal which tenant |
| X12 | Platform (tenant-less) events, for example `system.ping.requested` | `system.emit_platform_event(event_type, payload, correlation_id)` | Event ID | Writes only `tenant_id = NULL` rows, which no tenant context can read. Tenant events are always inserted inside `withTenant()`. |

Implemented so far (Phase 1): X3 (`claim_outbox_events`, plus `mark_outbox_dispatched` and `mark_outbox_retry`, which only touch rows by ID) and X12. The rest arrive with their phases.

Adding a row to this table requires an ADR amendment and a security review.

### Testing requirements

- The integration tests run as `fenwira_app` against real Postgres.
- CI check: every table with a `tenant_id` column has `relrowsecurity AND relforcerowsecurity` and a `tenant_isolation` policy (queried from `pg_class`/`pg_policies`). New tables fail CI until this is true.
- A generated matrix per tenant-owned resource checks that Tenant A cannot read, update, delete, search, export or subscribe (WS) to Tenant B's data.
- A no-context query returns 0 rows. An `INSERT` with a foreign `tenant_id` fails `WITH CHECK`.
- Each `system.*` function has a test proving it returns no columns beyond those listed.

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| T1 | Per-tenant data residency (for example an India-only region) is out of scope for v2. Please confirm. | Product |
| T2 | Tenant deletion: hard delete after a 30-day grace period (assumed), or keep an anonymized archive? | Product/Legal |
