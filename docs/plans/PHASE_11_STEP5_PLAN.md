# Phase 11 Step 5 — approved implementation plan

Step 4 ACCEPTED. Step 5 implementation authorized 2026-10-05. Phase 11 remains open.

Nine independently verified increments: (1) global operator identity/grant tooling, (2) mandatory password/TOTP and short platform sessions, (3) immutable receipts/audit/idempotency, (4) bounded commercial reads, (5) wallet operations, (6) subscription/mode/override domain adapters, (7) separate platform shell/search/detail, (8) consequential actions/audit, (9) observability/regression/acceptance preparation.

Approved founder policies: negative adjustments must leave available funds nonnegative after holds; full/partial usage refunds are capped at the original debit. No paid-credit withdrawals/cash repayment or promotional clawback.

Reuse withTenant, forced RLS, wallet locks/append-only ledger, subscriptions, EntitlementsService, outbox and notifications. Platform authorization never grants tenant membership or API scopes. No customer conversation content. Mandatory MFA; privilege lasts at most 30 minutes, idle timeout 10 minutes, consequential writes need MFA within 5 minutes. Recovery via account backup codes does not grant platform access: re-enroll TOTP first.

Configured entitlements are shown separately from rollout enforcement. Promotional expiry remains metadata; show grants, not fabricated remaining fund buckets. Provider costs are internal, nullable, with coverage. No production subscription pricing, gateway, GST/invoices or postpaid policy. BILLING_SUBSCRIPTIONS_ENFORCED stays unchanged.

Each increment needs focused tests, contracts/API documentation, security implications and concrete validation recorded in STEP5_VALIDATION.md. Final checks: lint/typecheck/unit/integration/build, stack/smoke, platform E2E, WCAG 2.2 AA and Lighthouse >=95. New tenant receipts need RLS matrix tests. Preserve financial history; grants default denied. Stop at Step 5 acceptance preparation; do not execute Phase 11 closure.
