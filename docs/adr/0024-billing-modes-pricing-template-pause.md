# ADR-0024: Tenant billing modes, price book structure, and template-unavailable pause

**Status:** Accepted (2026-09-26). Decisions P9-D1, P9-D2 and P9-D3 (`PRODUCT.md` → Decision register).

## Context

Phase 9 built the B4 wallet core behind one environment switch (`BILLING_ENFORCED`), seeded a price book with one price column, and failed a campaign when its template was disabled mid-send. The product owner decided all three should change before Phase 9 closes.

## Decision

1. **Billing modes (P9-D1).** `tenants.billing_mode` is FREE, TRIAL or PREPAID (default TRIAL); POSTPAID is not in v2. A billable send reserves funds only when the platform switch is on (`BILLING_ENFORCED`: true in production, false in development and tests) **and** the tenant is not FREE (`billingEnforcedFor`). A TRIAL tenant receives `TRIAL_CREDIT_MINOR` once, as a ledger CREDIT (`reason 'Trial credits'`, reference `promotion`, idempotency key `trial:{tenantId}`), when its wallet is first created. Operators set modes with `pnpm --filter @fenwira/worker billing:mode`; the admin UI is Phase 11.
2. **Price book (P9-D2).** `price_book_entries` has `customer_price_minor` (the ledger debit), `provider_cost_minor` (Meta's cost, for margin reporting), `markup_bps`, `tax_code`/`tax_bps` (metadata for Phase 11 invoicing), and `is_placeholder` plus `note`. `usage_events` records `provider_cost_minor` next to the charge. Services read prices only through `unitPrice()`; no price is written in code. The seeded rows are flagged as development placeholders.
3. **Template unavailable (P9-D3).** When MessagingService refuses a campaign send with `TEMPLATE_NOT_APPROVED`, the campaign moves to `PAUSED_TEMPLATE_UNAVAILABLE`. PENDING recipients stay PENDING and are not sent. Resume requires the frozen template version (`template_snapshot.versionId`) to be sendable again; a new or other version means a new campaign. `messages.template_version_id` and `campaigns.template_snapshot` keep the audit trail.

## Consequences

- The enforcement decision reads the tenant row inside the send transaction (one indexed lookup).
- Existing tenants default to TRIAL; with `TRIAL_CREDIT_MINOR=0` nothing changes until operators configure it.
- FAILED is left for campaign-level faults unrelated to Meta's template state (for example a campaign with no template snapshot).

## Alternatives rejected

- A per-tenant boolean "enforced" flag: it can't express trial credits or later POSTPAID.
- One price column: it hides margin and tax treatment, which Phase 11 needs.
- Letting a paused campaign switch templates: the recipients would receive different content under one campaign, and audit gets harder.
