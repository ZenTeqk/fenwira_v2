# ADR-0005: Row Level Security for tenant isolation

**Status:** Accepted

## Context

Cross-tenant data leakage is the most damaging failure possible for a multi-tenant messaging platform. Application-level `WHERE tenant_id = ?` filters are easy to forget in one query.

## Decision

Every tenant-owned table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy on `app.current_tenant_id` (fail-closed via `nullif`). The runtime role `fenwira_app` is `NOSUPERUSER NOBYPASSRLS`. Tenant context is bound per transaction with `set_config(..., true)`. A Prisma extension adds tenant filters as defense in depth. Cross-tenant needs go only through named `SECURITY DEFINER` functions (`MULTI_TENANCY.md`).

## Consequences

- A forgotten filter returns no rows instead of another tenant's rows.
- Every tenant query must run inside a transaction (`withTenant`). That adds a small overhead, which is acceptable.
- CI must verify policies exist on every tenant table, and does.
- Superusers bypass RLS, so tests must run as `fenwira_app`.

## Alternatives rejected

- **App-level filtering only:** a single bug leaks data.
- **Schema-per-tenant or DB-per-tenant:** migration and connection overhead grows with the tenant count. Unnecessary at our scale.
