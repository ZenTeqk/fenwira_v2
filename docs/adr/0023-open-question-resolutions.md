# ADR-0023: Tenant purge, message eligibility, sequential automation runs and wallet reservations

**Status:** Accepted (2026-09-26). Extends ADR-0022.

## Context

ADR-0022 left five details open (T3, C3, I3, AE3, B4). The product owner decided them (`PRODUCT.md` → Decision register). Four of them fix architecture that later phases build on.

## Decision

1. **Tenant purge (T3).** Only an OWNER restores a workspace during the grace period, and a tenant pending deletion is never purged. Final deletion runs per tenant, in resumable steps recorded in `tenant_purges`: revoke Meta connections and credentials, purge by retention category, then minimize and pseudonymize the kept categories. It is idempotent, audited and retry-safe. Retention categories live in `DATA_RETENTION.md`, separate from the purge design.
2. **`MessageEligibilityService` (C3).** A single evaluator of category, purpose, consent/opt-out, service window/context, Meta requirements, tenant policy, suppression/block state and other restrictions. MessagingService (accept time) and the outbound worker (send time) both call it, and nothing else decides eligibility. Temporary rules are named (`TEMP_*`), exported in `TEMPORARY_RULES`, and pinned by tests until the final policy matrix replaces them.
3. **Sequential automation runs (AE3).** All matching flows may execute, in `priority`, `created_at`, `id` order, one at a time per triggering event. An `automation_trigger_runs` row holds the plan and each flow's outcome (STARTED, COMPLETED, FAILED, SKIPPED or STOPPED, with a reason). The next flow starts when the previous execution is terminal. Takeover, or a future exclusive flow, stops the rest. Concurrent execution for one event needs a new ADR.
4. **Wallet reservations (B4).** Available funds = balance + credit limit − active reservations. A billable message reserves its estimate atomically under the wallet row lock, in the transaction that accepts it. The reservation is idempotent per message, settled into the ledger by Meta pricing, released on a final non-billable outcome, reconciled when the price differs, and kept across retries. A campaign that can't fund its next recipient moves to `PAUSED_INSUFFICIENT_FUNDS` and resumes later. It is never failed.
5. **Canned replies (I3)** are workspace-shared rows (`canned_replies`, unique shortcut per tenant) under RLS, managed with `inbox.canned_replies.manage` and used with `inbox.reply`. This is recorded here for completeness; it adds no new architecture.

## Consequences

- `wallets` gains `reserved_minor`, and `wallet_reservations` is new (Phase 11). `campaign_status` gains `PAUSED_INSUFFICIENT_FUNDS` (Phase 9 enum, entered from Phase 11).
- Automation latency: a later flow for the same event waits for the earlier one, including its delays. That is the deliberate price of determinism.
- The purge job needs one new `system.*` function to find due tenants, plus a CI check that every tenant table has a retention category.

## Alternatives rejected

- A balance check just before sending: concurrent workers can spend the same funds.
- Running all matching flows in parallel: the order of side effects would be nondeterministic.
- Hard-coding UTILITY as "no consent needed": it makes a legal assumption permanent.
- One cascade delete from `tenants`: it can't keep minimized financial and audit records, and it is unsafe to retry at scale.
