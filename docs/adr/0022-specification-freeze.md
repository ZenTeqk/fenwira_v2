# ADR-0022: Specification freeze decisions with architectural impact

**Status:** Accepted (2026-09-26)

## Context

The product owner resolved all 30 open questions in the v2 specification (`PRODUCT.md` → Decision register). Most confirmed the existing assumptions. Four changed the architecture, and one made an existing property binding. This ADR records those five, so later changes need a superseding ADR.

## Decision

1. **Tenant deletion lifecycle (T2).** Deleting a workspace is a soft delete, recoverable for 30 days. After that, a per-tenant purge job removes or anonymizes the tenant's data under the retention policy. No unrestricted database-wide hard delete may exist. The purge job finds due tenants through a new `system.*` function (an addition to the cross-tenant table in `MULTI_TENANCY.md`, with its own security review), then works inside `withTenant` for that one tenant.
2. **Centralized message eligibility (C1).** One purpose/category-aware consent and policy service is the only place that decides whether a message may be sent. `MessagingService` (accept time) and the outbound worker (send time) both call it. No module hard-codes a per-purpose rule. MARKETING requires recorded GRANTED consent. Other purposes are policy (open question C3).
3. **Deterministic automation priority (AE2).** `flows.priority int` (default 100, lower first), with ties broken by `created_at` then `id`. This replaces "oldest flow wins".
4. **Bounded wallet balance (B3).** Billable outbound messages from any source are checked against the usable balance (`balance + credit_limit_minor`, default 0) before they are accepted. Inbound messages, status updates and non-billable processing are never blocked. This replaces "message debits may overdraw without limit".
5. **Data protection boundary (D1).** Message content relies on encryption at rest and TLS. Authentication material keeps application-level encryption or hashing, and never reaches the browser or logs.

## Consequences

- The Phase 6 consent checks (in `MessagingService` and in the outbound worker) must be consolidated into the policy service. The UTILITY check they contain is interim until C3.
- The Phase 3 soft delete of `DELETE /workspace` stays. A restore path and the purge job are added once open question T3 is answered.
- Phase 10 adds `flows.priority`. Phase 11 adds `wallets.credit_limit_minor` and enforces B3, with the in-flight mechanism set by open question B4.
- The remaining undecided details (T3, C3, I3, AE3, B4) are open questions, not assumptions. Work that depends on them waits.

## Alternatives rejected

- Hard delete of a tenant right after the grace period (the previous assumption): it conflicts with retention obligations for financial and audit records.
- Per-purpose checks inline in each sender: they drift, and they make policy changes code changes.
- Keeping "oldest flow wins": tenants couldn't control the order, and it gives no explicit tie-break.
- Unlimited overdraft for message debits: it lets a tenant accrue unbounded cost.
