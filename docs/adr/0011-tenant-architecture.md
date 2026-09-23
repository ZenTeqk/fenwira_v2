# ADR-0011: Shared-schema tenant architecture

**Status:** Accepted

## Context

Users can belong to several workspaces. Tenants vary from tiny to large, and the tenant count should scale cheaply.

## Decision

- One database and one schema. Every tenant-owned row has `tenant_id`, isolated by RLS (ADR-0005).
- `users` are global. `memberships` link users to tenants with one role each.
- The active tenant is chosen per request (`X-Tenant-Id`) and verified against membership. A foreign tenant returns 404.
- "Tenant" is the term in code and the DB. "Workspace" is the term in the UI.
- Roles are fixed (5), and guards check permission keys.

## Consequences

- Cheap tenants, simple migrations, and cross-tenant platform operations only through audited `system.*` functions.
- A noisy tenant can affect others. That is mitigated by per-tenant rate limits and per-number queue limiters.

## Alternatives rejected

- Schema- or DB-per-tenant (see ADR-0005).
- User-per-tenant accounts: bad UX for agencies and multi-brand owners.
