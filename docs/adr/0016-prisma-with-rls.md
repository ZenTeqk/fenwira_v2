# ADR-0016: Prisma ORM coexisting with RLS

**Status:** Accepted

## Context

Prisma gives typed queries and migrations, but it has no built-in notion of RLS session variables and uses a connection pool.

## Decision

- Prisma schema and migrations in `packages/database`. Migrations run as `fenwira_owner`. RLS policies, grants, triggers and `system.*` functions live in idempotent SQL (`sql/post-migrate.sql`) that runs after every `migrate deploy`.
- All runtime tenant access goes through `withTenant()`: an interactive transaction whose first statement is `set_config('app.current_tenant_id', …, true)`. Because the setting is transaction-local, pooled connections never leak context.
- A Prisma client extension injects `tenantId` into writes and filters (defense in depth).
- The raw client is exported only from `packages/database/internal`, and a lint rule forbids importing it elsewhere.
- Complex queries (FTS, analytics rollups, the filter DSL's hard cases) use `$queryRaw` tagged templates inside `withTenant`.

## Consequences

- Typed data access with DB-enforced isolation.
- Every tenant query pays for a transaction. Long jobs must batch into short transactions.
- Prisma can't express some Postgres features (partial unique indexes, generated tsvector columns, policies), so those live in the SQL migration files. The Prisma schema documents them in comments.

## Alternatives rejected

- **Drizzle / Kysely:** viable, but Prisma's migration tooling and team familiarity won.
- **Separate Prisma client per tenant:** connection explosion.
